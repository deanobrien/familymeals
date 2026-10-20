import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { ServerApiProvider } from '@/data/ServerApiContext';
import CaptureScreen from '@/screens/CaptureScreen';
import PantryScanScreen from '@/screens/pantryScan/PantryScanScreen';
import { createProductClient, type ProductClient, type ProductSummary } from '@/lib/productApi';
import type { ServerApi } from '@/lib/serverApi';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: mockPush }) }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => undefined), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(async () => undefined), deactivateKeepAwake: jest.fn(async () => undefined) }));
jest.setTimeout(60000);
const cameraProps: { current: { onBarcodeScanned?: (e: { data: string; type?: string }) => void } | null } = { current: null };
jest.mock('expo-camera', () => ({
  CameraView: (props: never) => {
    cameraProps.current = props;
    return null;
  },
  useCameraPermissions: () => [{ granted: true }, jest.fn()],
}));

function SetHousehold({ children }: { children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId('hh-1'), [setHouseholdId]);
  return householdId ? <>{children}</> : null;
}

const BEANS = '5009000000015';
const FUSILLI = '5009000000046';
const summary = (barcode: string, name: string): ProductSummary => ({
  barcode, name, allergens: { status: 'unknown', contains: [], traces: [] }, nutrition: [], sourceUrl: `https://world.openfoodfacts.org/product/${barcode}`,
});

function fakeClient(answer: ProductClient['lookupBatch']) {
  const client: ProductClient & { lookupBatch: jest.Mock } = {
    configured: true,
    lookup: jest.fn(),
    lookupBatch: jest.fn(answer),
    webUrl: (p: string) => `http://web.test${p}`,
  };
  return client;
}

const api: ServerApi = {
  configured: true,
  get: async () => ({ hits: [] }) as never,
  post: async () => ({ lines: [] }) as never,
  postForm: async () => { throw new Error('unused'); },
  webUrl: () => null,
  authHeaders: async () => ({}),
};

async function openRapid(client: ProductClient) {
  await render(
    <AppProvider dataSource={new MockDataSource()}>
      <ServerApiProvider api={api}>
        <SetHousehold>
          <PantryScanScreen initialMode="barcodes" productClient={client} />
        </SetHousehold>
      </ServerApiProvider>
    </AppProvider>,
  );
  await fireEvent.press(await screen.findByTestId('rapid-start', {}, { timeout: 8000 }));
}

describe('continuous barcode scanning (Scan groceries > Barcodes)', () => {
  it('the capture screen sends "Scan many barcodes" to the pantry scan, where the tally is reviewed on the phone', async () => {
    mockPush.mockReset();
    await render(
      <AppProvider dataSource={new MockDataSource()}>
        <SetHousehold>
          <CaptureScreen productClient={fakeClient(async () => ({ ok: false, fatal: false, message: 'x' }))} />
        </SetHousehold>
      </AppProvider>,
    );
    await fireEvent.press(await screen.findByTestId('open-rapid', {}, { timeout: 8000 }));
    expect(mockPush).toHaveBeenCalledWith('/pantry/scan?mode=barcodes');
  });

  it('tallies camera reads with the shared debounce, looks codes up in the background, and reviews on the phone (no web hand-off)', async () => {
    // Real time keeps flowing (waitFor needs it); the test only adds an offset to jump past the same-code cool-down.
    const realNow = Date.now.bind(Date);
    let offset = 0;
    const client = fakeClient(async (_hh, req) => ({
      ok: true,
      results: Object.fromEntries(req.codes.map((c) => [c, c === BEANS ? { status: 'done' as const, lookup: summary(BEANS, 'Hearth & Field Baked Beans') } : { status: 'notfound' as const }])),
    }));
    jest.spyOn(Date, 'now').mockImplementation(() => realNow() + offset);
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await openRapid(client);

    // The camera fires many events for the same pack, plus a QR code and a misread: one item.
    await act(async () => {
      for (let i = 0; i < 6; i++) { cameraProps.current?.onBarcodeScanned?.({ data: BEANS, type: 'ean13' }); }
      cameraProps.current?.onBarcodeScanned?.({ data: 'https://example.test', type: 'qr' });
      cameraProps.current?.onBarcodeScanned?.({ data: '5009000000011', type: 'ean13' });
    });
    expect(screen.getByTestId('rapid-counter')).toHaveTextContent('1 item scanned');

    // Moved away and back after the cool-down: counts again. A second product is its own row.
    await act(async () => {
      offset += 2500;
      cameraProps.current?.onBarcodeScanned?.({ data: BEANS, type: 'ean13' });
      cameraProps.current?.onBarcodeScanned?.({ data: FUSILLI, type: 'ean13' });
    });
    expect(screen.getByTestId('rapid-counter')).toHaveTextContent('3 items scanned');
    expect(screen.getAllByTestId('rapid-row')).toHaveLength(2);

    // Lookups arrive without blocking the scan.
    await waitFor(() => expect(client.lookupBatch).toHaveBeenCalled(), { timeout: 8000 });
    expect(client.lookupBatch.mock.calls[0]![0]).toBe('hh-1');
    expect(await screen.findByText('Hearth & Field Baked Beans', {}, { timeout: 8000 })).toBeTruthy();
    expect(await screen.findByText('Unknown product', {}, { timeout: 8000 })).toBeTruthy();

    // Manual +/- and undo.
    await fireEvent.press(screen.getAllByTestId('rapid-minus')[1]!); // beans (most recent first: fusilli, beans)
    expect(screen.getByTestId('rapid-counter')).toHaveTextContent('2 items scanned');
    await fireEvent.press(screen.getByTestId('rapid-undo'));
    expect(screen.getByTestId('rapid-counter')).toHaveTextContent('3 items scanned');

    // Review stays on the phone: one row per product with the tallied count (a summary without the full record is unmatched).
    await fireEvent.press(screen.getByTestId('rapid-review'));
    expect(await screen.findByTestId('scan-review', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getAllByTestId('scan-row')).toHaveLength(2);
    expect(screen.getAllByTestId('row-count').map((c) => c.props.value)).toEqual(['2', '1']);
    expect(open).not.toHaveBeenCalled();

    // Back to scanning keeps the tally.
    await fireEvent.press(screen.getByTestId('scan-back'));
    expect(await screen.findByTestId('rapid-counter', {}, { timeout: 8000 })).toHaveTextContent('3 items scanned');
    jest.restoreAllMocks();
  });

  it('typed barcodes work without a camera and bad digits are rejected locally', async () => {
    const client = fakeClient(async () => ({ ok: false, fatal: false, message: 'network' }));
    await openRapid(client);
    await fireEvent.changeText(screen.getByTestId('rapid-input'), '1234');
    await fireEvent.press(screen.getByTestId('rapid-add'));
    expect(screen.getByText(/8, 12 or 13 digits/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('rapid-input'), BEANS);
    await fireEvent.press(screen.getByTestId('rapid-add'));
    expect(screen.getByTestId('rapid-counter')).toHaveTextContent('1 item scanned');
    expect(screen.getByText('Looking up...')).toBeTruthy(); // a network failure keeps it pending, never an error row
    // Reviewing while the lookup is pending: the row can be counted or named, and blocks confirm until it is.
    await fireEvent.press(screen.getByTestId('rapid-review'));
    expect(await screen.findByTestId('row-looking-up', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByTestId('scan-confirm').props.accessibilityState).toMatchObject({ disabled: true });
    await fireEvent.press(screen.getByTestId('row-name-myself'));
    await fireEvent.changeText(screen.getByTestId('row-name'), 'beans');
    await waitFor(() => expect(screen.getByTestId('scan-confirm').props.accessibilityState).toMatchObject({ disabled: false }));
  });
});

describe('createProductClient.lookupBatch', () => {
  const ok = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body }) as unknown as Response;

  it('posts codes with the bearer token and household, and summarises done products', async () => {
    const fetchImpl = jest.fn(async () =>
      ok({ results: { [BEANS]: { status: 'done', lookup: { product: { barcode: BEANS, name: 'Beans', allergens: { status: 'unknown' }, nutrition: { per: 'g', per100: [] } }, match: {} } }, [FUSILLI]: { status: 'pending' } } }),
    );
    const c = createProductClient({ baseUrl: 'http://api.test/', getToken: async () => 'tok', fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await c.lookupBatch('hh-1', { codes: [BEANS, FUSILLI] });
    expect(fetchImpl).toHaveBeenCalledWith('http://api.test/api/products', expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ Authorization: 'Bearer tok' }) }));
    expect(JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, { body: string }])[1].body)).toEqual({ codes: [BEANS, FUSILLI], householdId: 'hh-1' });
    expect(out).toMatchObject({ ok: true, results: { [BEANS]: { status: 'done', lookup: { name: 'Beans' } }, [FUSILLI]: { status: 'pending' } } });
  });

  it('401 is fatal, 5xx and network failures are not, and an unconfigured client says so', async () => {
    const mk = (f: unknown) => createProductClient({ baseUrl: 'http://api.test', getToken: async () => null, fetchImpl: f as typeof fetch });
    expect(await mk(async () => ok({}, 401)).lookupBatch('h', { codes: [BEANS] })).toMatchObject({ ok: false, fatal: true });
    expect(await mk(async () => ok({}, 503)).lookupBatch('h', { codes: [BEANS] })).toMatchObject({ ok: false, fatal: false });
    expect(await mk(async () => { throw new Error('x'); }).lookupBatch('h', { codes: [BEANS] })).toMatchObject({ ok: false, fatal: false });
    expect(await createProductClient({ getToken: async () => null }).lookupBatch('h', { codes: [BEANS] })).toMatchObject({ ok: false, fatal: true });
  });
});
