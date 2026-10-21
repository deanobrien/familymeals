import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../../../../lib/server/auth/request-auth';

let outcome: AuthOutcome;
vi.mock('../../../../lib/server/auth/request-auth', () => ({ resolveRequestAuth: async () => outcome }));

const locations = await import('./route');
const geocode = await import('../geocode/route');
const voice = await import('../../shopping/voice/parse/route');
const { getStoreBook } = await import('../../../../lib/server/stores/store');
let n = 0;
let H = '';

beforeEach(() => {
  H = `cc${String(++n).padStart(6, '0')}-0000-4000-8000-0000000000cc`;
  outcome = { ok: true, auth: { userId: `u${n}`, householdId: H, readOnly: false, dataContext: null, defaultServings: 4 } };
});

const post = (url: string, body: unknown) => new Request(`http://t${url}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const getLocs = async () => (await locations.GET(new Request(`http://t/api/stores/locations?householdId=${H}`))).json() as Promise<{ stores: Array<{ id: string; name: string }>; locations: Array<Record<string, unknown>> }>;
const errOf = async (r: Response) => ((await r.json()) as { error: { code: string; message: string } }).error;

describe('/api/stores/locations', () => {
  it('401 signed out, 403 for a household that is not yours', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await locations.GET(new Request('http://t/api/stores/locations'))).status).toBe(401);
    expect((await locations.POST(post('/api/stores/locations', { storeId: 'x', action: 'clear' }))).status).toBe(401);
    outcome = { ok: false, status: 403, message: 'not a member' };
    expect((await locations.GET(new Request('http://t/api/stores/locations'))).status).toBe(403);
  });

  it('sets, lists and clears a location; stores come back with it', async () => {
    const s = await getStoreBook().createStore(H, { name: 'Tesco Extra', chain: 'Tesco', notes: null });
    expect((await getLocs()).locations).toEqual([]);
    const r = await locations.POST(post('/api/stores/locations', { householdId: H, storeId: s.id, action: 'set', lat: 54.97, lng: -1.61, source: 'device', radiusM: 200 }));
    expect(r.status).toBe(200);
    const view = await getLocs();
    expect(view.stores.map((x) => x.name)).toEqual(['Tesco Extra']);
    expect(view.locations).toEqual([{ storeId: s.id, lat: 54.97, lng: -1.61, radiusM: 200, source: 'device', postcode: null }]);
    const c = await locations.POST(post('/api/stores/locations', { householdId: H, storeId: s.id, action: 'clear' }));
    expect(c.status).toBe(200);
    expect((await getLocs()).locations).toEqual([]);
  });

  it('validates input: bad store id, unknown action, bad coordinates, bad postcode, unknown store', async () => {
    const s = await getStoreBook().createStore(H, { name: 'ALDI', chain: null, notes: null });
    const bad = async (b: Record<string, unknown>) => locations.POST(post('/api/stores/locations', { householdId: H, ...b }));
    expect((await bad({ storeId: 'nope', action: 'clear' })).status).toBe(400);
    expect((await bad({ storeId: s.id, action: 'wipe' })).status).toBe(400);
    expect((await bad({ storeId: s.id, action: 'set', lat: 100, lng: 0, source: 'device' })).status).toBe(400);
    expect((await bad({ storeId: s.id, action: 'set', lat: 1, lng: 1, source: 'postcode', postcode: 'zzz' })).status).toBe(400);
    const missing = await bad({ storeId: '00000000-0000-4000-8000-0000000000ee', action: 'set', lat: 1, lng: 1, source: 'device' });
    expect(missing.status).toBe(404);
    expect((await getLocs()).locations).toEqual([]);
  });

  it('a read-only household can read but not change', async () => {
    outcome = { ok: true, auth: { userId: 'u', householdId: H, readOnly: true, dataContext: null, defaultServings: 4 } };
    const w = await locations.POST(post('/api/stores/locations', { householdId: H, storeId: 'x', action: 'clear' }));
    expect(w.status).toBe(403);
    expect((await errOf(w)).code).toBe('READ_ONLY');
    expect((await locations.GET(new Request(`http://t/api/stores/locations?householdId=${H}`))).status).toBe(200);
  });

  it('never accepts or echoes a live position: unknown body fields are ignored', async () => {
    const s = await getStoreBook().createStore(H, { name: 'Lidl', chain: null, notes: null });
    await locations.POST(post('/api/stores/locations', { householdId: H, storeId: s.id, action: 'set', lat: 54.9, lng: -1.5, source: 'device', currentLat: 1, currentLng: 2, accuracy: 3 }));
    const loc = (await getLocs()).locations[0]!;
    expect(Object.keys(loc).sort()).toEqual(['lat', 'lng', 'postcode', 'radiusM', 'source', 'storeId']);
  });
});

describe('/api/stores/geocode', () => {
  it('401 signed out; 400 for junk without calling the service', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await geocode.GET(new Request('http://t/api/stores/geocode?postcode=NE1 7RU'))).status).toBe(401);
    outcome = { ok: true, auth: { userId: 'g1', householdId: H, readOnly: false, dataContext: null, defaultServings: 4 } };
    const bad = await geocode.GET(new Request('http://t/api/stores/geocode?postcode=hello'));
    expect(bad.status).toBe(400);
    expect((await errOf(bad)).code).toBe('BAD_POSTCODE');
  });

  it('returns coordinates and the attribution (service mocked)', async () => {
    outcome = { ok: true, auth: { userId: 'g2', householdId: H, readOnly: false, dataContext: null, defaultServings: 4 } };
    const spy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ status: 200, result: { postcode: 'NE1 7RU', latitude: 54.97, longitude: -1.62, admin_district: 'Newcastle upon Tyne' } }), { status: 200 }));
    try {
      const r = await geocode.GET(new Request('http://t/api/stores/geocode?postcode=ne17ru'));
      expect(r.status).toBe(200);
      const b = (await r.json()) as { lat: number; lng: number; attribution: string };
      expect(b).toMatchObject({ postcode: 'NE1 7RU', lat: 54.97, lng: -1.62 });
      expect(b.attribution).toMatch(/postcodes\.io/);
      expect(String(spy.mock.calls[0]![0])).toBe('https://api.postcodes.io/postcodes/NE17RU');
    } finally {
      spy.mockRestore();
    }
  });

  it('503 when the service is down; 429 after too many lookups', async () => {
    outcome = { ok: true, auth: { userId: 'g3', householdId: H, readOnly: false, dataContext: null, defaultServings: 4 } };
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('down'));
    try {
      expect((await geocode.GET(new Request('http://t/api/stores/geocode?postcode=NE1 7RU'))).status).toBe(503);
      let last = 0;
      for (let i = 0; i < 25; i++) last = (await geocode.GET(new Request('http://t/api/stores/geocode?postcode=NE1 7RU'))).status;
      expect(last).toBe(429);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('/api/shopping/voice/parse', () => {
  it('401 signed out; 400 for an empty or oversized transcript', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await voice.POST(post('/v', { transcript: 'milk' }))).status).toBe(401);
    outcome = { ok: true, auth: { userId: 'v', householdId: H, readOnly: false, dataContext: null, defaultServings: 4 } };
    expect((await voice.POST(post('/v', { householdId: H, transcript: '   ' }))).status).toBe(400);
    expect((await voice.POST(post('/v', { householdId: H, transcript: 'x'.repeat(2000) }))).status).toBe(400);
    expect((await voice.POST(post('/v', { householdId: H }))).status).toBe(400);
  });

  it('turns a spoken sentence into review rows (also for read-only households: it writes nothing)', async () => {
    outcome = { ok: true, auth: { userId: 'v', householdId: H, readOnly: true, dataContext: null, defaultServings: 4 } };
    const r = await voice.POST(post('/v', { householdId: H, transcript: 'add milk, two tins of tomatoes and eggs' }));
    expect(r.status).toBe(200);
    const { rows } = (await r.json()) as { rows: Array<{ key: string; name: string; value?: number; unit?: string; aisle: string }> };
    expect(rows.map((x) => x.key)).toEqual(['v1', 'v2', 'v3']);
    // names that match the catalogue exactly are linked and shown by their canonical (singular) name, as in the list scan
    expect(rows.map((x) => x.name.toLowerCase())).toEqual(['milk', 'tomato', 'egg']);
    const tom = rows[1]!;
    expect(tom).toMatchObject({ value: 2, unit: 'can' });
    expect(tom.name.toLowerCase()).toContain('tomato');
    expect(rows.every((x) => typeof x.aisle === 'string' && x.aisle.length > 0)).toBe(true);
  });
});
