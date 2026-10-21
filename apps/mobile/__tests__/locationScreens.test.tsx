import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Speech from 'expo-speech-recognition';
import { AppState } from 'react-native';
import { loadGeoState, saveGeoState, saveFences, setNearStoreWanted } from '@/lib/geofence';
import { parseSettings } from '@/lib/notificationsApi';
import type { ServerApi } from '@/lib/serverApi';
import { useStoreArrival } from '@/lib/useStoreArrival';
import { LocationSettingsBody } from '@/screens/location/LocationSettingsScreen';
import VoiceAddSheet from '@/screens/VoiceAddSheet';

jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }), useFocusEffect: jest.fn() }));

const loc = Location as unknown as { __state: { fgStatus: string; bgStatus: string; geofences: unknown[] | null; watchers: Array<(l: unknown) => void>; position: { coords: Record<string, number | null> } } };
const speech = Speech as unknown as { __state: { available: boolean; granted: boolean }; __emit: (n: string, e: unknown) => void };

type Call = { method: string; path: string; payload: Record<string, unknown> };
function fakeApi(opts: { postcodeFails?: boolean } = {}) {
  const calls: Call[] = [];
  let locations: Array<Record<string, unknown>> = [];
  let settings = parseSettings({});
  const stores = [{ id: 's1', name: 'Tesco Extra', chain: 'Tesco' }, { id: 's2', name: 'ALDI', chain: 'ALDI' }];
  const view = () => ({ stores, locations });
  const api: ServerApi = {
    configured: true,
    get: async (path, query) => {
      calls.push({ method: 'GET', path, payload: (query ?? {}) as Record<string, unknown> });
      if (path === '/api/stores/locations') return view() as never;
      if (path === '/api/stores/geocode') {
        if (opts.postcodeFails) throw new Error('That postcode was not found.');
        return { postcode: 'NE3 1AA', lat: 55.0, lng: -1.62, area: 'Newcastle', attribution: 'x' } as never;
      }
      if (path === '/api/notifications/settings') return { settings, devices: { web: 0, android: 0 } } as never;
      throw new Error(`unexpected GET ${path}`);
    },
    post: async (path, body) => {
      const b = body as Record<string, unknown>;
      calls.push({ method: 'POST', path, payload: b });
      if (path === '/api/stores/locations') {
        locations = locations.filter((l) => l.storeId !== b.storeId);
        if (b.action === 'set') locations.push({ storeId: b.storeId, lat: b.lat, lng: b.lng, radiusM: b.radiusM ?? 150, source: b.source, postcode: b.postcode ?? null });
        return view() as never;
      }
      if (path === '/api/notifications/settings') {
        settings = parseSettings(b.settings);
        return { settings, devices: { web: 0, android: 0 } } as never;
      }
      if (path === '/api/shopping/voice/parse') {
        return { rows: [
          { key: 'v1', text: 'milk', name: 'Milk', aisle: 'Dairy & eggs' },
          { key: 'v2', text: 'two tins of tomatoes', name: 'Tomato', value: 2, unit: 'can', aisle: 'Tinned & jarred' },
          { key: 'v3', text: 'eggs', name: 'Egg', aisle: 'Dairy & eggs' },
        ] } as never;
      }
      if (path === '/api/shopping/scan/confirm') return { ok: true, message: `Added ${(b.rows as unknown[]).length} items.`, added: (b.rows as unknown[]).length, merged: 0 } as never;
      throw new Error(`unexpected POST ${path}`);
    },
    postForm: async () => { throw new Error('unused'); },
    webUrl: () => null,
    authHeaders: async () => ({}),
  };
  return { api, calls, posts: (p: string) => calls.filter((c) => c.method === 'POST' && c.path === p) };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  loc.__state.fgStatus = 'granted';
  loc.__state.bgStatus = 'granted';
  loc.__state.geofences = null;
  loc.__state.watchers = [];
  loc.__state.position = { coords: { latitude: 54.9783, longitude: -1.6178, accuracy: 10 } };
  speech.__state.available = true;
  speech.__state.granted = true;
  jest.clearAllMocks();
});

describe('LocationSettingsBody', () => {
  it('explains the feature, shows stores, and saves "use my current location" (the position of the shop, once)', async () => {
    const { api, posts } = fakeApi();
    await render(<LocationSettingsBody api={api} householdId="hh" />);
    expect(await screen.findByText(/only compared on this phone/i)).toBeTruthy();
    expect(screen.getByTestId('loc-status-s1').props.children).toMatch(/No location yet/);
    await fireEvent.press(screen.getByTestId('loc-here-s1'));
    await waitFor(() => expect(screen.getByTestId('loc-status-s1').props.children).toMatch(/from your position in the shop/));
    expect(posts('/api/stores/locations')[0]!.payload).toMatchObject({ householdId: 'hh', storeId: 's1', action: 'set', source: 'device', lat: 54.9783, lng: -1.6178, radiusM: 150 });
    // the body carries only the saved store spot, never an accuracy or any other live field
    expect(Object.keys(posts('/api/stores/locations')[0]!.payload).sort()).toEqual(['action', 'householdId', 'lat', 'lng', 'radiusM', 'source', 'storeId']);
  });

  it('refuses a rough fix and a denied permission', async () => {
    const { api, posts } = fakeApi();
    await render(<LocationSettingsBody api={api} householdId="hh" />);
    loc.__state.position = { coords: { latitude: 54.9, longitude: -1.6, accuracy: 800 } };
    await fireEvent.press(await screen.findByTestId('loc-here-s1'));
    expect(await screen.findByText(/too rough to save/)).toBeTruthy();
    loc.__state.fgStatus = 'denied';
    await fireEvent.press(screen.getByTestId('loc-here-s1'));
    expect(await screen.findByText(/Location is blocked/)).toBeTruthy();
    expect(posts('/api/stores/locations')).toHaveLength(0);
  });

  it('postcode lookup saves the geocoded point; a failed lookup says so', async () => {
    const ok = fakeApi();
    await render(<LocationSettingsBody api={ok.api} householdId="hh" />);
    await fireEvent.changeText(await screen.findByTestId('loc-postcode-s2'), 'ne31aa');
    await fireEvent.press(screen.getByTestId('loc-lookup-s2'));
    await waitFor(() => expect(screen.getByTestId('loc-status-s2').props.children).toMatch(/from NE3 1AA/));
    expect(ok.posts('/api/stores/locations')[0]!.payload).toMatchObject({ source: 'postcode', postcode: 'NE3 1AA', lat: 55 });
  });

  it('shows the server message when the lookup fails', async () => {
    const bad = fakeApi({ postcodeFails: true });
    await render(<LocationSettingsBody api={bad.api} householdId="hh" />);
    await fireEvent.changeText(await screen.findByTestId('loc-postcode-s1'), 'zz99zz');
    await fireEvent.press(screen.getByTestId('loc-lookup-s1'));
    expect(await screen.findByText('That postcode was not found.')).toBeTruthy();
  });

  it('switching needs a saved location first; then foreground and background turn on and register geofences', async () => {
    const { api } = fakeApi();
    await render(<LocationSettingsBody api={api} householdId="hh" />);
    await fireEvent(await screen.findByTestId('geo-foreground'), 'valueChange', true);
    expect(await screen.findByText(/Save a location for at least one store first/)).toBeTruthy();
    expect((await loadGeoState()).mode).toBe('off');
    await fireEvent.press(screen.getByTestId('loc-here-s1'));
    await waitFor(() => expect(screen.getByTestId('loc-status-s1').props.children).toMatch(/Saved/));
    await fireEvent(screen.getByTestId('geo-foreground'), 'valueChange', true);
    await waitFor(async () => expect((await loadGeoState()).mode).toBe('foreground'));
    expect(loc.__state.geofences).toBeNull();
    await fireEvent(screen.getByTestId('geo-background'), 'valueChange', true);
    await waitFor(async () => expect((await loadGeoState()).mode).toBe('background'));
    expect(loc.__state.geofences).toHaveLength(1);
  });

  it('background refused: stays foreground-only and says how to allow it', async () => {
    const { api } = fakeApi();
    await render(<LocationSettingsBody api={api} householdId="hh" />);
    await fireEvent.press(await screen.findByTestId('loc-here-s1'));
    await waitFor(() => expect(screen.getByTestId('loc-status-s1').props.children).toMatch(/Saved/));
    await fireEvent(screen.getByTestId('geo-foreground'), 'valueChange', true);
    await waitFor(async () => expect((await loadGeoState()).mode).toBe('foreground'));
    loc.__state.bgStatus = 'denied';
    await fireEvent(screen.getByTestId('geo-background'), 'valueChange', true);
    expect(await screen.findByText(/Allow all the time/)).toBeTruthy();
    expect((await loadGeoState()).mode).toBe('foreground');
    expect(loc.__state.geofences).toBeNull();
  });

  it('the near-store nudge saves as a notification preference and is remembered on the device', async () => {
    const { api, posts } = fakeApi();
    await render(<LocationSettingsBody api={api} householdId="hh" />);
    await fireEvent.press(await screen.findByTestId('loc-here-s1'));
    await waitFor(() => expect(screen.getByTestId('loc-status-s1').props.children).toMatch(/Saved/));
    await fireEvent(screen.getByTestId('geo-foreground'), 'valueChange', true);
    await fireEvent(await screen.findByTestId('geo-background'), 'valueChange', true);
    await waitFor(async () => expect((await loadGeoState()).mode).toBe('background'));
    await fireEvent(screen.getByTestId('geo-nudge'), 'valueChange', true);
    await waitFor(() => expect(posts('/api/notifications/settings')).toHaveLength(1));
    const saved = posts('/api/notifications/settings')[0]!.payload.settings as { types: Record<string, { inApp: boolean; push: boolean }> };
    expect(saved.types.near_store).toEqual({ inApp: true, push: true });
    expect(await AsyncStorage.getItem('fr:geo:nudge:v1')).toBe('true');
  });

  it('"Turn off and erase" stops everything and clears the device data', async () => {
    const { api } = fakeApi();
    await saveGeoState({ mode: 'background', householdId: 'hh' });
    await saveFences([{ storeId: 's1', name: 'Tesco Extra', lat: 1, lng: 1, radiusM: 150 }]);
    await setNearStoreWanted(true);
    await render(<LocationSettingsBody api={api} householdId="hh" />);
    await fireEvent.press(await screen.findByTestId('geo-erase'));
    await waitFor(async () => expect((await AsyncStorage.getAllKeys()).filter((k) => k.startsWith('fr:geo:'))).toEqual([]));
    expect(await screen.findByText(/everything location-related on this phone was deleted/i)).toBeTruthy();
  });
});

function ArrivalProbe({ storeId, onArrive }: { storeId: string | null; onArrive: (id: string, n: string) => void }) {
  useStoreArrival({ householdId: 'hh', storeId, onArrive });
  return null;
}

describe('useStoreArrival (foreground watch)', () => {
  const fence = { storeId: 's1', name: 'Tesco Extra', lat: 54.9783, lng: -1.6178, radiusM: 150 };
  const fix = (lat: number, lng: number, accuracy = 10) => ({ coords: { latitude: lat, longitude: lng, accuracy } });

  it('does nothing and asks for no permission while switching is off', async () => {
    const onArrive = jest.fn();
    await render(<ArrivalProbe storeId={null} onArrive={onArrive} />);
    await act(async () => undefined);
    expect(Location.watchPositionAsync).not.toHaveBeenCalled();
    expect(Location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('switches to the store you are inside, ignores far or imprecise fixes, and stops on unmount', async () => {
    await saveGeoState({ mode: 'foreground', householdId: 'hh' });
    await saveFences([fence]);
    const onArrive = jest.fn();
    const view = await render(<ArrivalProbe storeId={null} onArrive={onArrive} />);
    await waitFor(() => expect(loc.__state.watchers).toHaveLength(1));
    const emit = (l: unknown) => act(async () => loc.__state.watchers.forEach((w) => w(l)));
    await emit(fix(51.5, -0.12));
    await emit(fix(54.9783, -1.6178, 500));
    expect(onArrive).not.toHaveBeenCalled();
    await emit(fix(54.9784, -1.6179, 12));
    expect(onArrive).toHaveBeenCalledWith('s1', 'Tesco Extra');
    await view.unmount();
    expect(loc.__state.watchers).toHaveLength(0);
  });

  it('does not re-announce the store you are already shopping at', async () => {
    await saveGeoState({ mode: 'foreground', householdId: 'hh' });
    await saveFences([fence]);
    const onArrive = jest.fn();
    await render(<ArrivalProbe storeId="s1" onArrive={onArrive} />);
    await waitFor(() => expect(loc.__state.watchers).toHaveLength(1));
    await act(async () => loc.__state.watchers.forEach((w) => w(fix(54.9783, -1.6178))));
    expect(onArrive).not.toHaveBeenCalled();
  });

  it('applies a recent background arrival once', async () => {
    await saveGeoState({ mode: 'background', householdId: 'hh' });
    await saveFences([fence]);
    await AsyncStorage.setItem('fr:geo:pending:v1', JSON.stringify({ storeId: 's1', at: Date.now() - 60_000 }));
    const onArrive = jest.fn();
    await render(<ArrivalProbe storeId={null} onArrive={onArrive} />);
    await waitFor(() => expect(onArrive).toHaveBeenCalledWith('s1', 'Tesco Extra'));
    expect(await AsyncStorage.getItem('fr:geo:pending:v1')).toBeNull();
  });

  it('pauses the watch when the app goes to the background', async () => {
    await saveGeoState({ mode: 'foreground', householdId: 'hh' });
    await saveFences([fence]);
    let handler: ((s: string) => void) | null = null;
    const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation(((_: string, h: (s: string) => void) => { handler = h; return { remove: jest.fn() }; }) as never);
    await render(<ArrivalProbe storeId={null} onArrive={jest.fn()} />);
    await waitFor(() => expect(loc.__state.watchers).toHaveLength(1));
    await act(async () => handler!('background'));
    expect(loc.__state.watchers).toHaveLength(0);
    spy.mockRestore();
  });
});

describe('VoiceAddSheet', () => {
  function open(api: ServerApi, onAdded = jest.fn()) {
    return render(<VoiceAddSheet api={api} householdId="hh" open onClose={jest.fn()} onAdded={onAdded} />);
  }

  it('listen, read, review chips, leave one out, add (idempotent batch id)', async () => {
    const { api, posts } = fakeApi();
    const onAdded = jest.fn();
    await open(api, onAdded);
    await fireEvent.press(screen.getByTestId('voice-mic'));
    expect(Speech.ExpoSpeechRecognitionModule.start).toHaveBeenCalledWith(expect.objectContaining({ lang: 'en-GB' }));
    await act(async () => speech.__emit('result', { results: [{ transcript: 'add milk, two tins of tomatoes and eggs' }] }));
    expect(screen.getByTestId('voice-text').props.value).toBe('add milk, two tins of tomatoes and eggs');
    await act(async () => speech.__emit('end', {}));
    await fireEvent.press(screen.getByTestId('voice-read'));
    expect(await screen.findByTestId('voice-chip-v2')).toBeTruthy();
    expect(posts('/api/shopping/voice/parse')[0]!.payload).toEqual({ householdId: 'hh', transcript: 'add milk, two tins of tomatoes and eggs' });
    await fireEvent.press(screen.getByTestId('voice-chip-v3')); // leave the eggs out
    await fireEvent.press(screen.getByTestId('voice-add'));
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('Added 2 items.'));
    const body = posts('/api/shopping/scan/confirm')[0]!.payload as { rows: Array<{ key: string; value?: number; unit?: string }>; batchId: string; destination: unknown };
    expect(body.rows.map((r) => r.key)).toEqual(['v1', 'v2']);
    expect(body.rows[1]).toMatchObject({ value: 2, unit: 'can' });
    expect(body.destination).toEqual({ kind: 'current' });
    expect(body.batchId).toMatch(/^[\w-]{8,64}$/);
  });

  it('microphone permission denied explains and keeps typing available', async () => {
    speech.__state.granted = false;
    const { api } = fakeApi();
    await open(api);
    await fireEvent.press(screen.getByTestId('voice-mic'));
    expect(await screen.findByText(/microphone is blocked/)).toBeTruthy();
    expect(Speech.ExpoSpeechRecognitionModule.start).not.toHaveBeenCalled();
    await fireEvent.changeText(screen.getByTestId('voice-text'), 'rice');
    expect(screen.getByTestId('voice-read').props.accessibilityState?.disabled).toBeFalsy();
  });

  it('with no recogniser the typed fallback works', async () => {
    speech.__state.available = false;
    const { api, posts } = fakeApi();
    await open(api);
    expect(screen.getByTestId('voice-unsupported')).toBeTruthy();
    expect(screen.queryByTestId('voice-mic')).toBeNull();
    await fireEvent.changeText(screen.getByTestId('voice-text'), 'milk and eggs');
    await fireEvent.press(screen.getByTestId('voice-read'));
    expect(await screen.findByTestId('voice-chip-v1')).toBeTruthy();
    expect(posts('/api/shopping/voice/parse')).toHaveLength(1);
  });

  it('a recognition error is shown in plain words', async () => {
    const { api } = fakeApi();
    await open(api);
    await act(async () => speech.__emit('error', { error: 'no-speech' }));
    expect(await screen.findByText(/Nothing was heard/)).toBeTruthy();
  });
});
