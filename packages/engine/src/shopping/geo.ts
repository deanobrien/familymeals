/**
 * Store locations and "which store am I at?" (P2-A, D390-D399). Pure: no I/O, no clock, no platform APIs.
 *
 * Shared by the web (browser Geolocation while the shopping page is open) and Android (foreground watch + background
 * geofences). The server only ever stores the location the member SAVED for a store (a point and a radius); a live
 * position is compared here, on the device, and never sent anywhere.
 */

export interface GeoPoint {
  lat: number;
  lng: number;
}

/** A position fix. `accuracyM` is the 68% error radius the platform reports (absent = unknown). */
export interface GeoFix extends GeoPoint {
  accuracyM?: number | undefined;
}

export const DEFAULT_RADIUS_M = 150;
export const MIN_RADIUS_M = 50;
export const MAX_RADIUS_M = 1000;
/** A fix less certain than this is ignored: a 400 m error circle cannot say which shop you are in. */
export const MAX_FIX_ACCURACY_M = 100;
/** Once at a store, stay there until you are this many radii away (stops flip-flopping at the edge of a car park). */
export const EXIT_FACTOR = 1.5;
/** Android allows 100 geofences per app; we register far fewer (battery, and nobody shops at more than a handful). */
export const MAX_DEVICE_FENCES = 20;
/** One "near X" nudge per store per this long. */
export const ARRIVAL_COOLDOWN_MS = 4 * 60 * 60 * 1000;

export const isValidPoint = (p: { lat?: unknown; lng?: unknown } | null | undefined): p is GeoPoint =>
  !!p && typeof p.lat === 'number' && typeof p.lng === 'number' && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

/** Clamp to the allowed radius range (non-numbers fall back to the default). */
export function clampRadius(r: unknown): number {
  const n = typeof r === 'number' && Number.isFinite(r) ? Math.round(r) : DEFAULT_RADIUS_M;
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, n));
}

const EARTH_M = 6_371_008.8;
const rad = (d: number): number => (d * Math.PI) / 180;

/** Great-circle distance in metres (haversine). */
export function distanceM(a: GeoPoint, b: GeoPoint): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A store with a saved location, as the device uses it for detection. */
export interface StoreFence extends GeoPoint {
  storeId: string;
  name: string;
  radiusM: number;
}

export interface NearbyStore {
  storeId: string;
  name: string;
  distanceM: number;
}

/**
 * The store this fix puts you at, or null.
 *  - A fix with a poor accuracy is ignored (null: "cannot tell", the caller keeps what it had).
 *  - A store matches when the fix is inside its radius; the closest match wins (ties: name, then id: deterministic).
 *  - Hysteresis: while you are still within EXIT_FACTOR x radius of `currentStoreId`, that store stays selected unless
 *    another store is genuinely inside and closer.
 */
export function pickNearbyStore(
  fix: GeoFix,
  fences: readonly StoreFence[],
  opts: { currentStoreId?: string | null; maxAccuracyM?: number; exitFactor?: number } = {},
): NearbyStore | null {
  if (!isValidPoint(fix)) return null;
  const maxAcc = opts.maxAccuracyM ?? MAX_FIX_ACCURACY_M;
  if (typeof fix.accuracyM === 'number' && Number.isFinite(fix.accuracyM) && fix.accuracyM > maxAcc) return null;
  const exit = opts.exitFactor ?? EXIT_FACTOR;
  const scored = fences
    .filter((f) => isValidPoint(f))
    .map((f) => ({ f, d: distanceM(fix, f) }));
  const inside = scored
    .filter(({ f, d }) => d <= f.radiusM)
    .sort((x, y) => x.d - y.d || x.f.name.localeCompare(y.f.name) || x.f.storeId.localeCompare(y.f.storeId));
  const best = inside[0];
  const current = opts.currentStoreId ? scored.find(({ f }) => f.storeId === opts.currentStoreId) : undefined;
  if (current && current.d <= current.f.radiusM * exit && (!best || best.f.storeId === current.f.storeId || best.d >= current.d)) {
    return { storeId: current.f.storeId, name: current.f.name, distanceM: Math.round(current.d) };
  }
  return best ? { storeId: best.f.storeId, name: best.f.name, distanceM: Math.round(best.d) } : null;
}

/** The fences a device should register: valid ones only, nearest first when we know where we are, capped. */
export function selectDeviceFences(fences: readonly StoreFence[], here?: GeoPoint | null, max = MAX_DEVICE_FENCES): StoreFence[] {
  const valid = fences.filter((f) => isValidPoint(f));
  const keyed = valid.map((f) => ({ f, d: here && isValidPoint(here) ? distanceM(here, f) : 0 }));
  keyed.sort((a, b) => a.d - b.d || a.f.name.localeCompare(b.f.name) || a.f.storeId.localeCompare(b.f.storeId));
  return keyed.slice(0, Math.max(0, max)).map((k) => ({ ...k.f, radiusM: clampRadius(k.f.radiusM) }));
}

export interface ArrivalMemory {
  storeId: string;
  /** epoch ms of the last nudge for that store */
  at: number;
}

/** Whether to show "You're near X": not twice for the same store inside the cooldown. */
export function shouldNotifyArrival(last: readonly ArrivalMemory[], storeId: string, nowMs: number, cooldownMs = ARRIVAL_COOLDOWN_MS): boolean {
  const m = last.find((l) => l.storeId === storeId);
  return !m || nowMs - m.at >= cooldownMs || nowMs < m.at;
}

/** Remember a nudge, dropping entries past the cooldown and keeping the list short. */
export function rememberArrival(last: readonly ArrivalMemory[], storeId: string, nowMs: number, cooldownMs = ARRIVAL_COOLDOWN_MS): ArrivalMemory[] {
  return [...last.filter((l) => l.storeId !== storeId && nowMs - l.at < cooldownMs), { storeId, at: nowMs }].slice(-MAX_DEVICE_FENCES);
}

/** "You're near Tesco - 6 items on your list" (singular/plural; no count = no list). */
export function arrivalMessage(storeName: string, openItems: number): { title: string; body: string } {
  const title = `You're near ${storeName}`;
  const body = openItems > 0 ? `${openItems} ${openItems === 1 ? 'item' : 'items'} on your list.` : 'Nothing left on your list.';
  return { title, body };
}

/** The label shown next to a saved location. */
export function describeDistance(m: number): string {
  if (!Number.isFinite(m)) return '';
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

/* ---------------------------------------------------------------- UK postcodes (postcodes.io lookup input) */

const POSTCODE_RE = /^([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})$/;

/** "ne17ru" -> "NE1 7RU"; null when it is not shaped like a UK postcode (the geocoder is never called with junk). */
export function normalisePostcode(input: string): string | null {
  const s = String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length < 5 || s.length > 7) return null;
  const m = POSTCODE_RE.exec(s);
  return m ? `${m[1]} ${m[2]}` : null;
}

export type StoreLocationSource = 'device' | 'postcode';
