// Browser side of store locations (P2-A, D390-D392, D396): calls the same JSON routes the Android app uses, and wraps the
// browser Geolocation API. A live position stays in the browser: it is compared with the saved store locations here and is
// only ever sent to the server when the member presses "Use my current location" for a STORE (to save that store's spot).
import { MAX_FIX_ACCURACY_M, isValidPoint, type GeoFix, type StoreFence } from '@fr/engine/shopping';
import type { Store } from '../shopping/engine';
import type { StoreLocation } from './locations';

export interface LocationsPayload {
  stores: Store[];
  locations: StoreLocation[];
}

export interface GeocodePayload {
  postcode: string;
  lat: number;
  lng: number;
  area: string | null;
  attribution: string;
}

type Fetch = typeof fetch;

async function errorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const b = (await res.json()) as { error?: { message?: string } };
    return b.error?.message || fallback;
  } catch {
    return fallback;
  }
}

export class LocationApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'LocationApiError';
  }
}

export async function loadLocations(f: Fetch = fetch): Promise<LocationsPayload> {
  const res = await f('/api/stores/locations', { cache: 'no-store' });
  if (!res.ok) throw new LocationApiError(await errorMessage(res, 'Could not load store locations.'), res.status);
  return (await res.json()) as LocationsPayload;
}

export type SaveBody =
  | { storeId: string; action: 'clear' }
  | { storeId: string; action: 'set'; lat: number; lng: number; radiusM?: number; source: 'device'; postcode?: undefined }
  | { storeId: string; action: 'set'; lat: number; lng: number; radiusM?: number; source: 'postcode'; postcode: string };

export async function changeLocation(body: SaveBody, f: Fetch = fetch): Promise<LocationsPayload> {
  const res = await f('/api/stores/locations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new LocationApiError(await errorMessage(res, 'Could not save that location.'), res.status);
  return (await res.json()) as LocationsPayload;
}

export async function geocodePostcode(postcode: string, f: Fetch = fetch): Promise<GeocodePayload> {
  const res = await f(`/api/stores/geocode?postcode=${encodeURIComponent(postcode)}`, { cache: 'no-store' });
  if (!res.ok) throw new LocationApiError(await errorMessage(res, 'The postcode lookup failed.'), res.status);
  return (await res.json()) as GeocodePayload;
}

/** The stores that have a usable saved location, as the detection logic wants them. */
export function fencesOf(stores: readonly Store[], locations: readonly StoreLocation[]): StoreFence[] {
  const byId = new Map(stores.map((s) => [s.id, s]));
  return locations
    .filter((l) => byId.has(l.storeId) && isValidPoint(l))
    .map((l) => ({ storeId: l.storeId, name: byId.get(l.storeId)!.name, lat: l.lat, lng: l.lng, radiusM: l.radiusM }));
}

/* ---------------------------------------------------------------- browser geolocation */

export type GeoFailure = 'unsupported' | 'denied' | 'unavailable' | 'timeout' | 'imprecise';

export class GeolocationFailure extends Error {
  constructor(readonly reason: GeoFailure, message: string) {
    super(message);
    this.name = 'GeolocationFailure';
  }
}

export const GEO_MESSAGES: Record<GeoFailure, string> = {
  unsupported: 'This browser cannot share your location.',
  denied: 'Location is blocked for this site. Allow it in your browser settings, or use a postcode instead.',
  unavailable: 'Your position is not available right now. Try again outdoors, or use a postcode instead.',
  timeout: 'Finding your position took too long. Try again, or use a postcode instead.',
  imprecise: 'Your position is too rough to tell which shop you are in. Try again outdoors, or use a postcode instead.',
};

export type GeolocationLike = Pick<Geolocation, 'getCurrentPosition' | 'watchPosition' | 'clearWatch'>;

export const browserGeolocation = (): GeolocationLike | null =>
  typeof navigator !== 'undefined' && 'geolocation' in navigator ? navigator.geolocation : null;

function failureOf(e: GeolocationPositionError | { code?: number }): GeolocationFailure {
  const reason: GeoFailure = e.code === 1 ? 'denied' : e.code === 3 ? 'timeout' : 'unavailable';
  return new GeolocationFailure(reason, GEO_MESSAGES[reason]);
}

const toFix = (p: GeolocationPosition): GeoFix => ({ lat: p.coords.latitude, lng: p.coords.longitude, accuracyM: p.coords.accuracy });

/** One fix. `maxAccuracyM` (default 100 m) refuses a fix too rough to use: an arrival or a saved spot must be trustworthy. */
export function readPosition(geo: GeolocationLike | null = browserGeolocation(), opts: { maxAccuracyM?: number; timeoutMs?: number } = {}): Promise<GeoFix> {
  const maxAcc = opts.maxAccuracyM ?? MAX_FIX_ACCURACY_M;
  return new Promise((resolve, reject) => {
    if (!geo) return reject(new GeolocationFailure('unsupported', GEO_MESSAGES.unsupported));
    geo.getCurrentPosition(
      (p) => {
        const fix = toFix(p);
        if (!isValidPoint(fix)) return reject(new GeolocationFailure('unavailable', GEO_MESSAGES.unavailable));
        if (typeof fix.accuracyM === 'number' && fix.accuracyM > maxAcc) return reject(new GeolocationFailure('imprecise', GEO_MESSAGES.imprecise));
        resolve(fix);
      },
      (e) => reject(failureOf(e)),
      { enableHighAccuracy: true, timeout: opts.timeoutMs ?? 12_000, maximumAge: 0 },
    );
  });
}

/** Watch while the page is open. Returns a stop function. Errors are reported once per kind (denied stops the watch). */
export function watchPosition(
  geo: GeolocationLike | null,
  onFix: (fix: GeoFix) => void,
  onError: (f: GeolocationFailure) => void,
): () => void {
  if (!geo) {
    onError(new GeolocationFailure('unsupported', GEO_MESSAGES.unsupported));
    return () => undefined;
  }
  let id: number | null = null;
  const stop = () => {
    if (id !== null) geo.clearWatch(id);
    id = null;
  };
  id = geo.watchPosition(
    (p) => {
      const fix = toFix(p);
      if (isValidPoint(fix)) onFix(fix);
    },
    (e) => {
      const f = failureOf(e);
      if (f.reason === 'denied') stop();
      onError(f);
    },
    { enableHighAccuracy: true, maximumAge: 20_000, timeout: 30_000 },
  );
  return stop;
}
