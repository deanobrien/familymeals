/**
 * Location-based store switching on the phone (P2-A, D392-D394). Opt-in, off by default.
 *
 *  - The server stores only the location a member SAVED for a store. The geofence regions below are built from those
 *    saved locations and registered with Android on THIS device; the detection (is this phone inside a store's radius?)
 *    happens on the device and no live position is ever sent to the server or logged.
 *  - "foreground": the shopping screen watches the position only while it is open (expo-location watch).
 *  - "background": additionally registers OS geofences (expo-location + expo-task-manager) so arriving at a store can
 *    switch the "Shopping at" store and show the optional "You're near X" notification while the app is closed.
 *  - Everything this module keeps (mode, saved fences, arrival memory) is in AsyncStorage on the device and is erased by
 *    `eraseGeoData()` ("Turn off and erase" in Settings, and on sign-out).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import {
  arrivalMessage, rememberArrival, selectDeviceFences, shouldNotifyArrival, type ArrivalMemory, type StoreFence,
} from '@fr/engine/shopping';

export const GEOFENCE_TASK = 'fr-store-geofence';
export type LocationMode = 'off' | 'foreground' | 'background';

const K = {
  state: 'fr:geo:state:v1',
  fences: 'fr:geo:fences:v1',
  memory: 'fr:geo:arrivals:v1',
  pending: 'fr:geo:pending:v1',
  count: 'fr:geo:count:v1',
  nudge: 'fr:geo:nudge:v1',
};
const ALL_KEYS = Object.values(K);
export const PENDING_MAX_AGE_MS = 30 * 60 * 1000;

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
const writeJson = (key: string, v: unknown): Promise<void> => AsyncStorage.setItem(key, JSON.stringify(v)).catch(() => undefined);

export interface GeoState { mode: LocationMode; householdId: string | null }
export const loadGeoState = async (): Promise<GeoState> => {
  const s = await readJson<Partial<GeoState>>(K.state, {});
  return { mode: s.mode === 'foreground' || s.mode === 'background' ? s.mode : 'off', householdId: typeof s.householdId === 'string' ? s.householdId : null };
};
export const saveGeoState = (s: GeoState): Promise<void> => writeJson(K.state, s);

export const loadFences = (): Promise<StoreFence[]> => readJson<StoreFence[]>(K.fences, []).then((f) => (Array.isArray(f) ? f : []));
export const saveFences = (f: readonly StoreFence[]): Promise<void> => writeJson(K.fences, selectDeviceFences(f));

/** Cached by the settings screens so the background task knows whether the "near" nudge is wanted (the member's preference). */
export const setNearStoreWanted = (on: boolean): Promise<void> => writeJson(K.nudge, on);
export const nearStoreWanted = (): Promise<boolean> => readJson<boolean>(K.nudge, false);
/** The shopping screen keeps the number of open items so the nudge can say "6 items on your list" with the app closed. */
export const cacheOpenCount = (householdId: string, n: number): Promise<void> => writeJson(K.count, { householdId, n });
const loadOpenCount = async (householdId: string | null): Promise<number | null> => {
  const c = await readJson<{ householdId?: string; n?: number } | null>(K.count, null);
  return c && c.householdId === householdId && typeof c.n === 'number' ? c.n : null;
};

export interface PendingArrival { storeId: string; at: number }
/** The store the phone arrived at while the app was closed; the shopping screen applies it once, if recent. */
export async function takePendingArrival(nowMs = Date.now()): Promise<PendingArrival | null> {
  const p = await readJson<PendingArrival | null>(K.pending, null);
  if (!p) return null;
  await AsyncStorage.removeItem(K.pending).catch(() => undefined);
  return nowMs - p.at <= PENDING_MAX_AGE_MS && nowMs >= p.at ? p : null;
}

export interface ArrivalDeps {
  now?: () => number;
  notify?: (title: string, body: string) => Promise<void>;
}

/** Local notification on the shared channel. Only if the member has already granted notification permission. */
export async function showLocalNotification(title: string, body: string): Promise<void> {
  const p = await Notifications.getPermissionsAsync();
  if (p.status !== 'granted') return;
  await Notifications.scheduleNotificationAsync({ content: { title, body, data: { link: '/shopping' } }, trigger: { channelId: 'default' } as never });
}

/**
 * A geofence "enter" for `storeId` (called by the background task): remember it for the shopping screen, and, when the
 * member turned the nudge on and we have not nudged for this store recently, show "You're near X - N items on your list".
 */
export async function handleArrival(storeId: string, deps: ArrivalDeps = {}): Promise<{ switched: boolean; notified: boolean }> {
  const now = (deps.now ?? Date.now)();
  const state = await loadGeoState();
  if (state.mode !== 'background') return { switched: false, notified: false };
  const fence = (await loadFences()).find((f) => f.storeId === storeId);
  if (!fence) return { switched: false, notified: false };
  await writeJson(K.pending, { storeId, at: now } satisfies PendingArrival);
  let notified = false;
  if (await nearStoreWanted()) {
    const memory = await readJson<ArrivalMemory[]>(K.memory, []);
    if (shouldNotifyArrival(memory, storeId, now)) {
      const n = await loadOpenCount(state.householdId);
      const msg = n === null ? { title: `You're near ${fence.name}`, body: 'Open your shopping list to see what you need.' } : arrivalMessage(fence.name, n);
      await (deps.notify ?? showLocalNotification)(msg.title, msg.body);
      await writeJson(K.memory, rememberArrival(memory, storeId, now));
      notified = true;
    }
  }
  return { switched: true, notified };
}

/** Registered at start-up (app/_layout.tsx imports this module): Android runs it when the app is not in the foreground. */
export function defineGeofenceTask(): void {
  if (TaskManager.isTaskDefined?.(GEOFENCE_TASK)) return;
  TaskManager.defineTask(GEOFENCE_TASK, async ({ data, error }: { data?: unknown; error?: unknown }) => {
    if (error || !data) return;
    const d = data as { eventType?: number; region?: { identifier?: string } };
    if (d.eventType !== Location.GeofencingEventType.Enter || !d.region?.identifier) return;
    try {
      await handleArrival(d.region.identifier);
    } catch {
      /* a failed nudge must never crash the task */
    }
  });
}

/* ---------------------------------------------------------------- permissions and registration */

export type EnableResult = { ok: true } | { ok: false; reason: 'denied' | 'background_denied' | 'unavailable' };

/** Ask for foreground location (and background when `mode === 'background'`). Only ever called from a button tap. */
export async function requestLocationPermission(mode: Exclude<LocationMode, 'off'>): Promise<EnableResult> {
  try {
    const fg = await Location.requestForegroundPermissionsAsync();
    if (fg.status !== 'granted') return { ok: false, reason: 'denied' };
    if (mode === 'background') {
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status !== 'granted') return { ok: false, reason: 'background_denied' };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

export async function stopGeofencing(): Promise<void> {
  try {
    if (await Location.hasStartedGeofencingAsync(GEOFENCE_TASK)) await Location.stopGeofencingAsync(GEOFENCE_TASK);
  } catch {
    /* not registered */
  }
}

/** (Re)register the OS geofences for the saved fences (background mode only; otherwise they are removed). */
export async function syncGeofencing(fences: readonly StoreFence[], mode: LocationMode): Promise<void> {
  const chosen = selectDeviceFences(fences);
  await saveFences(chosen);
  await stopGeofencing();
  if (mode !== 'background' || chosen.length === 0) return;
  await Location.startGeofencingAsync(
    GEOFENCE_TASK,
    chosen.map((f) => ({ identifier: f.storeId, latitude: f.lat, longitude: f.lng, radius: f.radiusM, notifyOnEnter: true, notifyOnExit: false })),
  );
}

/** Turn switching on in a mode; persists the mode and registers fences. */
export async function enableSwitching(mode: Exclude<LocationMode, 'off'>, householdId: string, fences: readonly StoreFence[]): Promise<EnableResult> {
  const r = await requestLocationPermission(mode);
  if (!r.ok) return r;
  await saveGeoState({ mode, householdId });
  await syncGeofencing(fences, mode);
  return { ok: true };
}

/** "Turn off and erase": stops geofencing and deletes everything this feature keeps on the device. */
export async function eraseGeoData(): Promise<void> {
  await stopGeofencing();
  await Promise.all(ALL_KEYS.map((k) => AsyncStorage.removeItem(k).catch(() => undefined)));
}
