import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { AiError, createMockProvider, type AiProvider, type ShoppingListScan } from '@fr/ai';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { defaultEngineContext, deriveAll } from '../../shopping/engine';
import { rowFromDto, toCommitRows } from '../../shopping/list-scan-rows';
import { guessAisle, runShoppingListScan, toListScanRows } from './list-scan';
import {
  confirmListScan, defaultNewListName, derivedId, parseDestination, planListScan, previewListScan, sanitiseCommitRows,
  type ApplyEnv,
} from './list-scan-apply';
import { InMemoryShoppingRepository } from './repository';
import { syncList } from './service';

const cat = getIngredientCatalogue();
const ctx = { ...defaultEngineContext, converter: cat.converter };
const HH = 'hh-1';
const ME = 'alice';
const mock = () => createMockProvider({ env: { NODE_ENV: 'test' } });
const jpeg = async () => new Uint8Array(await sharp({ create: { width: 64, height: 48, channels: 3, background: '#88aa44' } }).jpeg().toBuffer());
const ingId = (name: string): string => {
  const m = cat.matcher.match(name);
  if (!m.ingredientId) throw new Error(`no ingredient ${name}`);
  return m.ingredientId;
};

let repo: InMemoryShoppingRepository;
let env: ApplyEnv;
let n = 0;
beforeEach(() => {
  repo = new InMemoryShoppingRepository(ctx);
  env = { repo, householdId: HH, actor: ME, ctx, cat, now: () => new Date('2026-10-20T09:00:00Z') };
  n = 0;
});
const id = () => `seed-${++n}`;
const at = '2026-10-20T08:00:00.000Z';

async function seed(name: string, value?: number, unit?: 'g' | 'kg' | 'item' | 'l' | 'ml', ingredient = true) {
  const m = cat.matcher.match(name);
  const itemId = id();
  const r = await repo.submit(HH, {
    type: 'add_item', commandId: id(), actor: ME, at, itemId, displayName: name, category: 'Other',
    ...(ingredient && m.ingredientId ? { ingredientId: m.ingredientId } : {}),
    ...(value !== undefined ? { quantity: { kind: 'exact' as const, value, unit: unit ?? 'item', originalText: `${value}` } } : {}),
  });
  expect(r.result.status).toBe('applied');
  return itemId;
}

async function views() {
  return deriveAll((await repo.snapshot(HH)).state, ctx).filter((v) => !v.item.removed);
}
const find = async (name: string) => (await views()).filter((v) => v.item.displayName.toLowerCase() === name.toLowerCase());
const amount = (v: { required: number; unit?: string }) => `${v.required} ${v.unit && v.unit !== 'item' ? v.unit : ''}`.trim();

describe('mapping the scan to reviewable rows', () => {
  it('runs the mock provider and returns rows, a title and writes NOTHING', async () => {
    await seed('milk', 1, 'l');
    const before = await repo.head(HH);
    const out = await runShoppingListScan({ images: [await jpeg()] }, { provider: mock() });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.title).toBe('Saturday shop');
    expect(out.rows.map((r) => r.key)).toEqual(['l1', 'l2', 'l3', 'l4', 'l5', 'l6', 'l7', 'l8', 'l9', 'l10', 'l11']);
    expect(await repo.head(HH)).toBe(before);
    expect(await repo.listLists(HH)).toHaveLength(1);
  });

  it('matches exact names / aliases to the catalogue and files each under the right aisle', async () => {
    const out = await runShoppingListScan({ images: [await jpeg()] }, { provider: mock() });
    if (!out.ok) throw new Error('scan failed');
    const by = (t: string) => out.rows.find((r) => r.originalText === t)!;
    expect(by('1kg spuds')).toMatchObject({ name: 'potatoes', match: { status: 'matched', ingredient: { name: 'potato' } }, aisle: 'Fruit & veg' });
    expect(by('2 x milk').match).toMatchObject({ status: 'matched', ingredient: { name: 'milk' } });
    expect(by('2 x milk').aisle).toBe('Dairy & eggs');
    expect(by('eggs').match.status).toBe('matched');
    expect(by('OJ')).toMatchObject({ name: 'orange juice', aisle: 'Drinks' });
    expect(by('toms (tins) x3').aisle).toBe('Tins & jars');
    expect(by('500g flour').match).toMatchObject({ status: 'matched', ingredient: { name: 'plain flour' } });
    // Not in the ingredient catalogue: unmatched (free text), household goods get the Household aisle.
    expect(by('washing up liquid')).toMatchObject({ match: { status: 'unmatched' }, aisle: 'Household' });
  });

  it('carries transcription, notes, crossed-out and illegible flags through', async () => {
    const out = await runShoppingListScan({ images: [await jpeg()] }, { provider: mock() });
    if (!out.ok) throw new Error('scan failed');
    const by = (t: string) => out.rows.find((r) => r.originalText === t)!;
    expect(by('cheddar - if on offer').notes).toBe('if on offer');
    expect(by('butter').crossedOut).toBe(true);
    const bad = out.rows.find((r) => r.illegible)!;
    expect(bad).toMatchObject({ name: '', match: { status: 'unmatched' } });
    expect(by('eggs').quantity).toBeUndefined();
    expect(by('1kg spuds').quantity).toEqual({ kind: 'exact', value: 1, unit: 'kg' });
  });

  it('review state: crossed-out and illegible lines start excluded, written amounts are never invented', async () => {
    const out = await runShoppingListScan({ images: [await jpeg()] }, { provider: mock() });
    if (!out.ok) throw new Error('scan failed');
    const rows = out.rows.map(rowFromDto);
    const included = rows.filter((r) => r.include).map((r) => r.originalText);
    expect(included).not.toContain('butter');
    expect(included).not.toContain('choc b???');
    expect(included).toContain('eggs');
    const eggs = rows.find((r) => r.originalText === 'eggs')!;
    expect(eggs.value).toBe('');
    const commit = toCommitRows(rows);
    expect(commit.errors).toEqual({});
    expect(commit.rows.find((r) => r.name === 'egg')).toEqual(expect.not.objectContaining({ value: expect.anything() }));
    expect(commit.rows.find((r) => r.name === 'potato')).toMatchObject({ value: 1, unit: 'kg' });
  });

  it('a range line uses the larger number and says so', () => {
    const [row] = toListScanRows({ lines: [{ originalText: '2-3 lemons', name: 'lemons', quantity: { kind: 'range', min: 2, max: 3, unit: 'item', originalText: '2-3' }, crossedOut: false, illegible: false, confidence: 0.9, imageRef: 1 }], warnings: [] }, cat);
    const r = rowFromDto(row!);
    expect(r.value).toBe('3');
    expect(r.writtenHint).toMatch(/2-3/);
  });

  it('keyword aisle guess: household words only, never food', () => {
    expect(guessAisle('toilet roll')).toBe('Household');
    expect(guessAisle('mystery thing')).toBe('Other');
  });

  it('refuses no photos and more than four, and maps provider failures to a safe error', async () => {
    const none = await runShoppingListScan({ images: [] }, { provider: mock() });
    expect(none).toMatchObject({ ok: false, status: 400, error: { code: 'NO_IMAGES' } });
    const img = await jpeg();
    const many = await runShoppingListScan({ images: Array(5).fill(img) }, { provider: mock() });
    expect(many).toMatchObject({ ok: false, status: 400, error: { code: 'TOO_MANY_IMAGES' } });
    const failing = { scanShoppingList: async () => { throw new AiError('PROVIDER_AUTH'); } } as unknown as AiProvider;
    const bad = await runShoppingListScan({ images: [img] }, { provider: failing });
    expect(bad).toMatchObject({ ok: false, status: 502, error: { code: 'PROVIDER_AUTH' } });
  });

  it('sends only canonical ingredient names to the model (no household data)', async () => {
    let seen: unknown;
    const spy = { scanShoppingList: async (_i: unknown, c: unknown) => { seen = c; return { lines: [], warnings: [] } satisfies ShoppingListScan; } } as unknown as AiProvider;
    await runShoppingListScan({ images: [await jpeg()] }, { provider: spy });
    expect(Object.keys(seen as object)).toEqual(['ingredientNames']);
  });
});

describe('sanitising reviewed rows from the browser', () => {
  it('accepts good rows and degrades an unknown ingredient id to free text', () => {
    const r = sanitiseCommitRows([{ key: 'l1', name: ' Spuds ', ingredientId: 'not-real', value: 2, unit: 'kg', aisle: 'Fruit & veg' }], cat);
    expect(r).toEqual({ rows: [{ key: 'l1', name: 'Spuds', value: 2, unit: 'kg', aisle: 'Fruit & veg' }] });
    const m = sanitiseCommitRows([{ key: 'l2', name: 'ignored', ingredientId: ingId('milk') }], cat);
    expect('rows' in m && m.rows[0]).toMatchObject({ name: 'milk', ingredientId: ingId('milk'), aisle: 'Other' });
  });
  it('refuses empty, oversized, duplicate-keyed, nameless and bad-amount input', () => {
    expect(sanitiseCommitRows([], cat)).toHaveProperty('error');
    expect(sanitiseCommitRows('x', cat)).toHaveProperty('error');
    expect(sanitiseCommitRows(Array.from({ length: 151 }, (_, i) => ({ key: `k${i}`, name: 'x' })), cat)).toHaveProperty('error');
    expect(sanitiseCommitRows([{ key: 'a', name: 'x' }, { key: 'a', name: 'y' }], cat)).toHaveProperty('error');
    expect(sanitiseCommitRows([{ key: 'a', name: '  ' }], cat)).toHaveProperty('error');
    expect(sanitiseCommitRows([{ key: 'a', name: 'x', value: -1, unit: 'g' }], cat)).toHaveProperty('error');
    expect(sanitiseCommitRows([{ key: 'a', name: 'x', value: 1, unit: 'furlong' }], cat)).toHaveProperty('error');
    expect(sanitiseCommitRows([{ key: 'a', name: 'x', value: 1 }], cat)).toHaveProperty('error');
    expect(sanitiseCommitRows([{ key: 'a', name: 'x', value: 'abc', unit: 'g' }], cat)).toHaveProperty('error');
  });
  it('parses the destination; a new list falls back to a dated default name', () => {
    const now = new Date('2026-10-20T10:00:00Z');
    expect(parseDestination({ kind: 'current' }, now)).toEqual({ kind: 'current' });
    expect(parseDestination({ kind: 'new', name: '  Weekend   shop ' }, now)).toEqual({ kind: 'new', name: 'Weekend shop' });
    expect(parseDestination({ kind: 'new', name: '  ' }, now)).toEqual({ kind: 'new', name: 'Shopping list - 20 Oct' });
    expect(defaultNewListName(now)).toBe('Shopping list - 20 Oct');
    expect(parseDestination({ kind: 'weird' }, now)).toBeNull();
    expect(parseDestination(null, now)).toBeNull();
  });
});

const rowsFor = (...r: Array<Record<string, unknown>>) => {
  const s = sanitiseCommitRows(r, cat);
  if ('error' in s) throw new Error(s.error);
  return s.rows;
};

describe('merge preview (same engine function as confirm)', () => {
  it('combines quantities with an existing item of the same ingredient: before -> after', async () => {
    await seed('banana', 3, 'item');
    await seed('plain flour', 250, 'g');
    const p = await previewListScan(env, rowsFor(
      { key: 'a', name: 'banana', ingredientId: ingId('banana'), value: 6, unit: 'item' },
      { key: 'b', name: 'plain flour', ingredientId: ingId('plain flour'), value: 500, unit: 'g' },
    ), { kind: 'current' }, 'batch-0001');
    expect(p.merged).toBe(2);
    expect(p.added).toBe(0);
    expect(p.lines[0]).toMatchObject({ kind: 'merge', before: '3', after: '9' });
    expect(p.lines[1]).toMatchObject({ kind: 'merge', before: '250 g', after: '750 g' });
  });

  it('converts compatible units (kg onto g) and says new for things not on the list', async () => {
    await seed('plain flour', 500, 'g');
    const p = await previewListScan(env, rowsFor(
      { key: 'a', name: 'x', ingredientId: ingId('plain flour'), value: 1, unit: 'kg' },
      { key: 'b', name: 'x', ingredientId: ingId('milk'), value: 2, unit: 'l', aisle: 'Dairy & eggs' },
    ), { kind: 'current' }, 'batch-0002');
    expect(p.lines[0]).toMatchObject({ kind: 'merge', before: '500 g', after: '1500 g' });
    expect(p.lines[1]).toMatchObject({ kind: 'new', after: '2 l', aisle: 'Dairy & eggs' });
  });

  it('links a catalogue match to an existing hand-typed item of the same ingredient (no duplicate line)', async () => {
    await seed('Bananas', 2, 'item', false); // typed by hand: no ingredient id
    const p = await previewListScan(env, rowsFor({ key: 'a', name: 'banana', ingredientId: ingId('banana'), value: 4, unit: 'item' }), { kind: 'current' }, 'batch-0003');
    expect(p.lines[0]).toMatchObject({ kind: 'merge', name: 'Bananas', before: '2', after: '6' });
  });

  it('leaves an item with no written amount alone when it is already on the list, and adds it when it is not', async () => {
    await seed('eggs', 6, 'item');
    const p = await previewListScan(env, rowsFor(
      { key: 'a', name: 'egg', ingredientId: ingId('egg') },
      { key: 'b', name: 'butter', ingredientId: ingId('butter') },
    ), { kind: 'current' }, 'batch-0004');
    expect(p.lines[0]).toMatchObject({ kind: 'exists' });
    expect(p.lines[1]).toMatchObject({ kind: 'new', after: 'no amount' });
    expect(p.skipped).toBe(1);
    expect(p.added).toBe(1);
  });

  it('gives an amount to an item that was on the list without one (edit, not a second line)', async () => {
    await seed('eggs');
    const p = await previewListScan(env, rowsFor({ key: 'a', name: 'egg', ingredientId: ingId('egg'), value: 12, unit: 'item' }), { kind: 'current' }, 'batch-0005');
    expect(p.lines[0]).toMatchObject({ kind: 'merge', before: 'no amount', after: '12' });
  });

  it('folds repeated lines of one scan together', async () => {
    const p = await previewListScan(env, rowsFor(
      { key: 'a', name: 'milk', ingredientId: ingId('milk'), value: 1, unit: 'l' },
      { key: 'b', name: 'milk', ingredientId: ingId('milk'), value: 2, unit: 'l' },
    ), { kind: 'current' }, 'batch-0006');
    expect(p.lines[0]).toMatchObject({ kind: 'new', after: '1 l' });
    expect(p.lines[1]).toMatchObject({ kind: 'merge', before: '1 l', after: '3 l' });
  });

  it('warns when units cannot combine (separate line) and still adds it', async () => {
    await seed('Widget', 2, 'item', false);
    const p = await previewListScan(env, rowsFor({ key: 'a', name: 'Widget', value: 500, unit: 'g' }), { kind: 'current' }, 'batch-0007');
    expect(p.lines[0]).toMatchObject({ kind: 'new' });
    expect(p.lines[0]!.note).toMatch(/cannot be combined/);
  });

  it('is read-only: no commands logged, no list created, even for a new-list destination', async () => {
    await seed('milk', 1, 'l');
    const head = await repo.head(HH);
    await previewListScan(env, rowsFor({ key: 'a', name: 'milk', ingredientId: ingId('milk'), value: 1, unit: 'l' }), { kind: 'current' }, 'batch-0008');
    const p = await previewListScan(env, rowsFor({ key: 'a', name: 'milk', ingredientId: ingId('milk'), value: 1, unit: 'l' }), { kind: 'new', name: 'Weekend' }, 'batch-0008');
    expect(p.destination).toEqual({ kind: 'new', name: 'Weekend' });
    expect(p.lines[0]).toMatchObject({ kind: 'new' }); // a new list starts empty: nothing to merge with
    expect(await repo.head(HH)).toBe(head);
    expect((await repo.listLists(HH)).map((l) => l.name)).toEqual(['Shopping list']);
  });
});

describe('confirm: add to the current list', () => {
  it('combines quantities in the engine and reports what happened', async () => {
    await seed('banana', 3, 'item');
    const r = await confirmListScan(env, rowsFor(
      { key: 'a', name: 'banana', ingredientId: ingId('banana'), value: 6, unit: 'item' },
      { key: 'b', name: 'milk', ingredientId: ingId('milk'), value: 2, unit: 'l' },
    ), { kind: 'current' }, 'batch-1001');
    expect(r).toMatchObject({ added: 1, merged: 1, skipped: 0, created: false });
    expect(r.message).toBe('Added 1 new item, combined 1 with an item already on the list.');
    const bananas = await find('banana');
    expect(bananas).toHaveLength(1);
    expect(amount(bananas[0]!)).toBe('9');
    expect(amount((await find('milk'))[0]!)).toBe('2 l');
  });

  it('is idempotent: confirming the same batch twice (double submit) adds nothing the second time', async () => {
    await seed('banana', 3, 'item');
    const rows = rowsFor(
      { key: 'a', name: 'banana', ingredientId: ingId('banana'), value: 6, unit: 'item' },
      { key: 'b', name: 'milk', ingredientId: ingId('milk'), value: 2, unit: 'l' },
      { key: 'c', name: 'Mystery', value: 1, unit: 'pack' },
    );
    await confirmListScan(env, rows, { kind: 'current' }, 'batch-2001');
    const head = await repo.head(HH);
    const after1 = (await views()).map((v) => [v.item.displayName, amount(v)]);
    await confirmListScan(env, rows, { kind: 'current' }, 'batch-2001');
    await Promise.all([confirmListScan(env, rows, { kind: 'current' }, 'batch-2001'), confirmListScan(env, rows, { kind: 'current' }, 'batch-2001')]);
    expect(await repo.head(HH)).toBe(head);
    expect((await views()).map((v) => [v.item.displayName, amount(v)])).toEqual(after1);
  });

  it('two concurrent confirms of the same batch still add each row once', async () => {
    const rows = rowsFor({ key: 'a', name: 'milk', ingredientId: ingId('milk'), value: 2, unit: 'l' }, { key: 'b', name: 'butter', ingredientId: ingId('butter'), value: 250, unit: 'g' });
    await Promise.all([confirmListScan(env, rows, { kind: 'current' }, 'batch-2002'), confirmListScan(env, rows, { kind: 'current' }, 'batch-2002')]);
    expect(amount((await find('milk'))[0]!)).toBe('2 l');
    expect(await find('milk')).toHaveLength(1);
    expect(await find('butter')).toHaveLength(1);
  });

  it('a different batch is a different add (quantities combine again)', async () => {
    const rows = rowsFor({ key: 'a', name: 'milk', ingredientId: ingId('milk'), value: 2, unit: 'l' });
    await confirmListScan(env, rows, { kind: 'current' }, 'batch-3001');
    await confirmListScan(env, rows, { kind: 'current' }, 'batch-3002');
    expect(amount((await find('milk'))[0]!)).toBe('4 l');
  });

  it('records the actor and keeps the aisle / note on new items', async () => {
    await confirmListScan(env, rowsFor({ key: 'a', name: 'Cheddar', ingredientId: ingId('cheddar'), notes: 'if on offer', aisle: 'Dairy & eggs' }), { kind: 'current' }, 'batch-4001');
    const [v] = await find('cheddar');
    expect(v!.item).toMatchObject({ createdBy: ME, notes: 'if on offer', category: 'Dairy & eggs' });
  });

  it('other shoppers see the new items through the normal sync', async () => {
    const cursor = (await repo.snapshot(HH)).cursor;
    await confirmListScan(env, rowsFor({ key: 'a', name: 'milk', ingredientId: ingId('milk'), value: 2, unit: 'l' }), { kind: 'current' }, 'batch-5001');
    const res = await syncList(repo, HH, [], cursor, 'bob');
    expect(res.entries.map((e) => e.command.type)).toEqual(['add_item']);
  });
});

describe('confirm: create a new list', () => {
  it('creates the named list, archives the old one whole and adds the items to the new one', async () => {
    await seed('banana', 3, 'item');
    const r = await confirmListScan(env, rowsFor(
      { key: 'a', name: 'banana', ingredientId: ingId('banana'), value: 6, unit: 'item' },
      { key: 'b', name: 'milk', ingredientId: ingId('milk'), value: 2, unit: 'l' },
    ), { kind: 'new', name: 'Shopping list - 20 Oct' }, 'batch-6001');
    expect(r).toMatchObject({ created: true, added: 2, merged: 0, listName: 'Shopping list - 20 Oct' });
    expect(r.message).toBe('Created "Shopping list - 20 Oct": added 2 new items.');
    const lists = await repo.listLists(HH);
    expect(lists.map((l) => [l.name, l.status])).toEqual([['Shopping list - 20 Oct', 'active'], ['Shopping list', 'archived']]);
    // The new list has only the scanned items (6 bananas, NOT 9): quantities do not merge across lists.
    expect((await views()).map((v) => [v.item.displayName, amount(v)]).sort()).toEqual([['banana', '6'], ['milk', '2 l']]);
    // The old list is untouched.
    expect(await repo.activateList(HH, lists[1]!.id)).toBe(true);
    expect((await views()).map((v) => [v.item.displayName, amount(v)])).toEqual([['banana', '3']]);
  });

  it('is idempotent: a double submit makes one list and one set of items', async () => {
    const rows = rowsFor({ key: 'a', name: 'milk', ingredientId: ingId('milk'), value: 2, unit: 'l' });
    await confirmListScan(env, rows, { kind: 'new', name: 'Weekend' }, 'batch-7001');
    await confirmListScan(env, rows, { kind: 'new', name: 'Weekend' }, 'batch-7001');
    await Promise.all([confirmListScan(env, rows, { kind: 'new', name: 'Weekend' }, 'batch-7001'), confirmListScan(env, rows, { kind: 'new', name: 'Weekend' }, 'batch-7001')]);
    expect((await repo.listLists(HH)).map((l) => l.name)).toEqual(['Weekend', 'Shopping list']);
    expect((await views()).map((v) => [v.item.displayName, amount(v)])).toEqual([['milk', '2 l']]);
  });

  it('a second scan with a new batch makes a second list', async () => {
    const rows = rowsFor({ key: 'a', name: 'milk', ingredientId: ingId('milk'), value: 2, unit: 'l' });
    await confirmListScan(env, rows, { kind: 'new', name: 'One' }, 'batch-8001');
    await confirmListScan(env, rows, { kind: 'new', name: 'Two' }, 'batch-8002');
    expect((await repo.listLists(HH)).map((l) => [l.name, l.status])).toEqual([['Two', 'active'], ['One', 'archived'], ['Shopping list', 'archived']]);
  });

  it('household isolation: derived ids differ per household', () => {
    expect(derivedId('cmd', 'hh-1', 'batch', 'l1')).not.toBe(derivedId('cmd', 'hh-2', 'batch', 'l1'));
    expect(derivedId('cmd', 'hh-1', 'batch', 'l1')).toBe(derivedId('cmd', 'hh-1', 'batch', 'l1'));
    expect(derivedId('cmd', 'hh-1', 'batch', 'l1')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('planListScan is pure', () => {
  it('does not mutate the state it simulates over', async () => {
    await seed('banana', 3, 'item');
    const state = (await repo.snapshot(HH)).state;
    const frozen = JSON.stringify(state);
    planListScan(state, rowsFor({ key: 'a', name: 'banana', ingredientId: ingId('banana'), value: 6, unit: 'item' }), { householdId: HH, batchId: 'batch-9001', actor: ME, at, ctx, cat });
    expect(JSON.stringify(state)).toBe(frozen);
  });
});
