import { describe, expect, it } from 'vitest';
import type { Command } from './engine';
import { ShoppingController, type PendingStore, type Transport } from './controller';
import { InMemoryShoppingRepository } from '../server/shopping/repository';
import { syncList } from '../server/shopping/service';
import { activeView, defaultEngineContext } from './engine';

const HH = 'hh';
let n = 0;
const id = () => `c-${++n}`;

function setup(actor: string, repo: InMemoryShoppingRepository, online = { value: true }) {
  const transport: Transport = {
    sync: async (cmds, cursor) => {
      if (!online.value) throw new Error('offline');
      return syncList(repo, HH, cmds, cursor);
    },
    snapshot: async () => repo.snapshot(HH),
  };
  let saved: Command[] = [];
  const store: PendingStore = { load: () => saved, save: (p) => { saved = p; } };
  const notices: unknown[] = [];
  return {
    transport, store, notices, getSaved: () => saved,
    make: async () => new ShoppingController(await repo.snapshot(HH), {
      transport, store, actor: () => actor, newId: id, onNotice: (x) => notices.push(x),
    }),
  };
}

describe('ShoppingController', () => {
  it('optimistic tick shows instantly, then confirms; undo restores', async () => {
    const repo = new InMemoryShoppingRepository();
    const a = await setup('alice', repo).make();
    const itemId = a.addItem({ displayName: 'Flour', category: 'Dry goods', quantity: { kind: 'exact', value: 1, unit: 'kg', originalText: '1 kg' } });
    await a.sync();
    const eventId = a.tick(itemId);
    expect(activeView(a.getState().view, defaultEngineContext)).toHaveLength(0); // optimistic
    expect(a.getState().pendingItemIds.has(itemId)).toBe(true);
    await a.sync();
    expect(a.getState().pendingCount).toBe(0);
    a.undo(eventId);
    await a.sync();
    expect(activeView(a.getState().view, defaultEngineContext)).toHaveLength(1);
  });

  it('two shoppers tick the same item offline-then-online: one purchase, one conflict notice', async () => {
    const repo = new InMemoryShoppingRepository();
    const seed = await setup('alice', repo).make();
    const itemId = seed.addItem({ displayName: 'Rice', category: 'Dry goods', quantity: { kind: 'exact', value: 500, unit: 'g', originalText: '500 g' } });
    await seed.sync();

    const bobOnline = { value: false };
    const A = setup('alice', repo);
    const B = setup('bob', repo, bobOnline);
    const a = await A.make();
    const b = await B.make();

    b.tick(itemId); // queued offline
    await b.sync(); // fails -> offline, pending kept
    expect(b.getState().status).toBe('offline');
    expect(B.getSaved()).toHaveLength(1);

    a.tick(itemId);
    await a.sync();

    bobOnline.value = true;
    await b.sync();
    expect(b.getState().pendingCount).toBe(0);
    expect(B.notices).toHaveLength(1);
    expect(B.notices[0]).toMatchObject({ kind: 'conflict', itemName: 'Rice' });
    expect(A.notices).toHaveLength(0);
    const events = Object.values(b.getState().view.events).filter((e) => !e.voidedBy);
    expect(events).toHaveLength(1);
    expect(events[0]!.createdBy).toBe('alice');
  });

  it('restores persisted pending commands and replays them (retries are idempotent)', async () => {
    const repo = new InMemoryShoppingRepository();
    const first = setup('alice', repo, { value: false });
    const c1 = await first.make();
    c1.addItem({ displayName: 'Eggs', category: 'Dairy & eggs', quantity: { kind: 'exact', value: 6, unit: 'item', originalText: '6' } });
    await c1.sync();
    expect(first.getSaved()).toHaveLength(1);

    // "Reload": new controller, same storage, now online. Replay twice to prove idempotency.
    const online = setup('alice', repo);
    const persisted = first.getSaved();
    const store: PendingStore = { load: () => persisted, save: () => undefined };
    const c2 = new ShoppingController(await repo.snapshot(HH), { transport: online.transport, store, actor: () => 'alice', newId: id });
    c2.restore();
    await c2.sync();
    await c2.sync();
    expect((await repo.snapshot(HH)).state.itemOrder).toHaveLength(1);
    expect(c2.getState().pendingCount).toBe(0);
  });
});
