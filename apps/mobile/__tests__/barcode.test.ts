import { SAME_CODE_COOLDOWN_MS, acceptScan, gtinCheckDigitOk, normaliseBarcode, type ScanGate } from '@/lib/barcode';
import { ProductApiError, createProductClient, summariseProduct } from '@/lib/productApi';

const BEANS = '5009000000015';

describe('barcode validation', () => {
  it('checks the GS1 check digit and tolerates spaces and hyphens in manual entry', () => {
    expect(gtinCheckDigitOk(BEANS)).toBe(true);
    expect(gtinCheckDigitOk('5009000000011')).toBe(false);
    expect(gtinCheckDigitOk('96385074')).toBe(true); // EAN-8
    expect(gtinCheckDigitOk('12')).toBe(false);
    expect(normaliseBarcode(' 5009 0000-00015 ')).toBe(BEANS);
    expect(normaliseBarcode('https://example.test/qr')).toBeNull();
  });
});

describe('acceptScan (the onBarcodeScanned handler)', () => {
  it('accepts a valid retail code once, ignores repeats inside the cool-down, then accepts it again', () => {
    const gate: ScanGate = { busy: false };
    expect(acceptScan({ data: BEANS }, gate, 1000)).toBe(BEANS);
    expect(acceptScan({ data: BEANS }, gate, 1000 + 500)).toBeNull();
    expect(acceptScan({ data: BEANS }, gate, 1000 + SAME_CODE_COOLDOWN_MS - 1)).toBeNull();
    expect(acceptScan({ data: BEANS }, gate, 1000 + SAME_CODE_COOLDOWN_MS)).toBe(BEANS);
  });
  it('a different valid code is accepted immediately', () => {
    const gate: ScanGate = { busy: false };
    acceptScan({ data: BEANS }, gate, 0);
    expect(acceptScan({ data: '5009000000046' }, gate, 10)).toBe('5009000000046');
  });
  it('ignores invalid codes (QR text, wrong check digit) and everything while a lookup is running', () => {
    const gate: ScanGate = { busy: false };
    expect(acceptScan({ data: 'hello' }, gate, 0)).toBeNull();
    expect(acceptScan({ data: '5009000000011' }, gate, 0)).toBeNull();
    expect(gate.last).toBeUndefined();
    gate.busy = true;
    expect(acceptScan({ data: BEANS }, gate, 0)).toBeNull();
  });
});

describe('product API client', () => {
  const body = {
    product: {
      barcode: BEANS, name: 'Beans', brand: 'Hearth & Field', packSizeText: '415 g',
      allergens: { status: 'listed', contains: ['cereals_gluten'], traces: ['eggs'], unmapped: [] },
      nutrition: { per: 'g', per100: [
        { nutrient: 'energy_kcal', status: 'known', value: 78, unit: 'kcal' },
        { nutrient: 'protein', status: 'unknown', unit: 'g' },
        { nutrient: 'fat', status: 'zero', value: 0, unit: 'g' },
      ] },
      source: { url: 'https://world.openfoodfacts.org/product/5009000000015' },
    },
    match: { status: 'matched', ingredient: { id: 'i', name: 'baked beans', category: 'x' } },
  };
  const ok = (b: unknown) => ({ ok: true, status: 200, json: async () => b }) as Response;

  it('summarises only what is shown; unknown nutrients are absent, never 0; explicit zero is kept', () => {
    const s = summariseProduct(body);
    expect(s).toMatchObject({ name: 'Beans', ingredientName: 'baked beans', allergens: { status: 'listed', contains: ['Cereals containing gluten'], traces: ['Eggs'] } });
    expect(s.nutrition).toEqual([{ label: 'Energy', text: '78 kcal per 100 g' }, { label: 'Fat', text: '0 g per 100 g' }]);
    expect(() => summariseProduct({ nope: true })).toThrow(ProductApiError);
  });

  it('sends the bearer token and household, and URL-encodes the barcode', async () => {
    const fetchImpl = jest.fn(async () => ok(body));
    const c = createProductClient({ baseUrl: 'https://web.test/', getToken: async () => 'tok', fetchImpl: fetchImpl as never });
    await c.lookup('hh 1', BEANS);
    expect(fetchImpl).toHaveBeenCalledWith(`https://web.test/api/products/${BEANS}?householdId=hh%201`, { headers: { Accept: 'application/json', Authorization: 'Bearer tok' } });
    expect(c.webUrl('/pantry/scan')).toBe('https://web.test/pantry/scan');
  });

  it('maps failures: not configured, network, auth, server error body', async () => {
    await expect(createProductClient({ getToken: async () => null }).lookup('h', BEANS)).rejects.toMatchObject({ status: 0, retryable: false });
    const net = createProductClient({ baseUrl: 'https://w', getToken: async () => null, fetchImpl: (async () => { throw new Error('x'); }) as never });
    await expect(net.lookup('h', BEANS)).rejects.toMatchObject({ retryable: true });
    const mk = (status: number, b: unknown) => createProductClient({ baseUrl: 'https://w', getToken: async () => 't', fetchImpl: (async () => ({ ok: false, status, json: async () => b })) as never });
    await expect(mk(401, {}).lookup('h', BEANS)).rejects.toMatchObject({ status: 401, message: expect.stringMatching(/sign in/i) });
    await expect(mk(404, { error: { code: 'not_found', message: 'We could not find that product.', retryable: false } }).lookup('h', BEANS)).rejects.toMatchObject({ status: 404, code: 'not_found', retryable: false, message: 'We could not find that product.' });
    await expect(mk(429, { error: { message: 'slow down' } }).lookup('h', BEANS)).rejects.toMatchObject({ retryable: true });
  });
});
