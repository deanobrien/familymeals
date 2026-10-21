// "Scan for a computer" (P3-C, D448): QR / pasted address -> connect -> barcodes and photos pushed into a desktop session.
// The camera and the network are fakes; the device camera, QR reading and the live desktop are device checks (docs/ROADMAP.md).
import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { MemoryScannerStoreForTests } from './helpers/scannerFake';
import { buildPhoneLink, type PhoneTransport } from '@fr/engine/scanner';
import ScanForComputerScreen from '@/screens/ScanForComputerScreen';

jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(async () => undefined), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('expo-keep-awake', () => ({ activateKeepAwakeAsync: jest.fn(async () => undefined), deactivateKeepAwake: jest.fn(async () => undefined) }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));
const mockLaunch = jest.fn();
jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: (...a: unknown[]) => mockLaunch(...a),
}));
const camera: { qr: ((e: { data: string }) => void) | null; barcode: ((e: { data: string; type?: string }) => void) | null } = { qr: null, barcode: null };
jest.mock('expo-camera', () => ({
  CameraView: (props: { barcodeScannerSettings?: { barcodeTypes: string[] }; onBarcodeScanned?: never }) => {
    if (props.barcodeScannerSettings?.barcodeTypes.includes('qr')) camera.qr = props.onBarcodeScanned as never;
    else camera.barcode = props.onBarcodeScanned as never;
    return null;
  },
  useCameraPermissions: () => [{ granted: true }, jest.fn(async () => ({ granted: true }))],
}));
jest.setTimeout(30000);

const ID = '3f2b8c1e-9a4d-4e6b-8c7f-0a1b2c3d4e5f';
const TOKEN = 'abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE';
const BASE = 'https://app.example.test';
const LINK = buildPhoneLink(BASE, ID, TOKEN);
const BEANS = '5000157024671';
const FUSILLI = '5009000000046';

function setup(over: { transport?: PhoneTransport } = {}) {
  const fake = new MemoryScannerStoreForTests({ id: ID, token: TOKEN, purpose: 'pantry' });
  const transport = over.transport ?? fake.transport();
  const deps = { baseUrl: BASE, transport, deviceId: async () => 'device-one-0123456789', preparePhoto: async () => ({ base64: 'aGVsbG8=', mime: 'image/jpeg' as const }) };
  return { fake, deps };
}

describe('connecting', () => {
  it('opens from the app link with the address already in it', async () => {
    const { fake, deps } = setup();
    await render(<ScanForComputerScreen initialUrl={LINK} deps={deps} />);
    expect(await screen.findByText('Scanning for your pantry')).toBeTruthy();
    expect(fake.connected).toBe(true);
  });

  it('reads the QR code from the camera', async () => {
    const { fake, deps } = setup();
    await render(<ScanForComputerScreen deps={deps} />);
    await fireEvent.press(screen.getByTestId('scan-computer-open-camera'));
    await waitFor(() => expect(camera.qr).toBeTruthy());
    await act(async () => { camera.qr!({ data: LINK }); });
    expect(await screen.findByText('Scanning for your pantry')).toBeTruthy();
    expect(fake.connected).toBe(true);
  });

  it('takes a pasted address, and refuses one that is not ours or points at another server', async () => {
    const { fake, deps } = setup();
    await render(<ScanForComputerScreen deps={deps} />);
    await fireEvent.changeText(screen.getByTestId('scan-computer-link'), buildPhoneLink('https://evil.example.test', ID, TOKEN));
    await fireEvent.press(screen.getByTestId('scan-computer-connect'));
    expect(await screen.findByText(/not a scanning code/)).toBeTruthy();
    expect(fake.connected).toBe(false);
    await fireEvent.changeText(screen.getByTestId('scan-computer-link'), 'hello');
    await fireEvent.press(screen.getByTestId('scan-computer-connect'));
    expect(await screen.findByText(/not a scanning code/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('scan-computer-link'), LINK);
    await fireEvent.press(screen.getByTestId('scan-computer-connect'));
    expect(await screen.findByText('Scanning for your pantry')).toBeTruthy();
  });

  it('a build with no server address connects to nothing', async () => {
    const { deps } = setup();
    await render(<ScanForComputerScreen initialUrl={LINK} deps={{ ...deps, baseUrl: undefined }} />);
    expect(await screen.findByText(/no server address/)).toBeTruthy();
  });

  it('an expired or ended session explains itself', async () => {
    const t: PhoneTransport = {
      connect: async () => ({ ok: false, code: 'expired', message: 'expired' }),
      push: async () => ({ ok: false, code: 'expired', message: 'expired' }),
    };
    const { deps } = setup({ transport: t });
    await render(<ScanForComputerScreen initialUrl={LINK} deps={deps} />);
    expect(await screen.findByText('Cannot scan for the computer')).toBeTruthy();
    expect(screen.getByText(/10 minutes/)).toBeTruthy();
  });
});

describe('pushing', () => {
  async function ready() {
    const s = setup();
    await render(<ScanForComputerScreen initialUrl={LINK} deps={s.deps} />);
    await screen.findByText('Scanning for your pantry');
    return s;
  }

  it('a camera barcode is counted once while held, and again after moving away; each reaches the desktop session', async () => {
    const { fake } = await ready();
    await fireEvent.press(screen.getByTestId('scan-computer-start'));
    await waitFor(() => expect(camera.barcode).toBeTruthy());
    await act(async () => { camera.barcode!({ data: BEANS, type: 'ean13' }); camera.barcode!({ data: BEANS, type: 'ean13' }); });
    await act(async () => { camera.barcode!({ data: 'not-a-barcode' }); });
    await waitFor(() => expect(fake.items.map((i) => i.barcode)).toEqual([BEANS]));
    expect(screen.getByTestId('scan-computer-sent')).toHaveTextContent(/^1 sent/);
  });

  it('a typed barcode is sent, a bad one is refused', async () => {
    const { fake } = await ready();
    await fireEvent.changeText(screen.getByTestId('scan-computer-input'), '12345');
    await fireEvent.press(screen.getByTestId('scan-computer-add'));
    expect(await screen.findByText(/8, 12 or 13 digits/)).toBeTruthy();
    await fireEvent.changeText(screen.getByTestId('scan-computer-input'), FUSILLI);
    await fireEvent.press(screen.getByTestId('scan-computer-add'));
    await waitFor(() => expect(fake.items.map((i) => i.barcode)).toEqual([FUSILLI]));
  });

  it('a photo is prepared and pushed', async () => {
    const { fake } = await ready();
    mockLaunch.mockResolvedValueOnce({ canceled: false, assets: [{ uri: 'file:///p.jpg', width: 3000, height: 4000 }] });
    await fireEvent.press(screen.getByTestId('scan-computer-photo'));
    await waitFor(() => expect(fake.items.map((i) => i.kind)).toEqual(['photo']));
    expect(fake.items[0]!.photo).toBe('aGVsbG8=');
  });

  it('keeps a scan made while offline and delivers it once, when the connection is back', async () => {
    const s = await ready();
    s.fake.offline = true;
    await fireEvent.changeText(screen.getByTestId('scan-computer-input'), BEANS);
    await fireEvent.press(screen.getByTestId('scan-computer-add'));
    await waitFor(() => expect(screen.getByTestId('scan-computer-sent')).toHaveTextContent(/1 waiting/));
    expect(s.fake.items).toEqual([]);
    s.fake.offline = false;
    // The screen retries every 3 s on its own.
    await waitFor(() => expect(s.fake.items.map((i) => i.barcode)).toEqual([BEANS]), { timeout: 8000, interval: 200 });
    await waitFor(() => expect(screen.getByTestId('scan-computer-sent')).toHaveTextContent(/^1 sent/));
  });

  it('stops with a message when the computer ends the session', async () => {
    const s = await ready();
    s.fake.revoked = true;
    await fireEvent.changeText(screen.getByTestId('scan-computer-input'), BEANS);
    await fireEvent.press(screen.getByTestId('scan-computer-add'));
    expect(await screen.findByText(/ended this scanning session/)).toBeTruthy();
    expect(screen.queryByTestId('scan-computer-add')).toBeNull();
  });
});
