import {
  MAX_SCAN_PHOTOS, createPantryScanClient, isIsoDate, parseConfirm, parsePreview, parseScanLookup, parseScanResult, parseScanRow,
} from '@/lib/pantryScanApi';
import { summariseProduct } from '@/lib/productApi';
import { ServerApiError, type ServerApi } from '@/lib/serverApi';
import type { UploadImage } from '@/lib/extraction';
import { formParts } from './helpers/formParts';

jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));

const partsOf = (form: FormData) => formParts(form);

function fakeApi(answer: unknown) {
  const calls: Array<{ kind: 'post' | 'form'; path: string; body: unknown }> = [];
  const api: ServerApi = {
    configured: true,
    get: async () => { throw new Error('unused'); },
    post: async (path, body) => { calls.push({ kind: 'post', path, body }); return answer as never; },
    postForm: async (path, form) => { calls.push({ kind: 'form', path, body: form }); return answer as never; },
    webUrl: () => null,
    authHeaders: async () => ({}),
  };
  return { api, calls };
}
const img = (i: number): UploadImage => ({ uri: `file://p${i}.jpg`, width: 10, height: 10, name: `page-${i}.jpg`, mimeType: 'image/jpeg' });

describe('pantry scan parsers (defensive)', () => {
  it('keeps a well-formed row and clamps / defaults the rest', () => {
    const r = parseScanRow({
      key: 's1', name: ' pasta ', form: 'weird', packaging: 'tin', count: -2, confidence: 4, useBy: '2026-02-30', bestBefore: '2027-01-01',
      packSize: { value: 400, unit: 'g' }, frameRefs: [1, 'x', 2], needsCloseUp: true, match: { status: 'matched', ingredient: { id: 'i', name: 'pasta', category: 'pasta_rice_grains' } },
    });
    expect(r).toMatchObject({ key: 's1', name: 'pasta', form: 'other', packaging: 'tin', count: 1, confidence: 1, bestBefore: '2027-01-01', packSize: { value: 400, unit: 'g' }, frameRefs: [1, 2], needsCloseUp: true, datesLegible: false });
    expect(r).not.toHaveProperty('useBy'); // not a real date
    expect(r?.match).toEqual({ status: 'matched', ingredient: { id: 'i', name: 'pasta', category: 'pasta_rice_grains' } });
  });

  it('drops rows without a key or a name, and reads an unknown match as unmatched', () => {
    expect(parseScanRow({ name: 'x' })).toBeNull();
    expect(parseScanRow({ key: 'k', name: '  ' })).toBeNull();
    expect(parseScanRow('nope')).toBeNull();
    expect(parseScanRow({ key: 'k', name: 'x', match: { status: 'ambiguous', candidates: [] } })?.match).toEqual({ status: 'unmatched', suggestions: [] });
    const res = parseScanResult({ rows: [{ key: 'a', name: 'a' }, null, { name: 'b' }], warnings: ['w', 3], provider: { label: 'Mock', isMock: true } });
    expect(res.rows.map((r) => r.key)).toEqual(['a']);
    expect(res.warnings).toEqual(['w']);
    expect(res.provider).toEqual({ label: 'Mock', isMock: true, configured: true });
    expect(() => parseScanResult({})).toThrow(ServerApiError);
  });

  it('preview lines, confirm result and ISO dates', () => {
    expect(parsePreview({ lines: [{ key: 'a', name: 'pasta', kind: 'merge', before: '500 g', after: '1000 g' }, { key: 'b', kind: 'odd', after: 'x' }, { key: 'c', kind: 'new', after: '1 item', note: 'n' }] }))
      .toEqual([{ key: 'a', name: 'pasta', kind: 'merge', before: '500 g', after: '1000 g' }, { key: 'c', name: '', kind: 'new', after: '1 item', note: 'n' }]);
    expect(() => parsePreview([])).toThrow(ServerApiError);
    expect(parseConfirm({ ok: true, message: 'Added 2 items to your pantry', linked: 1 })).toEqual({ message: 'Added 2 items to your pantry', linked: 1 });
    expect(() => parseConfirm({ ok: false })).toThrow(ServerApiError);
    expect(isIsoDate('2026-10-31')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('31/10/2026')).toBe(false);
  });

  it('a product lookup becomes review input; summariseProduct carries it', () => {
    const body = {
      product: { barcode: '5009000000015', name: 'Baked Beans', brand: 'Hearth', packSize: { kind: 'exact', value: 415, unit: 'g' }, packSizeText: '415 g', categories: ['en:canned-foods'], nutrition: { per: 'g', per100: [] }, allergens: { status: 'listed', contains: ['milk'] } },
      match: { status: 'matched', ingredient: { id: 'ing-beans', name: 'baked beans', category: 'tinned_jarred' } },
    };
    const l = parseScanLookup(body)!;
    expect(l.product).toMatchObject({ barcode: '5009000000015', packSize: { value: 415, unit: 'g' }, categories: ['en:canned-foods'], allergenText: 'Contains: Milk' });
    expect(l.match.status).toBe('matched');
    expect(parseScanLookup({ product: { name: 'x' } })).toBeNull();
    expect(summariseProduct(body).review?.product.barcode).toBe('5009000000015');
  });
});

describe('createPantryScanClient', () => {
  it('sends the photos as images[] with householdId (and focus for a close-up), at most 10', async () => {
    const { api, calls } = fakeApi({ rows: [], warnings: [] });
    const c = createPantryScanClient(api);
    await c.scan('hh-1', [img(1), img(2)]);
    expect(calls[0]!.path).toBe('/api/pantry/scan');
    const parts = partsOf(calls[0]!.body as FormData);
    expect(parts.filter(([k]) => k === 'householdId').map(([, v]) => v)).toEqual(['hh-1']);
    expect(parts.filter(([k]) => k === 'images')).toHaveLength(2);
    expect(parts.some(([k]) => k === 'focus')).toBe(false);

    await c.scan('hh-1', [img(1)], 'milk');
    expect(partsOf(calls[1]!.body as FormData).find(([k]) => k === 'focus')![1]).toBe('milk');

    await expect(c.scan('hh-1', Array.from({ length: MAX_SCAN_PHOTOS + 1 }, (_, i) => img(i)))).rejects.toThrow(/up to 10/);
    await expect(c.scan('hh-1', [])).rejects.toThrow(ServerApiError);
    expect(calls).toHaveLength(2);
  });

  it('preview and confirm post JSON with the household; confirm carries the submission id', async () => {
    const { api, calls } = fakeApi({ ok: true, lines: [], message: 'Added', linked: 0 });
    const c = createPantryScanClient(api);
    const rows = [{ key: 'a', name: 'jam', value: 1, unit: 'item' }];
    await c.preview('hh-1', rows);
    await c.confirm('hh-1', rows, 'sub-1');
    expect(calls).toEqual([
      { kind: 'post', path: '/api/pantry/scan/preview', body: { householdId: 'hh-1', rows } },
      { kind: 'post', path: '/api/pantry/scan/confirm', body: { householdId: 'hh-1', rows, submissionId: 'sub-1' } },
    ]);
  });
});
