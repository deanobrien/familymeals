import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { ServerApiProvider } from '@/data/ServerApiContext';
import { ServerApiError, type ServerApi } from '@/lib/serverApi';
import type { ProductClient, ProductSummary } from '@/lib/productApi';
import PantryScanScreen from '@/screens/pantryScan/PantryScanScreen';
import { formParts } from './helpers/formParts';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush, replace: jest.fn() }) }));
const mockPicker = jest.fn();
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: (...a: unknown[]) => mockPicker(...a) }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));
const mockCamera: { current: { onBarcodeScanned?: (e: { data: string; type?: string }) => void } | null } = { current: null };
jest.mock('expo-camera', () => ({
  CameraView: (props: never) => {
    mockCamera.current = props;
    return null;
  },
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));
const mockImpact = jest.fn(async () => undefined);
jest.mock('expo-haptics', () => ({ impactAsync: (...a: unknown[]) => mockImpact(...(a as [])), ImpactFeedbackStyle: { Light: 'light' } }));
const mockActivate = jest.fn(async () => undefined);
const mockDeactivate = jest.fn(async () => undefined);
jest.mock('expo-keep-awake', () => ({
  activateKeepAwakeAsync: (...a: unknown[]) => mockActivate(...(a as [])),
  deactivateKeepAwake: (...a: unknown[]) => mockDeactivate(...(a as [])),
}));
jest.setTimeout(60000);

const ref = (id: string, name: string, category: string) => ({ id, name, category });
const PASTA = ref('ing-pasta', 'pasta', 'pasta_rice_grains');
const MILK = ref('ing-milk', 'milk', 'dairy_eggs');
const CHEDDAR = ref('ing-cheddar', 'cheddar', 'dairy_eggs');
const ROWS = [
  { key: 's1', name: 'pasta', form: 'dried', packaging: 'pack', count: 1, packSize: { value: 500, unit: 'g' }, packSizeText: '500 g', datesLegible: false, needsCloseUp: false, confidence: 0.9, frameRefs: [1], match: { status: 'matched', ingredient: PASTA } },
  { key: 's2', name: 'cheese', form: 'chilled', packaging: 'pack', count: 1, datesLegible: false, needsCloseUp: false, confidence: 0.7, frameRefs: [2], match: { status: 'ambiguous', candidates: [CHEDDAR, ref('ing-mozz', 'mozzarella', 'dairy_eggs')] } },
  { key: 's3', name: 'mystery sauce', form: 'ambient', packaging: 'jar', count: 1, datesLegible: false, needsCloseUp: false, confidence: 0.4, frameRefs: [2], notes: 'Label half hidden', match: { status: 'unmatched', suggestions: [ref('ing-ketchup', 'ketchup', 'sauces_condiments')] } },
  { key: 's4', name: 'milk', form: 'chilled', packaging: 'bottle', count: 1, datesLegible: false, needsCloseUp: true, confidence: 0.95, frameRefs: [1], match: { status: 'matched', ingredient: MILK } },
];

type Call = { path: string; body: unknown };
function fakeApi(opts: { configured?: boolean; scanRows?: unknown[]; confirmFail?: ServerApiError; confirmGate?: Promise<void> } = {}) {
  const calls: Call[] = [];
  const api: ServerApi = {
    configured: opts.configured ?? true,
    get: async (path) => {
      calls.push({ path, body: null });
      return { hits: [] } as never;
    },
    post: async (path, body) => {
      calls.push({ path, body });
      const rows = (body as { rows: Array<{ key: string; ingredientId?: string; name?: string; value: number; unit: string }> }).rows;
      if (path === '/api/pantry/scan/preview') {
        return { lines: rows.map((r) => (r.ingredientId === 'ing-pasta' ? { key: r.key, name: 'pasta', kind: 'merge', before: '500 g', after: `${500 + r.value} g` } : { key: r.key, name: r.name ?? r.ingredientId, kind: 'new', after: `${r.value} ${r.unit}` })) } as never;
      }
      if (opts.confirmGate) await opts.confirmGate;
      if (opts.confirmFail) throw opts.confirmFail;
      return { ok: true, message: `Added ${rows.length} items to your pantry`, linked: 0 } as never;
    },
    postForm: async (path, form) => {
      calls.push({ path, body: form });
      const parts = formParts(form);
      const focus = parts.find(([k]) => k === 'focus')?.[1];
      if (focus) return { rows: [{ key: 'c1', name: String(focus), form: 'chilled', packaging: 'bottle', count: 1, useBy: '2026-10-25', datesLegible: true, needsCloseUp: false, confidence: 0.9, frameRefs: [1], match: { status: 'unmatched', suggestions: [] } }], warnings: [] } as never;
      return { rows: opts.scanRows ?? ROWS, warnings: ['Some items were partly hidden'], provider: { label: 'Mock', isMock: true, configured: true } } as never;
    },
    webUrl: (p) => `http://web.test${p}`,
    authHeaders: async () => ({}),
  };
  return { api, calls, of: (path: string) => calls.filter((c) => c.path === path) };
}

const unusedProducts: ProductClient = {
  configured: true,
  lookup: jest.fn(),
  lookupBatch: jest.fn(async () => ({ ok: false as const, fatal: false, message: 'network' })),
  webUrl: () => null,
};

function SetHousehold({ children }: { children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId('hh-1'), [setHouseholdId]);
  return householdId ? <>{children}</> : null;
}

const identity = async (i: { uri: string; width: number; height: number }) => i;

async function mount(api: ServerApi, props: Partial<React.ComponentProps<typeof PantryScanScreen>> = {}) {
  return render(
    <AppProvider dataSource={new MockDataSource()}>
      <ServerApiProvider api={api}>
        <SetHousehold>
          <PantryScanScreen resizer={identity} productClient={unusedProducts} today={() => '2026-10-20'} previewDebounceMs={0} {...props} />
        </SetHousehold>
      </ServerApiProvider>
    </AppProvider>,
  );
}

async function scanTwoPhotos() {
  mockPicker.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file://a.jpg', width: 100, height: 100 }, { uri: 'file://b.jpg', width: 100, height: 100 }] });
  await fireEvent.press(await screen.findByTestId('scan-photo-pick', {}, { timeout: 8000 }));
  await fireEvent.press(await screen.findByTestId('scan-send'));
  await screen.findByTestId('scan-review', {}, { timeout: 8000 });
}

const rowAt = (i: number) => within(screen.getAllByTestId('scan-row')[i]!);

beforeEach(() => {
  mockPush.mockReset();
  mockPicker.mockReset();
  mockImpact.mockClear();
  mockActivate.mockClear();
  mockDeactivate.mockClear();
});

describe('PantryScanScreen: photos (D343)', () => {
  it('needs the server: a plain explanation, not a failure', async () => {
    await mount(fakeApi({ configured: false }).api);
    expect(await screen.findByText('This needs the Family Recipes server.', {}, { timeout: 8000 })).toBeTruthy();
  });

  it('sends the photos as a multipart scan and shows matched / ambiguous / unmatched rows; nothing written yet', async () => {
    const f = fakeApi();
    await mount(f.api);
    expect(mockPicker).not.toHaveBeenCalled();
    await scanTwoPhotos();
    expect(mockPicker.mock.calls[0]![0]).toMatchObject({ selectionLimit: 10 });
    const form = { _parts: formParts(f.of('/api/pantry/scan')[0]!.body) };
    expect(form._parts.filter(([k]) => k === 'images')).toHaveLength(2);
    expect(form._parts.find(([k]) => k === 'householdId')![1]).toBe('hh-1');
    expect(screen.getByTestId('scan-warning')).toHaveTextContent('Some items were partly hidden');

    expect(screen.getAllByTestId('scan-row')).toHaveLength(4);
    expect(rowAt(0).getByTestId('match-matched')).toHaveTextContent(/pasta/);
    expect(rowAt(0).getByTestId('row-confidence')).toHaveTextContent('High confidence (90%), seen in photo 1');
    expect(rowAt(1).getAllByTestId('match-candidate').map((c) => c.props.accessibilityLabel)).toEqual(['Use cheddar', 'Use mozzarella']);
    expect(rowAt(2).getByTestId('match-suggestion')).toBeTruthy();
    expect(rowAt(2).getByTestId('row-notes')).toHaveTextContent('Label half hidden');
    // Low confidence starts excluded (web parity).
    expect(rowAt(2).getByTestId('row-include').props.accessibilityState).toMatchObject({ checked: false });
    expect(f.of('/api/pantry/scan/confirm')).toHaveLength(0);
  });

  it('edits flow into the merge preview and the confirm payload; confirm is called once even on a double tap', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const f = fakeApi({ confirmGate: gate });
    await mount(f.api);
    await scanTwoPhotos();

    await fireEvent.press(rowAt(0).getByTestId('row-count-plus')); // 2 packs of 500 g
    await fireEvent.press(rowAt(1).getAllByTestId('match-candidate')[0]!); // cheddar
    await fireEvent.press(rowAt(2).getByTestId('row-include')); // include the sauce...
    await fireEvent.changeText(rowAt(2).getByTestId('row-name'), 'brown sauce'); // ...under my own name
    await fireEvent.changeText(rowAt(3).getByTestId('row-use-by'), '2026-13-01');
    expect(rowAt(3).getByText(/YYYY-MM-DD, e.g./)).toBeTruthy();
    expect(screen.getByTestId('scan-confirm').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(rowAt(3).getByTestId('row-use-by'), '2026-10-24');

    await waitFor(() => expect(screen.getAllByTestId('preview-line')[0]).toHaveTextContent('pasta: 500 g to 1500 g (merged with stock)'), { timeout: 8000 });
    expect(screen.getAllByTestId('preview-line')[1]).toHaveTextContent('cheddar: new line, 1 pack');
    expect(screen.getByTestId('scan-confirm')).toHaveTextContent('Add 4 items to pantry');

    await act(async () => {
      fireEvent.press(screen.getByTestId('scan-confirm'));
      fireEvent.press(screen.getByTestId('scan-confirm'));
    });
    await act(async () => { release(); });
    expect(await screen.findByTestId('scan-done', {}, { timeout: 8000 })).toHaveTextContent(/Added 4 items to your pantry/);
    const confirms = f.of('/api/pantry/scan/confirm');
    expect(confirms).toHaveLength(1);
    const sent = confirms[0]!.body as { householdId: string; submissionId: string; rows: unknown[] };
    expect(sent.householdId).toBe('hh-1');
    expect(sent.submissionId).toMatch(/^ps-/);
    expect(sent.rows).toEqual([
      { key: 's1', ingredientId: 'ing-pasta', value: 1000, unit: 'g' },
      { key: 's2', ingredientId: 'ing-cheddar', value: 1, unit: 'pack' },
      { key: 's3', name: 'brown sauce', value: 1, unit: 'pack' },
      { key: 's4', ingredientId: 'ing-milk', value: 1, unit: 'pack', expiry: '2026-10-24' },
    ]);
    await fireEvent.press(screen.getByTestId('done-pantry'));
    expect(mockPush).toHaveBeenCalledWith('/pantry');
  });

  it('shelf-life estimate is off by default; on labels estimates, off clears them', async () => {
    await mount(fakeApi().api);
    await scanTwoPhotos();
    const toggle = screen.getByTestId('estimate-toggle');
    expect(toggle.props.value).toBe(false);
    expect(screen.queryAllByTestId('estimate-badge')).toHaveLength(0);
    await fireEvent(toggle, 'valueChange', true);
    expect(rowAt(3).getByTestId('row-best-before').props.value).toBe('2026-10-27'); // chilled dairy, about 7 days
    expect(rowAt(0).getByTestId('row-best-before').props.value).toBe('2027-10-20'); // dried, about 365 days
    expect(screen.getAllByTestId('estimate-badge').length).toBeGreaterThanOrEqual(2);
    await fireEvent(screen.getByTestId('estimate-toggle'), 'valueChange', false);
    expect(screen.queryAllByTestId('estimate-badge')).toHaveLength(0);
    expect(rowAt(3).getByTestId('row-best-before').props.value).toBe('');
  });

  it('a close-up re-scan sends one photo with the item name and merges the date back', async () => {
    const f = fakeApi();
    await mount(f.api);
    await scanTwoPhotos();
    await fireEvent.press(rowAt(3).getByTestId('closeup-open'));
    mockPicker.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file://close.jpg', width: 50, height: 50 }] });
    await fireEvent.press(rowAt(3).getByTestId('closeup-pick'));
    await fireEvent.press(await rowAt(3).findByTestId('closeup-send'));
    await waitFor(() => expect(rowAt(3).getByTestId('row-use-by').props.value).toBe('2026-10-25'), { timeout: 8000 });
    expect(rowAt(3).getByTestId('row-use-by-source')).toHaveTextContent('Read from close-up');
    const form = { _parts: formParts(f.of('/api/pantry/scan')[1]!.body) };
    expect(form._parts.filter(([k]) => k === 'images')).toHaveLength(1);
    expect(form._parts.find(([k]) => k === 'focus')![1]).toBe('milk');
  });

  it('shows the server message on failure, e.g. a read-only household, and keeps the review', async () => {
    const f = fakeApi({ confirmFail: new ServerApiError('This household is read-only while it is pending deletion.', 403, false, 'READ_ONLY') });
    await mount(f.api);
    await scanTwoPhotos();
    await waitFor(() => expect(screen.getByTestId('scan-confirm').props.accessibilityState).toMatchObject({ disabled: false }));
    await fireEvent.press(screen.getByTestId('scan-confirm'));
    expect(await screen.findByText('This household is read-only while it is pending deletion.', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByTestId('scan-review')).toBeTruthy();
  });

  it('a scan failure is visible and the photos stay', async () => {
    const f = fakeApi();
    f.api.postForm = async () => { throw new ServerApiError('No AI provider is set up.', 503, true, 'NOT_CONFIGURED'); };
    await mount(f.api);
    mockPicker.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file://a.jpg', width: 100, height: 100 }] });
    await fireEvent.press(await screen.findByTestId('scan-photo-pick', {}, { timeout: 8000 }));
    await fireEvent.press(screen.getByTestId('scan-send'));
    expect(await screen.findByText(/No AI provider is set up\. Your photos are still here/, {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByTestId('scan-photo-count')).toHaveTextContent('1 of 10 photos ready');
  });
});

const BEANS = '5009000000015';
const FUSILLI = '5009000000046';
const beansSummary: ProductSummary = {
  barcode: BEANS, name: 'Baked Beans', brand: 'Hearth & Field', allergens: { status: 'unknown', contains: [], traces: [] }, nutrition: [],
  sourceUrl: `https://world.openfoodfacts.org/product/${BEANS}`,
  review: {
    product: { barcode: BEANS, name: 'Baked Beans', brand: 'Hearth & Field', packSizeText: '415 g', packSize: { value: 415, unit: 'g' }, categories: ['en:canned-foods'], nutrition: { per: 'g' }, allergenText: 'Allergens not listed', sourceUrl: '' },
    match: { status: 'matched', ingredient: ref('ing-beans', 'baked beans', 'tinned_jarred') },
  },
};

describe('PantryScanScreen: continuous barcodes reviewed and confirmed on the phone (D344)', () => {
  it('tally -> review rows from lookups -> merge preview -> confirm, with a haptic per counted read and keep-awake while scanning', async () => {
    const realNow = Date.now.bind(Date);
    let offset = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const products: ProductClient & { lookupBatch: jest.Mock } = {
      configured: true,
      lookup: jest.fn(),
      lookupBatch: jest.fn(async (_hh: string, req: { codes: string[] }) => ({
        ok: true as const,
        results: Object.fromEntries(req.codes.map((c) => [c, c === BEANS ? { status: 'done' as const, lookup: beansSummary } : { status: 'notfound' as const }])),
      })),
      webUrl: (p: string) => `http://web.test${p}`,
    };
    const f = fakeApi();
    const view = await mount(f.api, { initialMode: 'barcodes', productClient: products });
    await fireEvent.press(await screen.findByTestId('rapid-start', {}, { timeout: 8000 }));
    expect(mockActivate).toHaveBeenCalledWith('fr-rapid-scan');

    await act(async () => {
      for (let i = 0; i < 5; i++) mockCamera.current?.onBarcodeScanned?.({ data: BEANS, type: 'ean13' });
    });
    expect(mockImpact).toHaveBeenCalledTimes(1); // same pack still in view: counted once, one tick
    await act(async () => {
      offset += 2500;
      mockCamera.current?.onBarcodeScanned?.({ data: BEANS, type: 'ean13' });
      mockCamera.current?.onBarcodeScanned?.({ data: FUSILLI, type: 'ean13' });
    });
    expect(mockImpact).toHaveBeenCalledTimes(3);
    expect(screen.getByTestId('rapid-counter')).toHaveTextContent('3 items scanned');

    // Pausing releases keep-awake; resuming takes it again.
    await fireEvent.press(screen.getByTestId('rapid-pause'));
    expect(mockDeactivate).toHaveBeenCalledWith('fr-rapid-scan');
    await fireEvent.press(screen.getByTestId('rapid-pause'));
    expect(mockActivate).toHaveBeenCalledTimes(2);

    expect(await screen.findByText('Baked Beans', {}, { timeout: 8000 })).toBeTruthy();
    expect(await screen.findByText('Unknown product', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByTestId('rapid-review')).toHaveTextContent('Review 2 products');
    await fireEvent.press(screen.getByTestId('rapid-review'));
    await screen.findByTestId('scan-review', {}, { timeout: 8000 });
    expect(mockDeactivate).toHaveBeenCalledTimes(2); // the camera session ended

    // Rows from the tally + lookups: beans x2 (matched, tins), fusilli unknown (needs a name).
    expect(screen.getByTestId('rapid-review-note')).toBeTruthy();
    expect(rowAt(0).getByTestId('row-count').props.value).toBe('2');
    expect(rowAt(0).getByTestId('match-matched')).toHaveTextContent(/baked beans/);
    expect(rowAt(0).getByTestId('row-barcode')).toHaveTextContent(`From barcode ${BEANS}`);
    expect(rowAt(1).getByTestId('row-lookup-note')).toHaveTextContent(/Not found in Open Food Facts/);
    expect(screen.getByTestId('scan-confirm').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.changeText(rowAt(1).getByTestId('row-name'), 'fusilli');
    // Dates are optional and collapsed for barcode rows.
    expect(rowAt(0).queryByTestId('row-use-by')).toBeNull();
    await fireEvent.press(rowAt(0).getByTestId('row-dates-toggle'));
    await fireEvent.changeText(rowAt(0).getByTestId('row-best-before'), '2028-01-31');

    await waitFor(() => expect(screen.getAllByTestId('preview-line')).toHaveLength(2), { timeout: 8000 });
    await waitFor(() => expect(screen.getAllByTestId('preview-line')[0]).toHaveTextContent('baked beans: new line, 2 can'));
    await fireEvent.press(screen.getByTestId('scan-confirm'));
    await screen.findByTestId('scan-done', {}, { timeout: 8000 });
    const sent = f.of('/api/pantry/scan/confirm')[0]!.body as { rows: unknown[] };
    expect(sent.rows).toEqual([
      { key: `rp-${BEANS}`, ingredientId: 'ing-beans', value: 2, unit: 'can', expiry: '2028-01-31', barcode: BEANS },
      { key: `rp-${FUSILLI}`, name: 'fusilli', value: 1, unit: 'pack' },
    ]);
    expect(open).not.toHaveBeenCalled(); // no hand-off to the web
    await view.unmount();
    jest.restoreAllMocks();
  });

  it('keep-awake is released when the scanner unmounts mid-session', async () => {
    const view = await mount(fakeApi().api, { initialMode: 'barcodes' });
    await fireEvent.press(await screen.findByTestId('rapid-start', {}, { timeout: 8000 }));
    expect(mockActivate).toHaveBeenCalledTimes(1);
    await view.unmount();
    expect(mockDeactivate).toHaveBeenCalledWith('fr-rapid-scan');
  });
});
