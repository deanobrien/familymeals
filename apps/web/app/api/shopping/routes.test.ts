import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../../../lib/server/auth/request-auth';

let outcome: AuthOutcome;
vi.mock('../../../lib/server/auth/request-auth', () => ({ resolveRequestAuth: async () => outcome }));

const lists = await import('./lists/route');
const preview = await import('./scan/preview/route');
const confirm = await import('./scan/confirm/route');
const { getShoppingStore } = await import('../../../lib/server/shopping/store');
let n = 0;
let H = '';

beforeEach(() => {
  H = `cc${String(++n).padStart(6, '0')}-0000-4000-8000-0000000000cc`;
  outcome = { ok: true, auth: { userId: 'u', householdId: H, readOnly: false, dataContext: null, defaultServings: 4 } };
});

const json = (url: string, body: unknown) =>
  new Request(`http://t${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const postList = (body: Record<string, unknown>) => lists.POST(json('/api/shopping/lists', { householdId: H, ...body }));
type L = { id: string; name: string; status: string; active: boolean; archived: boolean };
const getLists = async (): Promise<L[]> => ((await (await lists.GET(new Request(`http://t/api/shopping/lists?householdId=${H}`))).json()) as { lists: L[] }).lists;
const errOf = async (r: Response) => ((await r.json()) as { error: { code: string; message: string } }).error;

describe('auth', () => {
  it('401 for every route when signed out; 403 for a household that is not the caller\'s', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await lists.GET(new Request('http://t/api/shopping/lists'))).status).toBe(401);
    expect((await postList({ action: 'archive' })).status).toBe(401);
    expect((await preview.POST(json('/p', { householdId: H }))).status).toBe(401);
    expect((await confirm.POST(json('/c', { householdId: H }))).status).toBe(401);
    outcome = { ok: false, status: 403, message: 'not a member' };
    expect((await postList({ action: 'archive' })).status).toBe(403);
  });

  it('read-only households can read and preview but not write', async () => {
    outcome = { ok: true, auth: { userId: 'u', householdId: H, readOnly: true, dataContext: null, defaultServings: 4 } };
    const w = await postList({ action: 'create', name: 'x' });
    expect(w.status).toBe(403);
    expect((await errOf(w)).code).toBe('READ_ONLY');
    expect((await lists.GET(new Request(`http://t/api/shopping/lists?householdId=${H}`))).status).toBe(200);
    const body = { householdId: H, rows: [{ key: 'a', name: 'tea' }], destination: { kind: 'current' }, batchId: 'batch-ro-001' };
    expect((await confirm.POST(json('/c', body))).status).toBe(403);
    expect((await preview.POST(json('/p', body))).status).toBe(200);
  });
});

describe('lists', () => {
  it('create, rename, switch and archive round trip', async () => {
    expect((await postList({ action: 'create', name: '  Weekend   shop ' })).status).toBe(200);
    let ls = await getLists();
    expect(ls).toHaveLength(2); // a fresh household starts with its default list, which the new one archives
    expect(ls[0]).toMatchObject({ name: 'Weekend shop', active: true, archived: false, status: 'active' });
    const first = ls[0]!.id;

    await postList({ action: 'create', name: 'Party' });
    ls = await getLists();
    expect(ls.find((l) => l.active)?.name).toBe('Party');
    expect(ls.find((l) => l.id === first)?.archived).toBe(true);

    expect((await postList({ action: 'rename', listId: ls.find((l) => l.active)!.id, name: 'Party 2' })).status).toBe(200);
    expect((await postList({ action: 'switch', listId: first })).status).toBe(200);
    ls = await getLists();
    expect(ls.find((l) => l.active)?.id).toBe(first);
    expect(ls.find((l) => l.name === 'Party 2')?.archived).toBe(true);

    expect((await postList({ action: 'archive' })).status).toBe(200);
    expect((await getLists()).some((l) => l.active)).toBe(false);
  });

  it('refuses bad input with the web messages', async () => {
    const blank = await postList({ action: 'create', name: '   ' });
    expect(blank.status).toBe(400);
    expect((await errOf(blank)).message).toBe('Give the list a name.');
    expect((await errOf(await postList({ action: 'rename', listId: 'nope', name: 'x' }))).message).toBe('That list could not be found.');
    expect((await errOf(await postList({ action: 'rename', listId: 'nope', name: ' ' }))).message).toBe('Give the list a name.');
    expect((await errOf(await postList({ action: 'switch', listId: 'nope' }))).message).toBe('That list could not be found.');
    expect((await postList({ action: 'archive' })).status).toBe(200);
    expect((await errOf(await postList({ action: 'archive' }))).message).toBe('There is no current list to archive.');
    expect((await postList({ action: 'explode' })).status).toBe(400);
    expect((await lists.POST(new Request('http://t/api/shopping/lists', { method: 'POST', body: 'nope' }))).status).toBe(400);
  });
});

describe('scan preview and confirm', () => {
  const body = (extra: Record<string, unknown> = {}) => ({
    householdId: H,
    rows: [{ key: 'a', name: 'Digestive biscuits', value: 2, unit: 'item' }, { key: 'b', name: 'tea bags' }],
    destination: { kind: 'current' },
    batchId: `batch-${n}-0001`,
    ...extra,
  });
  const items = async () => Object.values((await getShoppingStore().snapshot(H)).state.items).filter((i) => !i.removed);

  it('preview writes nothing, not even a new list', async () => {
    const before = (await getLists()).length;
    const res = await preview.POST(json('/p', body({ destination: { kind: 'new', name: 'Scanned' } })));
    expect(res.status).toBe(200);
    const p = ((await res.json()) as { preview: { lines: unknown[]; added: number; destination: { kind: string; name: string } } }).preview;
    expect(p.lines).toHaveLength(2);
    expect(p.added).toBe(2);
    expect(p.destination).toEqual({ kind: 'new', name: 'Scanned' });
    expect(await items()).toHaveLength(0);
    expect(await getLists()).toHaveLength(before);
  });

  it('confirm adds once; a repeated batchId adds nothing twice', async () => {
    const b = body();
    const a = await confirm.POST(json('/c', b));
    expect(a.status).toBe(200);
    expect(((await a.json()) as { created: boolean }).created).toBe(false);
    const count = (await items()).length;
    expect(count).toBe(2);
    expect((await confirm.POST(json('/c', b))).status).toBe(200);
    expect(await items()).toHaveLength(count);
  });

  it('destination new creates a named list (idempotent on the batch) and a blank name gets a default', async () => {
    const b = body({ destination: { kind: 'new', name: 'Saturday shop' } });
    const r = (await (await confirm.POST(json('/c', b))).json()) as { created: boolean; listName: string };
    expect(r).toMatchObject({ created: true, listName: 'Saturday shop' });
    await confirm.POST(json('/c', b));
    expect((await getLists()).filter((l) => l.name === 'Saturday shop')).toHaveLength(1);
    expect(await items()).toHaveLength(2);

    const d = (await (await confirm.POST(json('/c', body({ batchId: `batch-${n}-0002`, destination: { kind: 'new', name: '  ' } })))).json()) as { listName: string };
    expect(d.listName).toMatch(/^Shopping list - /);
  });

  it('sanitises bad rows, destinations and batch ids', async () => {
    for (const bad of [
      body({ rows: [] }),
      body({ rows: 'x' }),
      body({ rows: [{ key: 'a', name: 'x', value: -1, unit: 'item' }] }),
      body({ rows: [{ key: 'a', name: 'x', value: 1, unit: 'parsec' }] }),
      body({ rows: [{ key: 'a', name: '' }] }),
      body({ rows: [{ key: 'a', name: 'x' }, { key: 'a', name: 'y' }] }),
      body({ destination: { kind: 'elsewhere' } }),
      body({ batchId: 'x' }),
    ]) {
      expect((await preview.POST(json('/p', bad))).status).toBe(400);
      expect((await confirm.POST(json('/c', bad))).status).toBe(400);
    }
    expect(await items()).toHaveLength(0);
    // An unknown ingredient id degrades to free text instead of failing.
    const ok = await confirm.POST(json('/c', body({ rows: [{ key: 'a', name: 'mystery', ingredientId: 'nope' }] })));
    expect(ok.status).toBe(200);
  });
});
