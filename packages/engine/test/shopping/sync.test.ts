import { describe, expect, it } from 'vitest';
import { deriveAll } from '../../src/shopping/derive';
import type { Command } from '../../src/shopping/model';
import {
  type ClientState, type ServerState, clientEnqueue, clientIngest, clientOutbox, clientResync, clientView,
  createClient, createServer, replay, serverEntriesSince, serverSnapshot, serverSubmit,
} from '../../src/shopping/sync';
import type { Unit } from '../../src/contract';
import { T, ctx, idGen, q, req, rng } from './helpers';

const A = 'user-a';
const B = 'user-b';

function seedServer(): ServerState {
  const regen: Command = {
    type: 'regenerate', commandId: 'regen-1', actor: A, at: T,
    lines: [
      { itemId: 'i-flour', requirement: req('ing-flour', 'Flour', q(500, 'g')), category: 'Baking' },
      { itemId: 'i-milk', requirement: req('ing-milk', 'Milk', q(2, 'l')), category: 'Dairy' },
      { itemId: 'i-onion', requirement: req('ing-onion', 'Onion', q(4)), category: 'Veg' },
      { itemId: 'i-salt', requirement: req('ing-salt', 'Salt', { kind: 'to_taste', originalText: 'salt' }), category: 'Baking' },
    ],
  };
  return serverSubmit(createServer(), regen, ctx).server;
}

function flush(server: ServerState, client: ClientState): ServerState {
  let s = server;
  for (const c of clientOutbox(client)) s = serverSubmit(s, c, ctx).server;
  return s;
}

const sync = (server: ServerState, client: ClientState): ClientState => {
  const c = clientIngest(client, serverEntriesSince(server, client.cursor), ctx);
  return c.needsResync ? clientResync(c, serverSnapshot(server), [], ctx) : c;
};

describe('offline queue and concurrent shoppers', () => {
  it('two shoppers tick the same item offline: one purchase, one conflict', () => {
    let server = seedServer();
    let a = createClient(serverSnapshot(server));
    let b = createClient(serverSnapshot(server));
    a = clientEnqueue(a, { type: 'tick', commandId: 'ea', actor: A, at: T, itemId: 'i-flour' });
    b = clientEnqueue(b, { type: 'tick', commandId: 'eb', actor: B, at: T, itemId: 'i-flour' });
    // both see it complete locally (optimistic)
    expect(deriveAll(clientView(a, ctx), ctx).find((v) => v.item.id === 'i-flour')!.status).toBe('complete');
    server = flush(server, b);
    server = flush(server, a);
    server = flush(server, a); // retry after flaky network: idempotent
    a = sync(server, a);
    b = sync(server, b);
    expect(server.log).toHaveLength(3);
    expect(a.pending).toHaveLength(0);
    expect(a.conflicts).toEqual([expect.objectContaining({ commandId: 'ea', reason: 'already_complete', completedBy: [B] })]);
    expect(b.conflicts).toEqual([]);
    const flour = deriveAll(a.confirmed, ctx).find((v) => v.item.id === 'i-flour')!;
    expect(flour).toMatchObject({ purchased: 500, status: 'complete' });
    expect(a.confirmed).toEqual(b.confirmed);
  });

  it('detects a log gap and resyncs from snapshot, keeping pending commands', () => {
    let server = seedServer();
    let a = createClient(serverSnapshot(server));
    server = serverSubmit(server, { type: 'purchase', commandId: 'p1', actor: B, at: T, itemId: 'i-milk', quantity: q(1, 'l') }, ctx).server;
    server = serverSubmit(server, { type: 'purchase', commandId: 'p2', actor: B, at: T, itemId: 'i-milk', quantity: q(500, 'ml') }, ctx).server;
    a = clientEnqueue(a, { type: 'tick', commandId: 'ta', actor: A, at: T, itemId: 'i-milk' });
    a = clientIngest(a, serverEntriesSince(server, 2), ctx); // missed seq 2 -> gap
    expect(a.needsResync).toBe(true);
    a = clientResync(a, { cursor: 1, state: seedServer().state }, serverEntriesSince(server, 1), ctx);
    expect(a.needsResync).toBe(false);
    expect(a.cursor).toBe(3);
    expect(a.pending.map((c) => c.commandId)).toEqual(['ta']);
    server = flush(server, a);
    a = sync(server, a);
    expect(server.log.at(-1)!.command.commandId).toBe('ta');
    expect(server.state.events['ta']!.quantity).toMatchObject({ value: 0.5, unit: 'l' }); // only the remainder
  });

  it('snapshot + since-cursor equals full replay', () => {
    let server = seedServer();
    server = serverSubmit(server, { type: 'tick', commandId: 't1', actor: A, at: T, itemId: 'i-onion' }, ctx).server;
    const snap = serverSnapshot(server);
    server = serverSubmit(server, { type: 'undo', commandId: 'u1', actor: B, at: T, eventId: 't1' }, ctx).server;
    const viaSnap = replay(snap, serverEntriesSince(server, snap.cursor), ctx);
    const full = replay({ cursor: 0, state: createServer().state }, server.log, ctx);
    expect(viaSnap.state).toEqual(server.state);
    expect(full.state).toEqual(server.state);
  });
});

describe('randomised interleaving (2 clients, offline replay, duplicates, gaps)', () => {
  const itemIds = ['i-flour', 'i-milk', 'i-onion', 'i-salt'];
  const units: Record<string, Array<[number, Unit]>> = {
    'i-flour': [[100, 'g'], [0.25, 'kg']],
    'i-milk': [[250, 'ml'], [0.5, 'l']],
    'i-onion': [[1, 'item'], [150, 'g']],
    'i-salt': [],
  };

  for (let seed = 1; seed <= 200; seed++) {
    it(`seed ${seed} converges`, () => {
      const r = rng(seed);
      const pick = <X>(xs: X[]): X => xs[Math.floor(r() * xs.length)]!;
      const ids = { A: idGen('aaaaaaaa'), B: idGen('bbbbbbbb') };
      let server = seedServer();
      const clients: Record<'A' | 'B', ClientState> = {
        A: createClient(serverSnapshot(server)),
        B: createClient(serverSnapshot(server)),
      };
      const sent: Command[] = [];

      for (let step = 0; step < 40; step++) {
        const who = r() < 0.5 ? 'A' : 'B';
        const actor = who === 'A' ? A : B;
        let c = clients[who];
        const roll = r();
        if (roll < 0.55) {
          const id = ids[who]();
          const itemId = pick(itemIds);
          const local = clientView(c, ctx);
          const kind = r();
          let cmd: Command;
          if (kind < 0.45) cmd = { type: 'tick', commandId: id, actor, at: T, itemId };
          else if (kind < 0.7 && units[itemId]!.length) {
            const [v, u] = pick(units[itemId]!);
            cmd = { type: 'purchase', commandId: id, actor, at: T, itemId, quantity: q(v, u) };
          } else if (kind < 0.9 && local.eventOrder.length) {
            cmd = { type: 'undo', commandId: id, actor, at: T, eventId: pick(local.eventOrder) };
          } else cmd = { type: 'edit_item', commandId: id, actor, at: T, itemId, patch: { notes: `n${step}` } };
          c = clientEnqueue(c, cmd);
          sent.push(cmd);
        } else if (roll < 0.75) {
          // go online: send a random prefix of the queue, sometimes twice (lost ack -> retry)
          const out = clientOutbox(c);
          const n = Math.floor(r() * (out.length + 1));
          for (const cmd of out.slice(0, n)) {
            server = serverSubmit(server, cmd, ctx).server;
            if (r() < 0.3) server = serverSubmit(server, cmd, ctx).server;
          }
        } else if (roll < 0.92) {
          // realtime delivery: sometimes drop the first entry to simulate a missed event
          let entries = serverEntriesSince(server, c.cursor);
          if (entries.length > 1 && r() < 0.3) entries = entries.slice(1);
          c = clientIngest(c, entries, ctx);
          if (c.needsResync) {
            const snap = serverSnapshot(server);
            c = clientResync(c, snap, serverEntriesSince(server, snap.cursor), ctx);
          }
        } else {
          const snap = serverSnapshot(server);
          c = clientResync(c, snap, [], ctx);
        }
        clients[who] = c;
      }

      // reconnect everyone: flush queues, then catch up
      for (const who of ['A', 'B'] as const) server = flush(server, clients[who]);
      for (const who of ['A', 'B'] as const) clients[who] = sync(server, clients[who]);

      // 1) convergence
      expect(clients.A.pending).toEqual([]);
      expect(clients.B.pending).toEqual([]);
      expect(clients.A.confirmed).toEqual(server.state);
      expect(clients.B.confirmed).toEqual(server.state);
      expect(replay({ cursor: 0, state: createServer().state }, server.log, ctx).state).toEqual(server.state);

      // 2) every command processed exactly once; log has no duplicate ids
      const logIds = server.log.map((e) => e.command.commandId);
      expect(new Set(logIds).size).toBe(logIds.length);
      for (const cmd of sent) expect(server.state.outcomes[cmd.commandId]).toBeDefined();

      // 3) no double purchase: for items whose active purchases are all ticks, purchased <= required
      for (const v of deriveAll(server.state, ctx)) {
        const ticksOnly = v.activeEvents.every((e) => server.state.outcomes[e.id]!.type === 'tick');
        if (ticksOnly) expect(v.purchased).toBeLessThanOrEqual(v.required + 1e-6);
        expect(v.activeEvents.length + v.voidedEvents.length).toBe(
          server.state.eventOrder.filter((id) => server.state.events[id]!.shoppingListItemId === v.item.id).length,
        );
      }

      // 4) every rejected own command is surfaced as a conflict to its issuer exactly once
      const rejected = server.log.filter((e) => e.result.status === 'rejected').map((e) => e.command.commandId).sort();
      const surfaced = [...clients.A.conflicts, ...clients.B.conflicts].map((x) => x.commandId).sort();
      expect(surfaced).toEqual(rejected);
    });
  }
});
