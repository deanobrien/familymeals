import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as ImagePicker from 'expo-image-picker';
import { AppProvider, useApp } from '@/data/AppContext';
import { MockDataSource } from '@/data/mockDataSource';
import { ServerApiProvider } from '@/data/ServerApiContext';
import { ServerApiError, type ServerApi } from '@/lib/serverApi';
import ListScanScreen from '@/screens/listScan/ListScanScreen';
import { formParts } from './helpers/formParts';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ replace: mockReplace, push: jest.fn() }) }));
jest.mock('expo-camera', () => ({ CameraView: () => null, useCameraPermissions: () => [{ granted: true }, jest.fn()] }));
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock('expo-image-manipulator', () => ({ manipulateAsync: jest.fn(), SaveFormat: { JPEG: 'jpeg' } }));

const scanBody = {
  title: 'Saturday shop',
  warnings: ['Photo 2 was a little blurry.'],
  rows: [
    { key: 'r1', originalText: '2 spuds', name: 'potatoes', quantity: { kind: 'exact', value: 2, unit: 'kg' }, crossedOut: false, illegible: false, confidence: 0.95, imageRef: 1, match: { status: 'matched', ingredient: { id: 'ing-potato', name: 'potatoes', category: 'fruit_veg' } }, aisle: 'Fruit & veg' },
    { key: 'r2', originalText: 'milk (struck)', name: 'milk', crossedOut: true, illegible: false, confidence: 0.9, imageRef: 1, match: { status: 'none' }, aisle: 'Dairy & eggs' },
    { key: 'r3', originalText: 'bread?', name: 'bread', crossedOut: false, illegible: false, confidence: 0.5, imageRef: 1, match: { status: 'none' }, aisle: 'Bakery' },
  ],
};
const previewBody = { preview: { destination: { kind: 'current', name: 'Weekly' }, added: 1, merged: 1, skipped: 0, lines: [
  { key: 'r1', name: 'potatoes', kind: 'merge', before: '1 kg', after: '3 kg', aisle: 'Fruit & veg' },
  { key: 'r3', name: 'bread', kind: 'new', after: 'no amount', aisle: 'Bakery' },
] } };

function fakeApi(opts: { confirmFail?: ServerApiError; scanFail?: ServerApiError; hold?: Promise<void> } = {}) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const forms: FormData[] = [];
  let confirmFail = opts.confirmFail;
  const api: ServerApi = {
    configured: true,
    get: async () => { throw new Error('unused'); },
    post: async (path, body) => {
      posts.push({ path, body: body as Record<string, unknown> });
      if (path.endsWith('/preview')) return previewBody as never;
      if (opts.hold) await opts.hold;
      if (confirmFail) { const e = confirmFail; confirmFail = undefined; throw e; }
      return { ok: true, message: 'Added 1 new item, combined 1 with an item already on the list.', listName: 'Weekly', created: false, added: 1, merged: 1, skipped: 0 } as never;
    },
    postForm: async (_p, form) => {
      forms.push(form);
      if (opts.scanFail) throw opts.scanFail;
      return scanBody as never;
    },
    webUrl: () => null,
    authHeaders: async () => ({}),
  };
  return { api, posts, forms, confirms: () => posts.filter((p) => p.path.endsWith('/confirm')) };
}

function SetHousehold({ children }: { children: React.ReactNode }) {
  const { householdId, setHouseholdId } = useApp();
  React.useEffect(() => setHouseholdId('hh-1'), [setHouseholdId]);
  return householdId ? <>{children}</> : null;
}

async function mount(f = fakeApi(), configured = true) {
  const resizer = jest.fn(async (i: { uri: string; width: number; height: number }) => i);
  const api = configured ? f.api : { ...f.api, configured: false };
  await render(
    <AppProvider dataSource={new MockDataSource()}>
      <ServerApiProvider api={api}>
        <SetHousehold>
          <ListScanScreen resizer={resizer} />
        </SetHousehold>
      </ServerApiProvider>
    </AppProvider>,
  );
  return { ...f, resizer };
}

const assets = (n: number) => Array.from({ length: n }, (_, i) => ({ uri: `file:///${i + 1}.jpg`, width: 3000, height: 2000 }));

async function toReview(f: Awaited<ReturnType<typeof mount>>, photos = 2) {
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: assets(photos) });
  await fireEvent.press(await screen.findByTestId('list-photo-pick'));
  await fireEvent.press(await screen.findByTestId('list-scan-send'));
  await screen.findByTestId('list-review');
  return f;
}

beforeEach(() => mockReplace.mockClear());

describe('handwritten list scan', () => {
  it('shows the server gate when the API is not configured', async () => {
    await mount(fakeApi(), false);
    expect(await screen.findByText('This needs the Family Recipes server.')).toBeTruthy();
    expect(screen.queryByTestId('list-scan-send')).toBeNull();
  });

  it('uploads at most four photos, with the household, then shows written vs understood rows', async () => {
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: assets(6) });
    const f = await mount();
    await fireEvent.press(await screen.findByTestId('list-photo-pick'));
    await waitFor(() => expect(screen.getByTestId('list-photo-count')).toHaveTextContent(/4/));
    await fireEvent.press(screen.getByTestId('list-scan-send'));
    await screen.findByTestId('list-review');
    const parts = formParts(f.forms[0]);
    expect(parts.filter(([k]) => k === 'images')).toHaveLength(4);
    expect(parts.find(([k]) => k === 'householdId')![1]).toBe('hh-1');
    expect(screen.getByText('Photo 2 was a little blurry.')).toBeTruthy();
    expect(screen.getByText(/Written: 2 spuds/)).toBeTruthy();
    expect(screen.getByTestId('row-name-r1').props.value).toBe('potatoes');
    expect(screen.getByTestId('row-qty-r1').props.value).toBe('2');
    expect(screen.getByTestId('row-match-r1')).toHaveTextContent('Matched: potatoes - Fruit & veg');
    expect(screen.getByText('Crossed out on the paper: left out by default.')).toBeTruthy();
    expect(screen.getByText('Unsure')).toBeTruthy();
    // crossed-out milk starts excluded
    expect(screen.getByTestId('row-include-r2').props.accessibilityState.checked).toBe(false);
  });

  it('shows the scan error and stays on the photos', async () => {
    await mount(fakeApi({ scanFail: new ServerApiError('The list reader is not configured.', 503, false) }));
    (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: assets(1) });
    await fireEvent.press(await screen.findByTestId('list-photo-pick'));
    await fireEvent.press(screen.getByTestId('list-scan-send'));
    expect(await screen.findByText('The list reader is not configured.')).toBeTruthy();
    expect(screen.queryByTestId('list-review')).toBeNull();
  });

  it('edits, removal and an added row flow into the preview and confirm payloads (current list)', async () => {
    const f = await toReview(await mount());
    await fireEvent.changeText(screen.getByTestId('row-qty-r1'), '3');
    await fireEvent.press(screen.getByTestId('row-remove-r3'));
    await fireEvent.press(screen.getByTestId('row-include-r2')); // switch the crossed-out milk on
    await fireEvent.press(screen.getByTestId('row-add'));
    await fireEvent.changeText(screen.getByTestId('row-name-added-1'), 'tea bags');

    await fireEvent.press(screen.getByTestId('list-preview-button'));
    expect(await screen.findByTestId('list-preview')).toBeTruthy();
    const pv = f.posts.find((p) => p.path.endsWith('/preview'))!;
    expect(pv.path).toBe('/api/shopping/scan/preview');
    expect(pv.body.destination).toEqual({ kind: 'current' });
    expect(pv.body.rows).toEqual([
      { key: 'r1', name: 'potatoes', aisle: 'Fruit & veg', ingredientId: 'ing-potato', value: 3, unit: 'kg' },
      { key: 'r2', name: 'milk', aisle: 'Dairy & eggs' },
      { key: 'added-1', name: 'tea bags', aisle: 'Other' },
    ]);
    expect(screen.getByTestId('preview-r1')).toHaveTextContent(/1 kg -> 3 kg/);

    // editing after a preview clears it (it must describe what confirm sends)
    await fireEvent.changeText(screen.getByTestId('row-qty-r1'), '4');
    await waitFor(() => expect(screen.queryByTestId('list-preview')).toBeNull());
  });

  it('a new named list is the destination, defaulting to the written title', async () => {
    const f = await toReview(await mount());
    await fireEvent.press(screen.getByTestId('dest-new'));
    expect(screen.getByTestId('dest-new-name').props.value).toBe('Saturday shop');
    await fireEvent.changeText(screen.getByTestId('dest-new-name'), 'Party');
    await fireEvent.press(screen.getByTestId('list-confirm'));
    await screen.findByTestId('list-done');
    expect(f.confirms()[0]!.body.destination).toEqual({ kind: 'new', name: 'Party' });
  });

  it('confirm once on a double tap, then link back to Shopping', async () => {
    let release!: () => void;
    const f = await toReview(await mount(fakeApi({ hold: new Promise<void>((r) => { release = r; }) })));
    const btn = screen.getByTestId('list-confirm');
    await fireEvent.press(btn);
    await fireEvent.press(btn); // the first request is still in flight
    release();
    expect(await screen.findByTestId('list-done-message')).toHaveTextContent(/Added 1 new item/);
    expect(f.confirms()).toHaveLength(1);
    await fireEvent.press(screen.getByTestId('list-done-shopping'));
    expect(mockReplace).toHaveBeenCalledWith('/shopping');
  });

  it('a failed confirm shows the server message and the retry reuses the same batch id', async () => {
    const f = await toReview(await mount(fakeApi({ confirmFail: new ServerApiError('This household is read-only while it is pending deletion.', 403, false, 'READ_ONLY') })));
    await fireEvent.press(screen.getByTestId('list-confirm'));
    expect(await screen.findByText('This household is read-only while it is pending deletion.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('list-confirm'));
    await screen.findByTestId('list-done');
    const [a, b] = f.confirms();
    expect(typeof a!.body.batchId).toBe('string');
    expect(b!.body.batchId).toBe(a!.body.batchId);
  });

  it('refuses to send a bad quantity and says why', async () => {
    const f = await toReview(await mount());
    await fireEvent.changeText(screen.getByTestId('row-qty-r1'), '-2');
    expect(await screen.findByText('The quantity must be a number greater than zero, or blank.')).toBeTruthy();
    expect(screen.getByTestId('list-confirm').props.accessibilityState.disabled).toBe(true);
    expect(f.confirms()).toHaveLength(0);
  });
});
