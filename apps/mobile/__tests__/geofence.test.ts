import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import type { StoreFence } from '@fr/engine/shopping';
import {
  GEOFENCE_TASK, cacheOpenCount, defineGeofenceTask, enableSwitching, eraseGeoData, handleArrival, loadFences, loadGeoState,
  saveGeoState, setNearStoreWanted, syncGeofencing, takePendingArrival,
} from '@/lib/geofence';
import { fencesOf, parseLocations } from '@/lib/locationApi';

const loc = Location as unknown as { __state: { fgStatus: string; bgStatus: string; geofences: Array<{ identifier: string; radius: number }> | null } };
const tm = TaskManager as unknown as { __tasks: Record<string, (b: unknown) => Promise<void>> };
const TESCO: StoreFence = { storeId: 't', name: 'Tesco Extra', lat: 54.97, lng: -1.61, radiusM: 150 };
const ALDI: StoreFence = { storeId: 'a', name: 'ALDI', lat: 55.0, lng: -1.6, radiusM: 120 };

beforeEach(async () => {
  await AsyncStorage.clear();
  loc.__state.fgStatus = 'granted';
  loc.__state.bgStatus = 'granted';
  loc.__state.geofences = null;
  jest.clearAllMocks();
  (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'granted', canAskAgain: true });
});

describe('enabling and registering', () => {
  it('foreground mode registers no OS geofences', async () => {
    const r = await enableSwitching('foreground', 'hh', [TESCO]);
    expect(r).toEqual({ ok: true });
    expect(await loadGeoState()).toEqual({ mode: 'foreground', householdId: 'hh' });
    expect(loc.__state.geofences).toBeNull();
    expect(Location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('background mode registers one geofence per saved store with its radius, enter only', async () => {
    expect(await enableSwitching('background', 'hh', [TESCO, ALDI])).toEqual({ ok: true });
    expect(loc.__state.geofences!.map((g) => [g.identifier, g.radius])).toEqual([['a', 120], ['t', 150]]); // no position known: by name
    const regions = (Location.startGeofencingAsync as jest.Mock).mock.calls[0]![1] as Array<{ notifyOnEnter: boolean; notifyOnExit: boolean }>;
    expect(regions.every((r) => r.notifyOnEnter && !r.notifyOnExit)).toBe(true);
  });

  it('refused permissions turn nothing on', async () => {
    loc.__state.fgStatus = 'denied';
    expect(await enableSwitching('foreground', 'hh', [TESCO])).toEqual({ ok: false, reason: 'denied' });
    expect((await loadGeoState()).mode).toBe('off');
    loc.__state.fgStatus = 'granted';
    loc.__state.bgStatus = 'denied';
    expect(await enableSwitching('background', 'hh', [TESCO])).toEqual({ ok: false, reason: 'background_denied' });
    expect((await loadGeoState()).mode).toBe('off');
    expect(loc.__state.geofences).toBeNull();
  });

  it('re-syncing replaces the geofences; switching to foreground or no fences removes them', async () => {
    await enableSwitching('background', 'hh', [TESCO, ALDI]);
    await syncGeofencing([TESCO], 'background');
    expect(loc.__state.geofences!.map((g) => g.identifier)).toEqual(['t']);
    await syncGeofencing([TESCO], 'foreground');
    expect(loc.__state.geofences).toBeNull();
    await syncGeofencing([], 'background');
    expect(loc.__state.geofences).toBeNull();
  });
});

describe('arrival handling (what the background task does)', () => {
  const t0 = 1_000_000_000_000;
  it('does nothing unless background switching is on', async () => {
    await saveGeoState({ mode: 'foreground', householdId: 'hh' });
    expect(await handleArrival('t')).toEqual({ switched: false, notified: false });
    expect(await takePendingArrival()).toBeNull();
  });

  it('records the arrival for the shopping screen, without a nudge when the nudge is off', async () => {
    await enableSwitching('background', 'hh', [TESCO]);
    const notify = jest.fn(async () => undefined);
    expect(await handleArrival('t', { now: () => t0, notify })).toEqual({ switched: true, notified: false });
    expect(notify).not.toHaveBeenCalled();
    expect(await takePendingArrival(t0 + 1000)).toEqual({ storeId: 't', at: t0 });
    expect(await takePendingArrival(t0 + 2000)).toBeNull(); // taken once
  });

  it('ignores a store that is not in the saved fences', async () => {
    await enableSwitching('background', 'hh', [TESCO]);
    expect(await handleArrival('unknown', { now: () => t0 })).toEqual({ switched: false, notified: false });
  });

  it('nudges once per store per cooldown, with the cached item count', async () => {
    await enableSwitching('background', 'hh', [TESCO]);
    await setNearStoreWanted(true);
    await cacheOpenCount('hh', 6);
    const notify = jest.fn(async () => undefined);
    expect((await handleArrival('t', { now: () => t0, notify })).notified).toBe(true);
    expect(notify).toHaveBeenCalledWith("You're near Tesco Extra", '6 items on your list.');
    expect((await handleArrival('t', { now: () => t0 + 60_000, notify })).notified).toBe(false);
    expect((await handleArrival('t', { now: () => t0 + 5 * 3600_000, notify })).notified).toBe(true);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('says to open the list when the count is unknown (a different household cached it)', async () => {
    await enableSwitching('background', 'hh', [TESCO]);
    await setNearStoreWanted(true);
    await cacheOpenCount('someone-else', 3);
    const notify = jest.fn(async () => undefined);
    await handleArrival('t', { now: () => t0, notify });
    expect(notify).toHaveBeenCalledWith("You're near Tesco Extra", 'Open your shopping list to see what you need.');
  });

  it('an old pending arrival is not applied', async () => {
    await enableSwitching('background', 'hh', [TESCO]);
    await handleArrival('t', { now: () => t0 });
    expect(await takePendingArrival(t0 + 31 * 60_000)).toBeNull();
  });

  it('local notification needs notification permission and uses the shared channel', async () => {
    await enableSwitching('background', 'hh', [TESCO]);
    await setNearStoreWanted(true);
    await handleArrival('t', { now: () => t0 });
    expect(Notifications.scheduleNotificationAsync).toHaveBeenCalledWith(expect.objectContaining({ trigger: { channelId: 'default' } }));
    (Notifications.getPermissionsAsync as jest.Mock).mockResolvedValue({ status: 'denied', canAskAgain: false });
    (Notifications.scheduleNotificationAsync as jest.Mock).mockClear();
    await handleArrival('t', { now: () => t0 + 6 * 3600_000 });
    expect(Notifications.scheduleNotificationAsync).not.toHaveBeenCalled();
  });
});

describe('the OS task', () => {
  it('is registered once and reacts to enter events only', async () => {
    defineGeofenceTask();
    defineGeofenceTask();
    expect(Object.keys(tm.__tasks)).toEqual([GEOFENCE_TASK]);
    await enableSwitching('background', 'hh', [TESCO]);
    const run = tm.__tasks[GEOFENCE_TASK]!;
    await run({ data: { eventType: Location.GeofencingEventType.Exit, region: { identifier: 't' } } });
    expect(await takePendingArrival()).toBeNull();
    await run({ error: new Error('x') });
    await run({ data: { eventType: Location.GeofencingEventType.Enter, region: { identifier: 't' } } });
    expect((await takePendingArrival())?.storeId).toBe('t');
  });
});

describe('turn off and erase', () => {
  it('stops geofencing and deletes everything the feature keeps on the device', async () => {
    await enableSwitching('background', 'hh', [TESCO]);
    await setNearStoreWanted(true);
    await cacheOpenCount('hh', 2);
    await handleArrival('t', { now: () => 1, notify: async () => undefined });
    await eraseGeoData();
    expect(loc.__state.geofences).toBeNull();
    expect(await loadGeoState()).toEqual({ mode: 'off', householdId: null });
    expect(await loadFences()).toEqual([]);
    const keys = await AsyncStorage.getAllKeys();
    expect(keys.filter((k) => k.startsWith('fr:geo:'))).toEqual([]);
  });
});

describe('locations payload', () => {
  it('parses defensively and builds fences for stores that exist', () => {
    const v = parseLocations({
      stores: [{ id: 'a', name: 'ALDI' }, { name: 'no id' }],
      locations: [{ storeId: 'a', lat: 55, lng: -1.6, radiusM: 200, source: 'postcode', postcode: 'NE3 1AA' }, { storeId: 'a', lat: 999, lng: 0 }, { storeId: 'gone', lat: 1, lng: 1 }],
    });
    expect(v.stores).toHaveLength(1);
    expect(v.locations).toHaveLength(2);
    expect(fencesOf(v)).toEqual([{ storeId: 'a', name: 'ALDI', lat: 55, lng: -1.6, radiusM: 200 }]);
    expect(parseLocations(null)).toEqual({ stores: [], locations: [] });
  });
});
