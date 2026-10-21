import { describe, expect, it } from 'vitest';
import { createLimiter, lookupPostcode } from './geocode';

const reply = (status: number, body: unknown) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('lookupPostcode (postcodes.io)', () => {
  it('returns coordinates for a found postcode and normalises it', async () => {
    let url = '';
    const r = await lookupPostcode('ne17ru', async (u) => {
      url = u;
      return { ok: true, status: 200, json: async () => ({ status: 200, result: { postcode: 'NE1 7RU', latitude: 54.97, longitude: -1.62, admin_district: 'Newcastle upon Tyne' } }) };
    });
    expect(r).toEqual({ ok: true, postcode: 'NE1 7RU', lat: 54.97, lng: -1.62, area: 'Newcastle upon Tyne' });
    expect(url).toBe('https://api.postcodes.io/postcodes/NE17RU'); // only the postcode is sent
  });
  it('never calls the service for something that is not shaped like a postcode', async () => {
    let called = false;
    const r = await lookupPostcode('1 High Street; drop table', async () => { called = true; return { ok: true, status: 200, json: async () => ({}) }; });
    expect(r).toEqual({ ok: false, reason: 'invalid' });
    expect(called).toBe(false);
  });
  it('maps 404, null coordinates (terminated postcode), 5xx and network errors', async () => {
    expect(await lookupPostcode('NE1 7RU', reply(404, { status: 404 }))).toEqual({ ok: false, reason: 'not_found' });
    expect(await lookupPostcode('NE1 7RU', reply(200, { result: { postcode: 'NE1 7RU', latitude: null, longitude: null } }))).toEqual({ ok: false, reason: 'not_found' });
    expect(await lookupPostcode('NE1 7RU', reply(500, {}))).toEqual({ ok: false, reason: 'unavailable' });
    expect(await lookupPostcode('NE1 7RU', async () => { throw new Error('offline'); })).toEqual({ ok: false, reason: 'unavailable' });
  });
  it('rejects out-of-range coordinates from the service', async () => {
    expect(await lookupPostcode('NE1 7RU', reply(200, { result: { latitude: 999, longitude: 0 } }))).toEqual({ ok: false, reason: 'not_found' });
  });
});

describe('createLimiter', () => {
  it('allows N per window per key, then recovers', () => {
    let t = 0;
    const allow = createLimiter(2, 1000, () => t);
    expect([allow('u'), allow('u'), allow('u')]).toEqual([true, true, false]);
    expect(allow('other')).toBe(true);
    t = 1001;
    expect(allow('u')).toBe(true);
  });
});
