import { beforeEach, describe, expect, it } from 'vitest';
import type { Command } from '../../shopping/engine';
import { defaultEngineContext, deriveAll } from '../../shopping/engine';
import { InMemoryShoppingRepository } from './repository';
import { StubRequirementSource } from './requirement-source';
import { generateFromPlan, parseCommand, syncList } from './service';

const HH = 'hh-1';
const ALICE = 'alice';
const BOB = 'bob';
let n = 0;
const id = () => `id-${++n}`;
const at = '2026-10-19T10:00:00.000Z';

const kg = (value: number) => ({ kind: 'exact' as const, value, unit: 'kg' as const, originalText: `${value} kg` });
const g = (value: number) => ({ kind: 'exact' as const, value, unit: 'g' as const, originalText: `${value} g` });

let repo: InMemoryShoppingRepository;

beforeEach(() => {
  repo = new InMemoryShoppingRepository();
});

async function addItem(actor = ALICE, quantity = kg(1), name = 'Flour'): Promise<string> {
  const itemId = id();
  const r = await repo.submit(HH, { type: 'add_item', commandId: id(), actor, at, itemId, displayName: name, category: 'Dry goods', quantity });
  expect(r.result.status).toBe('applied');
  return itemId;
}

const tick = (itemId: string, actor: string, commandId = id()): Command => ({ type: 'tick', commandId, actor, at, itemId });

async function views() {
  const snap = await repo.snapshot(HH);
  return deriveAll(snap.state, defaultEngineContext);
}

describe('ShoppingRepository (in-memory)', () => {
  it('assigns a seq per first-seen command and replays entries since a cursor', async () => {
    const item = await addItem();
    await repo.submit(HH, tick(item, ALICE));
    expect(await repo.head(HH)).toBe(2);
    expect((await repo.entriesSince(HH, 1)).map((e) => e.seq)).toEqual([2]);
    expect(await repo.entriesSince(HH, 2)).toEqual([]);
  });

  it('keeps households separate', async () => {
    await addItem();
    expect(await repo.head('other')).toBe(0);
    expect((await repo.snapshot('other')).state.itemOrder).toHaveLength(0);
  });

  it('is idempotent: the same tick id twice records one purchase and does not grow the log', async () => {
    const item = await addItem();
    const cmd = tick(item, ALICE, 'tick-1');
    const a = await repo.submit(HH, cmd);
    const b = await repo.submit(HH, cmd);
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.result).toMatchObject({ status: 'applied', eventId: 'tick-1' });
    expect(await repo.head(HH)).toBe(2);
    const [v] = await views();
    expect(v!.activeEvents).toHaveLength(1);
    expect(v!.status).toBe('complete');
  });

  it('double tick by two shoppers: one purchase, one already_complete conflict naming the winner', async () => {
    const item = await addItem();
    const [a, b] = await Promise.all([
      repo.submit(HH, tick(item, ALICE)),
      repo.submit(HH, tick(item, BOB)),
    ]);
    const statuses = [a.result.status, b.result.status].sort();
    expect(statuses).toEqual(['applied', 'rejected']);
    const loser = a.result.status === 'rejected' ? a : b;
    expect(loser.result.reason).toBe('already_complete');
    const winnerActor = a.result.status === 'applied' ? ALICE : BOB;
    expect(loser.result.completedBy).toEqual([winnerActor]);
    const [v] = await views();
    expect(v!.activeEvents).toHaveLength(1);
    expect(v!.outstanding).toBe(0);
    // The rejection is logged too (replay determinism)
    expect((await repo.entriesSince(HH, 0)).filter((e) => e.result.status === 'rejected')).toHaveLength(1);
  });

  it('a rejected tick is final: undoing the winner afterwards does not resurrect it', async () => {
    const item = await addItem();
    const win = await repo.submit(HH, tick(item, ALICE, 'win'));
    const lose = await repo.submit(HH, tick(item, BOB, 'lose'));
    expect(lose.result.reason).toBe('already_complete');
    await repo.submit(HH, { type: 'undo', commandId: id(), actor: ALICE, at, eventId: win.result.eventId! });
    const [v] = await views();
    expect(v!.activeEvents).toHaveLength(0);
    expect(v!.status).toBe('outstanding');
    // Bob retrying the same command id is still the original rejection
    expect((await repo.submit(HH, tick(item, BOB, 'lose'))).result.reason).toBe('already_complete');
  });

  it('undo voids the event, restores the outstanding quantity, and a second undo is harmless', async () => {
    const item = await addItem();
    const t = await repo.submit(HH, tick(item, ALICE));
    const undo: Command = { type: 'undo', commandId: id(), actor: ALICE, at, eventId: t.result.eventId! };
    expect((await repo.submit(HH, undo)).result.status).toBe('applied');
    let [v] = await views();
    expect(v!.status).toBe('outstanding');
    expect(v!.outstanding).toBe(1);
    expect(v!.voidedEvents).toHaveLength(1); // history kept, never deleted
    const again = await repo.submit(HH, { ...undo, commandId: id() });
    expect(again.result).toMatchObject({ status: 'rejected', reason: 'already_voided' });
    [v] = await views();
    expect(v!.activeEvents).toHaveLength(0);
  });

  it('partial purchase then tick buys only the remainder (units converted)', async () => {
    const item = await addItem(ALICE, kg(1));
    await repo.submit(HH, { type: 'purchase', commandId: id(), actor: ALICE, at, itemId: item, quantity: g(400), actualPricePence: 90 });
    let [v] = await views();
    expect(v!.status).toBe('partial');
    expect(v!.outstanding).toBeCloseTo(0.6, 6);
    await repo.submit(HH, tick(item, BOB));
    [v] = await views();
    expect(v!.status).toBe('complete');
    expect(v!.activeEvents).toHaveLength(2);
  });

  it('rejects a purchase in an incompatible unit and writes nothing', async () => {
    const item = await addItem(ALICE, kg(1));
    const r = await repo.submit(HH, {
      type: 'purchase', commandId: id(), actor: ALICE, at, itemId: item,
      quantity: { kind: 'exact', value: 1, unit: 'can', originalText: '1 can' },
    });
    expect(r.result).toMatchObject({ status: 'rejected', reason: 'incompatible_unit' });
    const [v] = await views();
    expect(v!.activeEvents).toHaveLength(0);
  });

  it('merges metadata (recipe titles) across generates', async () => {
    await repo.mergeMeta(HH, { recipeTitles: { a: 'A' } });
    await repo.mergeMeta(HH, { recipeTitles: { b: 'B' } });
    expect((await repo.getMeta(HH)).recipeTitles).toEqual({ a: 'A', b: 'B' });
  });
});

describe('service', () => {
  it('syncList applies commands, returns entries after the cursor, drops malformed ones', async () => {
    const itemId = id();
    const add: Command = { type: 'add_item', commandId: id(), actor: ALICE, at, itemId, displayName: 'Milk', category: 'Dairy & eggs', quantity: { kind: 'exact', value: 2, unit: 'pint', originalText: '2 pints' } };
    const res = await syncList(repo, HH, [add, { type: 'nope', commandId: 'bad-1' }, 42], 0);
    expect(res.results).toHaveLength(1);
    expect(res.dropped).toEqual(['bad-1']);
    expect(res.entries.map((e) => e.seq)).toEqual([1]);
    const again = await syncList(repo, HH, [add], 1); // retry of an applied command
    expect(again.entries).toEqual([]);
    expect(again.results[0]!.status).toBe('applied');
    expect(await repo.head(HH)).toBe(1);
  });

  it('syncList returns a snapshot when the client cursor is ahead of the server', async () => {
    const res = await syncList(repo, HH, [], 99);
    expect(res.snapshot).toBeDefined();
    expect(res.cursor).toBe(0);
  });

  it('never accepts regenerate from a client', () => {
    expect(parseCommand({ type: 'regenerate', commandId: 'x', actor: 'a', at, lines: [] })).toBeNull();
  });

  it('generateFromPlan creates plan-linked items with provenance, and is stable when re-run', async () => {
    const source = new StubRequirementSource();
    const first = await generateFromPlan(repo, source, HH, 'p1', ALICE, id);
    expect(first?.lineCount).toBeGreaterThan(5);
    const v1 = await views();
    const onions = v1.find((v) => v.item.displayName === 'Onions')!;
    expect(onions.item.requirement!.contributions.map((c) => c.recipeId)).toHaveLength(3);
    expect((await repo.getMeta(HH)).recipeTitles['recipe-tikka']).toBe('Chicken tikka masala');
    await generateFromPlan(repo, source, HH, 'p1', ALICE, id);
    const v2 = await views();
    expect(v2.filter((v) => !v.item.removed)).toHaveLength(v1.filter((v) => !v.item.removed).length);
    expect(await generateFromPlan(repo, source, HH, 'missing', ALICE, id)).toBeNull();
  });
});
