import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_CODES } from '@fr/product-sources';
import type { AuthOutcome } from '../../../../lib/server/auth/request-auth';

// The auth layer is exercised in lib/server/auth/request-auth.test.ts; here it is the routes' contract that matters.
let outcome: AuthOutcome;
const seen: Array<{ requested: string | undefined; authorization: string | null }> = [];
vi.mock('../../../../lib/server/auth/request-auth', () => ({
  resolveRequestAuth: async (req: Request, requested?: string) => {
    seen.push({ requested, authorization: req.headers.get('authorization') });
    return outcome;
  },
}));

const { POST: scan } = await import('./route');
const { POST: preview } = await import('./preview/route');
const { POST: confirm } = await import('./confirm/route');
const { getPantryService } = await import('../../../../lib/server/pantry/deps');
const { getIngredientCatalogue } = await import('../../../../lib/server/refdata/catalogue');
const { getProductSnapshotStore } = await import('../../../../lib/server/products/store');

const PNG = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
);
let hhSeq = 0;
/** A fresh household per test: the in-memory pantry is process-wide and keyed by household. */
const freshHousehold = () => `aa000000-0000-4000-8000-${String(++hhSeq).padStart(12, '0')}`;
let H = freshHousehold();
const who = (householdId: string, readOnly = false): AuthOutcome => ({ ok: true, auth: { userId: 'u1', householdId, readOnly, dataContext: null, defaultServings: 4 } });

function scanReq(opts: { householdId?: string; files?: number; focus?: string } = {}) {
  const form = new FormData();
  for (let i = 0; i < (opts.files ?? 1); i++) form.append('images', new File([PNG], `p${i}.png`, { type: 'image/png' }));
  if (opts.householdId) form.append('householdId', opts.householdId);
  if (opts.focus) form.append('focus', opts.focus);
  return new Request('http://t/api/pantry/scan', { method: 'POST', body: form, headers: { authorization: 'Bearer good' } });
}
const json = (path: string, body: unknown) =>
  new Request(`http://t${path}`, { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'content-type': 'application/json', authorization: 'Bearer good' } });

async function stockOf(hh: string) {
  const view = await getPantryService(hh).getView(hh);
  return view.categories.flatMap((c) => c.items);
}

beforeEach(() => {
  seen.length = 0;
  H = freshHousehold();
  outcome = who(H);
});

describe('POST /api/pantry/scan (web cookie or Android bearer, D343)', () => {
  it('rejects an unauthenticated caller and a non-member before any scan', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    const res = await scan(scanReq({ householdId: H }));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    outcome = { ok: false, status: 403, message: 'not a member' };
    expect((await scan(scanReq({ householdId: H }))).status).toBe(403);
    expect(seen.at(-1)).toEqual({ requested: H, authorization: 'Bearer good' });
  });

  it('refuses a read-only household', async () => {
    outcome = who(H, true);
    const res = await scan(scanReq({ householdId: H }));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('READ_ONLY');
  });

  it('validates the upload: no photos, more than 10, an unreadable body', async () => {
    expect((await scan(scanReq({ files: 0 }))).status).toBe(400);
    expect((await scan(scanReq({ files: 11 }))).status).toBe(400);
    const notForm = new Request('http://t/api/pantry/scan', { method: 'POST', body: 'x', headers: { 'content-type': 'text/plain' } });
    expect((await scan(notForm)).status).toBe(400);
  });

  it('scans with the mock provider and writes nothing; a web caller without householdId still works', async () => {
    const before = await stockOf(H);
    const res = await scan(scanReq());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ key: string; name: string; match: { status: string } }>; warnings: string[] };
    expect(body.rows.length).toBeGreaterThan(0);
    expect(body.rows[0]).toHaveProperty('match.status');
    expect(seen.at(-1)?.requested).toBeUndefined();
    expect(await stockOf(H)).toEqual(before);
  });

  it('a close-up is a single photo with a focus name', async () => {
    expect((await scan(scanReq({ householdId: H, files: 2, focus: 'milk' }))).status).toBe(400);
    const res = await scan(scanReq({ householdId: H, focus: 'milk' }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ key: string }> };
    expect(body.rows.every((r) => r.key.startsWith('c'))).toBe(true);
  });
});

describe('POST /api/pantry/scan/preview and /confirm', () => {
  it('auth: 401 and read-only (confirm only; preview is read-only)', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await preview(json('/api/pantry/scan/preview', { householdId: H, rows: [] }))).status).toBe(401);
    expect((await confirm(json('/api/pantry/scan/confirm', { householdId: H, rows: [] }))).status).toBe(401);
    outcome = who(H, true);
    expect((await preview(json('/api/pantry/scan/preview', { householdId: H, rows: [] }))).status).toBe(200);
    const ro = await confirm(json('/api/pantry/scan/confirm', { householdId: H, rows: [{ key: 'a', name: 'x', value: 1, unit: 'item' }] }));
    expect(ro.status).toBe(403);
    expect((await ro.json()).error.code).toBe('READ_ONLY');
    expect(seen.at(-1)?.requested).toBe(H);
  });

  it('bad input: not JSON, no rows array, rows the service refuses (422, nothing written)', async () => {
    expect((await preview(json('/api/pantry/scan/preview', 'nope'))).status).toBe(400);
    expect((await confirm(json('/api/pantry/scan/confirm', { householdId: H }))).status).toBe(400);
    const before = await stockOf(H);
    const bad = await confirm(json('/api/pantry/scan/confirm', { householdId: H, rows: [{ key: 'a', ingredientId: 'no-such-id', value: 1, unit: 'item' }] }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.code).toBe('REFUSED');
    const badDate = await preview(json('/api/pantry/scan/preview', { householdId: H, rows: [{ key: 'a', name: 'jam', value: 1, unit: 'item', expiry: '2026-02-30' }] }));
    expect(badDate.status).toBe(422);
    expect((await confirm(json('/api/pantry/scan/confirm', { householdId: H, rows: [] }))).status).toBe(422);
    expect(await stockOf(H)).toEqual(before);
  });

  it('preview shows exactly what confirm writes: a merge into existing stock and a new line, written once', async () => {
    const pasta = (await stockOf(H)).find((i) => i.name === 'pasta')!;
    expect(pasta.quantityLabel).toBe('500 g');
    const rows = [
      { key: 's1', ingredientId: pasta.ingredientId, value: 500, unit: 'g' },
      { key: 's2', name: 'Elderflower cordial', value: 1, unit: 'item', expiry: '2027-01-31' },
    ];
    const pv = await preview(json('/api/pantry/scan/preview', { householdId: H, rows }));
    expect(pv.status).toBe(200);
    const { lines } = (await pv.json()) as { lines: Array<{ key: string; kind: string; before?: string; after: string }> };
    expect(lines).toEqual([
      expect.objectContaining({ key: 's1', kind: 'merge', before: '500 g', after: '1000 g' }),
      expect.objectContaining({ key: 's2', kind: 'new', after: '1 item' }),
    ]);
    // The preview wrote nothing.
    expect((await stockOf(H)).find((i) => i.name === 'pasta')!.quantityLabel).toBe('500 g');

    const count = (await stockOf(H)).length;
    const cf = await confirm(json('/api/pantry/scan/confirm', { householdId: H, rows }));
    expect(cf.status).toBe(200);
    expect(await cf.json()).toMatchObject({ ok: true, message: 'Added 2 items to your pantry', linked: 0 });
    const after = await stockOf(H);
    expect(after.find((i) => i.name === 'pasta')!.quantityLabel).toBe('1000 g');
    expect(after.filter((i) => i.name === 'Elderflower cordial')).toEqual([expect.objectContaining({ quantityLabel: '1 item', expiry: '2027-01-31' })]);
    expect(after.length).toBe(count + 1);
  });

  it('a double submit with the same submissionId writes once, even when both arrive together', async () => {
    const rows = [{ key: 's1', name: 'Oat milk', value: 1, unit: 'l' }];
    const body = { householdId: H, rows, submissionId: 'review-1' };
    const [a, b] = await Promise.all([confirm(json('/api/pantry/scan/confirm', body)), confirm(json('/api/pantry/scan/confirm', body))]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    const again = await confirm(json('/api/pantry/scan/confirm', body));
    expect(await again.json()).toMatchObject({ ok: true });
    expect((await stockOf(H)).filter((i) => i.name === 'Oat milk').map((i) => i.quantityLabel)).toEqual(['1 l']);
    // Another household's identical id is its own submission.
    const other = freshHousehold();
    outcome = who(other);
    await confirm(json('/api/pantry/scan/confirm', { ...body, householdId: other }));
    expect((await stockOf(other)).filter((i) => i.name === 'Oat milk')).toHaveLength(1);
    // Without an id, a repeat is a second add (the web action's behaviour; a free-text line is not merged).
    outcome = who(H);
    await confirm(json('/api/pantry/scan/confirm', { householdId: H, rows }));
    expect((await stockOf(H)).filter((i) => i.name === 'Oat milk').map((i) => i.quantityLabel)).toEqual(['1 l', '1 l']);
  });

  it('a barcode row matched to an ingredient links the product on confirm (D187)', async () => {
    const beans = getIngredientCatalogue().all.find((i) => i.name === 'baked beans')!;
    const rows = [{ key: 'rp-1', ingredientId: beans.id, value: 2, unit: 'can', barcode: FIXTURE_CODES.bakedBeans }];
    const res = await confirm(json('/api/pantry/scan/confirm', { householdId: H, rows, submissionId: 'beans' }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, linked: 1 });
    expect(getProductSnapshotStore().list(H)).toEqual([expect.objectContaining({ barcode: FIXTURE_CODES.bakedBeans, ingredientId: beans.id })]);
  });
});
