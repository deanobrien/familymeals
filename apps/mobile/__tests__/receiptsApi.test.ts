import {
  confirmReceipt,
  formatPence,
  getReceipt,
  listReceipts,
  parseConfirmSummary,
  parseReceiptDetail,
  parseReceiptList,
  parseReview,
  photoSource,
  uploadReceipt,
} from '@/lib/receiptsApi';
import { ServerApiError, type ServerApi } from '@/lib/serverApi';

jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));

function fakeApi(over: Partial<ServerApi> = {}): ServerApi & { get: jest.Mock; post: jest.Mock; postForm: jest.Mock } {
  return {
    configured: true,
    get: jest.fn(),
    post: jest.fn(),
    postForm: jest.fn(),
    webUrl: (p: string) => `http://web.test${p}`,
    authHeaders: async () => ({ Authorization: 'Bearer tok' }),
    ...over,
  } as ServerApi & { get: jest.Mock; post: jest.Mock; postForm: jest.Mock };
}

const reviewJson = {
  receiptId: 'r1',
  retailer: 'Tesco',
  date: '2026-10-19',
  totalPence: 500,
  computedPence: 480,
  discrepancyPence: 20,
  totalOk: false,
  linesMissingPrice: 1,
  status: 'needs_review',
  lines: [
    {
      lineId: 'l1', raw: 'RED LENTILS 500G', description: 'red lentils', count: 2, packLabel: '500 g', pricePence: 150, discountPence: 20,
      discountLines: ['Clubcard'], netPence: 130, classification: 'confident', preselectedItemId: 'i1',
      candidates: [{ itemId: 'i1', name: 'red lentils', score: 0.9, reasons: ['name match'] }], defaultQuantity: { value: 1000, unit: 'g' },
    },
  ],
  items: [{ shoppingListItemId: 'i1', name: 'red lentils' }],
  ignored: ['CARRIER BAG'],
  warnings: ['One line was unclear'],
};

describe('formatPence', () => {
  it('formats integer pence as pounds', () => {
    expect(formatPence(5)).toBe('£0.05');
    expect(formatPence(1234)).toBe('£12.34');
    expect(formatPence(-130)).toBe('-£1.30');
  });
});

describe('parsers are defensive', () => {
  it('parses a list and drops malformed entries', () => {
    const out = parseReceiptList({ receipts: [{ id: 'a', retailer: 'Aldi', date: '2026-10-01', totalPence: 100, status: 'reconciled', lineCount: 3 }, null, { nope: 1 }, { id: 'b', status: 'weird' }] });
    expect(out).toEqual([
      { id: 'a', retailer: 'Aldi', date: '2026-10-01', totalPence: 100, status: 'reconciled', lineCount: 3 },
      { id: 'b', status: 'needs_review', lineCount: 0 },
    ]);
    expect(parseReceiptList(undefined)).toEqual([]);
    expect(parseReceiptList({ receipts: 'x' })).toEqual([]);
  });

  it('parses a review model, defaults missing fields and ignores a pre-selection on a non-confident line', () => {
    const m = parseReview(reviewJson);
    expect(m.lines[0]).toMatchObject({ lineId: 'l1', classification: 'confident', preselectedItemId: 'i1', defaultQuantity: { value: 1000, unit: 'g' } });
    expect(m.discrepancyPence).toBe(20);
    const odd = parseReview({ receiptId: 'r2', lines: [{ lineId: 'x', classification: 'uncertain', preselectedItemId: 'i1', candidates: [{ bad: true }, { itemId: 'i1', name: 'n' }] }, { noId: 1 }], items: [{ x: 1 }] });
    expect(odd.lines).toHaveLength(1);
    expect(odd.lines[0]!.preselectedItemId).toBeUndefined();
    expect(odd.lines[0]!.candidates).toEqual([{ itemId: 'i1', name: 'n', score: 0, reasons: [] }]);
    expect(odd.lines[0]!.defaultQuantity).toEqual({ value: 1, unit: 'item' });
    expect(odd.items).toEqual([]);
    expect(odd.status).toBe('needs_review');
    expect(odd.discrepancyPence).toBeUndefined();
  });

  it('rejects a body that is not a review as BAD_RESPONSE', () => {
    expect(() => parseReview('nope')).toThrow(ServerApiError);
    expect(() => parseReview({})).toThrow(/unexpected response/);
    expect(() => parseReceiptDetail(null)).toThrow(ServerApiError);
    expect(() => parseConfirmSummary([])).toThrow(ServerApiError);
  });

  it('parses a reconciled detail with decisions and photo info', () => {
    const d = parseReceiptDetail({
      review: { ...reviewJson, status: 'reconciled' },
      reconciliation: { purchaseEventIds: ['e1', 'e2'], decisions: [{ lineId: 'l1', outcome: 'purchase', itemName: 'red lentils' }, { lineId: 'l2', outcome: 'extra', addToPantry: true }, { lineId: 'l3', outcome: 'bogus' }] },
      hasPhoto: true,
      photoPath: '/api/receipts/r1/photo',
    });
    expect(d.purchaseCount).toBe(2);
    expect(d.decisions).toHaveLength(2);
    expect(d.hasPhoto).toBe(true);
    expect(parseReceiptDetail({ review: reviewJson, hasPhoto: true }).hasPhoto).toBe(false); // no path, no photo
  });

  it('defaults confirm summary counts to zero', () => {
    expect(parseConfirmSummary({ purchases: 2, extras: 'x' })).toEqual({ purchases: 2, extras: 0, pantryAdds: 0, leftOutstanding: 0 });
  });
});

describe('client calls', () => {
  it('lists with the household id', async () => {
    const api = fakeApi();
    api.get.mockResolvedValue({ receipts: [{ id: 'a', status: 'needs_review', lineCount: 1 }] });
    expect(await listReceipts(api, 'hh-1')).toHaveLength(1);
    expect(api.get).toHaveBeenCalledWith('/api/receipts', { householdId: 'hh-1' });
  });

  it('uploads one photo under field `receipt` with householdId', async () => {
    const api = fakeApi();
    api.postForm.mockResolvedValue({ receiptId: 'new-1' });
    const id = await uploadReceipt(api, 'hh-1', { uri: 'file:///r.jpg', width: 10, height: 20, name: 'page-1.jpg', mimeType: 'image/jpeg' });
    expect(id).toBe('new-1');
    expect(api.postForm.mock.calls[0]![0]).toBe('/api/receipts');
    const f = api.postForm.mock.calls[0]![1] as unknown as { _parts?: Array<[string, unknown]>; entries?: () => Iterable<[string, unknown]> };
    const parts = f._parts ?? Array.from(f.entries?.() ?? []);
    expect(parts.map(([k]) => k)).toEqual(['householdId', 'receipt']);
    expect(parts[0]![1]).toBe('hh-1');
  });

  it('treats an upload answer without an id as a bad response', async () => {
    const api = fakeApi();
    api.postForm.mockResolvedValue({});
    await expect(uploadReceipt(api, 'hh', { uri: 'u', width: 1, height: 1, name: 'n', mimeType: 'image/jpeg' })).rejects.toThrow(ServerApiError);
  });

  it('gets and confirms by id (encoded) and sends decisions exactly', async () => {
    const api = fakeApi();
    api.get.mockResolvedValue({ review: reviewJson, hasPhoto: false });
    await getReceipt(api, 'hh-1', 'a/b');
    expect(api.get).toHaveBeenCalledWith('/api/receipts/a%2Fb', { householdId: 'hh-1' });
    api.post.mockResolvedValue({ ok: true, purchases: 1, extras: 0, pantryAdds: 0, leftOutstanding: 3 });
    const decisions = [{ lineId: 'l1', outcome: 'purchase' as const, shoppingListItemId: 'i1', quantityValue: 2 }];
    expect((await confirmReceipt(api, 'hh-1', 'r1', decisions)).leftOutstanding).toBe(3);
    expect(api.post).toHaveBeenCalledWith('/api/receipts/r1/confirm', { householdId: 'hh-1', decisions });
  });

  it('builds the photo source with the Authorization header, or null without a base URL', async () => {
    expect(await photoSource(fakeApi(), 'hh 1', '/api/receipts/r1/photo')).toEqual({
      uri: 'http://web.test/api/receipts/r1/photo?householdId=hh%201',
      headers: { Authorization: 'Bearer tok' },
    });
    expect(await photoSource(fakeApi({ webUrl: () => null }), 'hh', '/p')).toBeNull();
  });
});
