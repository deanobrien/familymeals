import { describe, expect, it, vi } from 'vitest';
import { GeolocationFailure, changeLocation, fencesOf, geocodePostcode, readPosition, watchPosition, type GeolocationLike } from './location-client';

const pos = (lat: number, lng: number, accuracy = 20) => ({ coords: { latitude: lat, longitude: lng, accuracy } }) as GeolocationPosition;
const geoWith = (fn: (ok: PositionCallback, err: PositionErrorCallback) => void): GeolocationLike => ({
  getCurrentPosition: (ok, err) => fn(ok, err as PositionErrorCallback),
  watchPosition: (ok, err) => { fn(ok, err as PositionErrorCallback); return 7; },
  clearWatch: vi.fn(),
});

describe('readPosition', () => {
  it('resolves a good fix', async () => {
    expect(await readPosition(geoWith((ok) => ok(pos(54.9, -1.6))))).toEqual({ lat: 54.9, lng: -1.6, accuracyM: 20 });
  });
  it('refuses an imprecise fix, and maps denied / timeout / unsupported', async () => {
    await expect(readPosition(geoWith((ok) => ok(pos(54.9, -1.6, 900))))).rejects.toMatchObject({ reason: 'imprecise' });
    await expect(readPosition(geoWith((_ok, err) => err({ code: 1 } as GeolocationPositionError)))).rejects.toMatchObject({ reason: 'denied' });
    await expect(readPosition(geoWith((_ok, err) => err({ code: 3 } as GeolocationPositionError)))).rejects.toMatchObject({ reason: 'timeout' });
    await expect(readPosition(null)).rejects.toBeInstanceOf(GeolocationFailure);
  });
});

describe('watchPosition', () => {
  it('delivers fixes, and a denial stops the watch', () => {
    const fixes: number[] = [];
    const errors: string[] = [];
    const g = geoWith((ok) => ok(pos(54.9, -1.6)));
    const stop = watchPosition(g, (f) => fixes.push(f.lat), (e) => errors.push(e.reason));
    expect(fixes).toEqual([54.9]);
    stop();
    expect(g.clearWatch).toHaveBeenCalledWith(7);
    const g2 = geoWith((_ok, err) => err({ code: 1 } as GeolocationPositionError));
    watchPosition(g2, () => undefined, (e) => errors.push(e.reason));
    expect(errors).toEqual(['denied']);
  });
});

describe('fencesOf', () => {
  it('only includes stores that exist and have a valid location', () => {
    const stores = [{ id: 'a', name: 'A', chain: null, notes: null }, { id: 'b', name: 'B', chain: null, notes: null }];
    const f = fencesOf(stores, [
      { storeId: 'a', lat: 54, lng: -1, radiusM: 150, source: 'device', postcode: null },
      { storeId: 'gone', lat: 54, lng: -1, radiusM: 150, source: 'device', postcode: null },
    ]);
    expect(f).toEqual([{ storeId: 'a', name: 'A', lat: 54, lng: -1, radiusM: 150 }]);
  });
});

describe('API calls', () => {
  const ok = (body: unknown) => (async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
  const fail = (status: number, message: string) => (async () => new Response(JSON.stringify({ error: { message } }), { status })) as unknown as typeof fetch;
  it('geocodePostcode and changeLocation return the payload or throw the server message', async () => {
    expect((await geocodePostcode('NE1 7RU', ok({ postcode: 'NE1 7RU', lat: 1, lng: 2, area: null, attribution: 'x' }))).lat).toBe(1);
    await expect(geocodePostcode('zzz', fail(400, 'That does not look like a UK postcode.'))).rejects.toThrow(/UK postcode/);
    expect((await changeLocation({ storeId: 's', action: 'clear' }, ok({ stores: [], locations: [] }))).locations).toEqual([]);
  });
  it('sends only the saved-store fields (no live position field exists in the body type)', async () => {
    let body = '';
    await changeLocation({ storeId: 's', action: 'set', lat: 1, lng: 2, source: 'device' }, (async (_u: unknown, init?: RequestInit) => { body = String(init?.body); return new Response('{"stores":[],"locations":[]}'); }) as unknown as typeof fetch);
    expect(Object.keys(JSON.parse(body) as object).sort()).toEqual(['action', 'lat', 'lng', 'source', 'storeId']);
  });
});
