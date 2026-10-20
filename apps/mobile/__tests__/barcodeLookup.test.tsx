import React from 'react';
import { Linking } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import CaptureScreen from '@/screens/CaptureScreen';
import { ProductApiError, type ProductClient, type ProductSummary } from '@/lib/productApi';

jest.mock('expo-router', () => ({ useRouter: () => ({ replace: jest.fn(), push: jest.fn() }) }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));
// The camera: expose the barcode props so a test can fire scans the way expo-camera does (many events per code).
const cameraProps: { current: { onBarcodeScanned?: (e: { data: string }) => void; barcodeScannerSettings?: { barcodeTypes: string[] } } | null } = { current: null };
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
const summary: ProductSummary = {
  barcode: BEANS, name: 'Hearth & Field Baked Beans', brand: 'Hearth & Field', packSizeText: '415 g',
  allergens: { status: 'listed', contains: [], traces: [] },
  nutrition: [{ label: 'Energy', text: '78 kcal per 100 g' }],
  ingredientName: 'baked beans', sourceUrl: `https://world.openfoodfacts.org/product/${BEANS}`,
};

function fakeProducts(impl?: ProductClient['lookup']) {
  const client: ProductClient & { lookup: jest.Mock } = {
    configured: true,
    lookup: jest.fn(impl ?? (async () => summary)),
    lookupBatch: jest.fn(async () => ({ ok: false as const, fatal: false, message: 'unused' })),
    webUrl: (p: string) => `http://web.test${p}`,
  };
  return client;
}

async function open(client: ProductClient) {
  await render(
    <AppProvider dataSource={new MockDataSource()}>
      <SetHousehold>
        <CaptureScreen productClient={client} />
      </SetHousehold>
    </AppProvider>,
  );
  await fireEvent.press(await screen.findByTestId('open-barcode', {}, { timeout: 8000 }));
}

describe('barcode scanning on the capture screen', () => {
  it('scans with the camera: asks only for retail codes, looks each code up once, shows the product and attribution', async () => {
    const client = fakeProducts();
    await open(client);
    await fireEvent.press(await screen.findByTestId('open-barcode-camera', {}, { timeout: 8000 }));
    expect(cameraProps.current?.barcodeScannerSettings?.barcodeTypes).toEqual(['ean13', 'ean8', 'upc_a', 'upc_e']);

    // The camera fires repeatedly for the same code, and sometimes for a QR code or a misread: one lookup.
    await act(async () => {
      cameraProps.current?.onBarcodeScanned?.({ data: 'not a barcode' });
      cameraProps.current?.onBarcodeScanned?.({ data: BEANS });
      cameraProps.current?.onBarcodeScanned?.({ data: BEANS });
    });
    await waitFor(() => expect(client.lookup).toHaveBeenCalledTimes(1), { timeout: 8000 });
    expect(client.lookup).toHaveBeenCalledWith('hh-1', BEANS);

    expect(await screen.findByTestId('product-card', {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.getByText('Hearth & Field Baked Beans')).toBeTruthy();
    expect(screen.getByTestId('product-ingredient')).toHaveTextContent(/baked beans/);
    expect(screen.getByTestId('product-allergens')).toHaveTextContent(/No allergens listed \(check the pack\)/);
    expect(screen.getByTestId('product-attribution')).toHaveTextContent(/Open Food Facts contributors, ODbL/);
    expect(screen.getByText('Energy: 78 kcal per 100 g')).toBeTruthy();
  });

  it('manual entry works without a camera, rejects bad digits locally, and offers "add on the web"', async () => {
    const client = fakeProducts();
    const open$ = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await open(client);
    await fireEvent.changeText(await screen.findByTestId('barcode-input', {}, { timeout: 8000 }), '1234');
    await fireEvent.press(screen.getByTestId('barcode-lookup'));
    expect(await screen.findByText(/8, 12 or 13 digits/, {}, { timeout: 8000 })).toBeTruthy();
    expect(client.lookup).not.toHaveBeenCalled();

    await fireEvent.changeText(screen.getByTestId('barcode-input'), '5009 0000 00015');
    await fireEvent.press(screen.getByTestId('barcode-lookup'));
    await screen.findByTestId('product-card', {}, { timeout: 8000 });
    expect(client.lookup).toHaveBeenCalledWith('hh-1', BEANS);
    await fireEvent.press(screen.getByTestId('finish-on-web'));
    expect(open$).toHaveBeenCalledWith('http://web.test/pantry/scan');
  });

  it('shows a server error message (not found) and can go back to recipe capture', async () => {
    const client = fakeProducts(async () => {
      throw new ProductApiError('We could not find that product. Add it by name instead.', 404, false, 'not_found');
    });
    await open(client);
    await fireEvent.changeText(await screen.findByTestId('barcode-input', {}, { timeout: 8000 }), BEANS);
    await fireEvent.press(screen.getByTestId('barcode-lookup'));
    expect(await screen.findByText(/could not find that product/, {}, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByTestId('product-card')).toBeNull();
    await fireEvent.press(screen.getByTestId('close-barcode'));
    expect(await screen.findByTestId('send-extraction', {}, { timeout: 8000 })).toBeTruthy();
  });
});
