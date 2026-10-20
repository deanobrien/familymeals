import {
  BadResponseError, confirmScan, newBatchId, parseConfirm, parsePreview, parseScanOutcome, previewScan, scanList, toCommitRows,
  type ScanRow,
} from '@/lib/listScanApi';
import { changeLists, fetchLists, parseLists } from '@/lib/shoppingListsApi';
import type { ServerApi } from '@/lib/serverApi';
import { formParts } from './helpers/formParts';

function fakeApi(responses: Record<string, unknown> = {}) {
  const api = {
    configured: true,
    get: jest.fn(async (p: string) => responses[p] as never),
    post: jest.fn(async (p: string) => responses[p] as never),
    postForm: jest.fn(async (p: string) => responses[p] as never),
    webUrl: () => null,
    authHeaders: async () => ({}),
  };
  return api satisfies ServerApi;
}

const rawRow = (over: Record<string, unknown> = {}) => ({
  key: 'r1', originalText: '2 spuds', name: 'potatoes', quantity: { kind: 'exact', value: 2, unit: 'item' },
  crossedOut: false, illegible: false, confidence: 0.9, imageRef: 1,
  match: { status: 'matched', ingredient: { id: 'ing-potato', name: 'potato', category: 'fruit_veg' } }, aisle: 'Fruit & veg', ...over,
});

describe('parseScanOutcome', () => {
  it('maps rows, title and warnings; crossed out and illegible start excluded', () => {
    const out = parseScanOutcome({
      title: ' Saturday shop ', warnings: ['blurry', 7],
      rows: [
        rawRow(),
        rawRow({ key: 'r2', originalText: 'milk', name: 'milk', crossedOut: true, quantity: undefined, match: { status: 'none' } }),
        rawRow({ key: 'r3', originalText: '???', name: '', illegible: true }),
        rawRow({ key: 'r4', name: 'flour', quantity: { kind: 'range', min: 1, max: 2, unit: 'kg' } }),
        rawRow({ key: 'r5', name: 'cheese', quantity: { kind: 'approximate', approxLabel: 'a block' } }),
        'junk',
      ],
    });
    expect(out.title).toBe('Saturday shop');
    expect(out.warnings).toEqual(['blurry']);
    expect(out.rows.map((r) => [r.key, r.include])).toEqual([['r1', true], ['r2', false], ['r3', false], ['r4', true], ['r5', true]]);
    expect(out.rows[0]).toMatchObject({ name: 'potatoes', value: '2', unit: 'item', ingredientId: 'ing-potato', ingredientName: 'potato', aisle: 'Fruit & veg' });
    expect(out.rows[3]).toMatchObject({ value: '2', unit: 'kg' });
    expect(out.rows[3]!.hint).toMatch(/1-2.*larger/);
    expect(out.rows[4]!.hint).toMatch(/a block/);
    expect(out.rows[4]!.value).toBe('');
  });

  it('makes duplicate keys unique and refuses a response without rows', () => {
    const out = parseScanOutcome({ rows: [rawRow(), rawRow()] });
    expect(new Set(out.rows.map((r) => r.key)).size).toBe(2);
    expect(() => parseScanOutcome({})).toThrow(BadResponseError);
    expect(() => parseScanOutcome(null)).toThrow(BadResponseError);
  });
});

describe('toCommitRows', () => {
  const base = (over: Partial<ScanRow>): ScanRow => ({
    key: 'a', originalText: 'x', name: 'Potato', value: '', unit: 'item', notes: '', aisle: 'Fruit & veg', crossedOut: false,
    illegible: false, confidence: 1, imageRef: 1, include: true, ...over,
  });

  it('sends only included rows, keeps the ingredient link while the name is unchanged', () => {
    const b = toCommitRows([
      base({ key: 'a', name: 'potato', value: '2', unit: 'kg', ingredientId: 'ing-potato', ingredientName: 'Potato', notes: ' new ' }),
      base({ key: 'b', name: 'Maris Piper potatoes', ingredientId: 'ing-potato', ingredientName: 'potato' }),
      base({ key: 'c', name: 'skipped', include: false }),
    ]);
    expect(b.errors).toEqual({});
    expect(b.rows).toEqual([
      { key: 'a', name: 'potato', aisle: 'Fruit & veg', ingredientId: 'ing-potato', value: 2, unit: 'kg', notes: 'new' },
      { key: 'b', name: 'Maris Piper potatoes', aisle: 'Fruit & veg' },
    ]);
  });

  it('reports a message for a nameless row and a bad quantity (decimal comma allowed)', () => {
    const b = toCommitRows([base({ key: 'a', name: '  ' }), base({ key: 'b', value: '-1' }), base({ key: 'c', value: 'abc' }), base({ key: 'd', value: '1,5', unit: 'l' })]);
    expect(Object.keys(b.errors)).toEqual(['a', 'b', 'c']);
    expect(b.rows).toEqual([{ key: 'd', name: 'Potato', aisle: 'Fruit & veg', value: 1.5, unit: 'l' }]);
  });
});

describe('batch id', () => {
  it('matches the server rule and is unique per session', () => {
    const a = newBatchId();
    expect(a).toMatch(/^[\w-]{8,64}$/);
    expect(newBatchId()).not.toBe(a);
  });
});

describe('preview / confirm parsing and calls', () => {
  it('parsePreview is defensive', () => {
    const p = parsePreview({ preview: { destination: { kind: 'new', name: 'Shop' }, added: 1, merged: 1, skipped: 0, lines: [
      { key: 'a', name: 'milk', kind: 'merge', before: '1 l', after: '2 l', aisle: 'Dairy & eggs' }, { key: 'b', name: 'x', kind: 'weird', after: '' }, 3,
    ] } });
    expect(p.destination).toEqual({ kind: 'new', name: 'Shop' });
    expect(p.lines.map((l) => l.kind)).toEqual(['merge', 'new']);
    expect(p.lines[0]).toMatchObject({ before: '1 l', after: '2 l' });
    expect(() => parsePreview({})).toThrow(BadResponseError);
  });

  it('parseConfirm needs ok', () => {
    expect(parseConfirm({ ok: true, message: 'Done', listName: 'L', created: true, added: 2 })).toMatchObject({ message: 'Done', created: true, added: 2, merged: 0 });
    expect(() => parseConfirm({ ok: false })).toThrow(BadResponseError);
  });

  it('scanList posts up to four photos plus the household as multipart', async () => {
    const api = fakeApi({ '/api/shopping/scan': { rows: [rawRow()], warnings: [] } });
    const imgs = [1, 2, 3, 4].map((i) => ({ uri: `file:///${i}.jpg`, width: 10, height: 10, name: `page-${i}.jpg`, mimeType: 'image/jpeg' as const }));
    const out = await scanList(api, 'hh-1', imgs);
    expect(out.rows).toHaveLength(1);
    const parts = formParts((api.postForm.mock.calls[0] as unknown as [string, unknown])[1]);
    expect(parts.filter(([k]) => k === 'images')).toHaveLength(4);
    expect(parts.find(([k]) => k === 'householdId')![1]).toBe('hh-1');
  });

  it('preview and confirm post rows, destination and batch id', async () => {
    const api = fakeApi({
      '/api/shopping/scan/preview': { preview: { destination: { kind: 'current', name: 'L' }, lines: [], added: 0, merged: 0, skipped: 0 } },
      '/api/shopping/scan/confirm': { ok: true, message: 'ok', listName: 'L', created: false, added: 1, merged: 0, skipped: 0 },
    });
    const rows = [{ key: 'a', name: 'tea' }];
    await previewScan(api, 'hh', rows, { kind: 'current' }, 'batch-0001');
    await confirmScan(api, 'hh', rows, { kind: 'new', name: 'N' }, 'batch-0001');
    expect(api.post).toHaveBeenNthCalledWith(1, '/api/shopping/scan/preview', { householdId: 'hh', rows, destination: { kind: 'current' }, batchId: 'batch-0001' });
    expect(api.post).toHaveBeenNthCalledWith(2, '/api/shopping/scan/confirm', { householdId: 'hh', rows, destination: { kind: 'new', name: 'N' }, batchId: 'batch-0001' });
  });
});

describe('shopping lists client', () => {
  const lists = { lists: [{ id: 'l1', name: 'Weekly', status: 'active', active: true, archived: false, updatedAt: '2026-10-20T10:00:00Z' }, { id: 'l2', name: 'Old', status: 'archived', updatedAt: '' }, { nope: 1 }] };

  it('parses defensively', () => {
    expect(parseLists(lists).map((l) => [l.id, l.active, l.archived])).toEqual([['l1', true, false], ['l2', false, true]]);
    expect(parseLists(null)).toEqual([]);
  });

  it('fetches with the household and posts the action', async () => {
    const api = fakeApi({ '/api/shopping/lists': lists });
    expect(await fetchLists(api, 'hh')).toHaveLength(2);
    expect(api.get).toHaveBeenCalledWith('/api/shopping/lists', { householdId: 'hh' });
    await changeLists(api, 'hh', { action: 'rename', listId: 'l1', name: 'X' });
    expect(api.post).toHaveBeenCalledWith('/api/shopping/lists', { householdId: 'hh', action: 'rename', listId: 'l1', name: 'X' });
  });
});
