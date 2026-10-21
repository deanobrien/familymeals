import { describe, expect, it } from 'vitest';
import {
  ARRIVAL_COOLDOWN_MS, DEFAULT_RADIUS_M, MAX_DEVICE_FENCES, arrivalMessage, clampRadius, describeDistance, distanceM,
  isValidPoint, normalisePostcode, pickNearbyStore, rememberArrival, selectDeviceFences, shouldNotifyArrival,
  type StoreFence,
} from '../../src/shopping/geo';

// Newcastle Central Station and the Gateshead Metrocentre (about 5.6 km apart); Tesco/ALDI points are invented.
const TESCO: StoreFence = { storeId: 't', name: 'Tesco Extra', lat: 54.9, lng: -1.6, radiusM: 150 };
const ALDI: StoreFence = { storeId: 'a', name: 'ALDI Gosforth', lat: 54.9007, lng: -1.6, radiusM: 150 }; // ~78 m north of Tesco
const FAR: StoreFence = { storeId: 'f', name: 'Far', lat: 55.2, lng: -1.7, radiusM: 150 };
const at = (dLatM: number, acc?: number) => ({ lat: 54.9 + dLatM / 111_195, lng: -1.6, accuracyM: acc });

describe('distanceM', () => {
  it('is 0 for the same point and ~111 km per degree of latitude', () => {
    expect(distanceM({ lat: 54, lng: -1 }, { lat: 54, lng: -1 })).toBe(0);
    expect(distanceM({ lat: 54, lng: -1 }, { lat: 55, lng: -1 })).toBeGreaterThan(111_000);
    expect(distanceM({ lat: 54, lng: -1 }, { lat: 55, lng: -1 })).toBeLessThan(111_400);
  });
  it('is symmetric and handles the antimeridian', () => {
    const a = { lat: 10, lng: 179.9 };
    const b = { lat: 10, lng: -179.9 };
    expect(distanceM(a, b)).toBeCloseTo(distanceM(b, a), 3);
    expect(distanceM(a, b)).toBeLessThan(25_000);
  });
});

describe('validation', () => {
  it('rejects NaN and out-of-range points', () => {
    expect(isValidPoint({ lat: 54, lng: -1 })).toBe(true);
    expect(isValidPoint({ lat: 91, lng: 0 })).toBe(false);
    expect(isValidPoint({ lat: 0, lng: 181 })).toBe(false);
    expect(isValidPoint({ lat: Number.NaN, lng: 0 })).toBe(false);
    expect(isValidPoint(null)).toBe(false);
  });
  it('clamps the radius to 50-1000 m and defaults junk to 150', () => {
    expect(clampRadius(10)).toBe(50);
    expect(clampRadius(5000)).toBe(1000);
    expect(clampRadius('x')).toBe(DEFAULT_RADIUS_M);
    expect(clampRadius(333.4)).toBe(333);
  });
  it('normalises UK postcodes and refuses junk', () => {
    expect(normalisePostcode('ne17ru')).toBe('NE1 7RU');
    expect(normalisePostcode(' NE1  7RU ')).toBe('NE1 7RU');
    expect(normalisePostcode('sw1a1aa')).toBe('SW1A 1AA');
    expect(normalisePostcode('M1 1AE')).toBe('M1 1AE');
    expect(normalisePostcode('12345')).toBeNull();
    expect(normalisePostcode('hello')).toBeNull();
    expect(normalisePostcode('')).toBeNull();
    expect(normalisePostcode('NE1 7RU; drop table')).toBeNull();
  });
});

describe('pickNearbyStore', () => {
  it('is null outside every radius', () => {
    expect(pickNearbyStore(at(1000), [TESCO, ALDI, FAR])).toBeNull();
  });
  it('picks the only store whose radius contains the fix', () => {
    const r = pickNearbyStore(at(-100), [TESCO, ALDI, FAR]);
    expect(r?.storeId).toBe('t');
  });
  it('picks the closest when two radii overlap', () => {
    expect(pickNearbyStore(at(70), [TESCO, ALDI])?.storeId).toBe('a');
    expect(pickNearbyStore(at(5), [TESCO, ALDI])?.storeId).toBe('t');
  });
  it('ignores a fix whose accuracy is too poor to say', () => {
    expect(pickNearbyStore(at(0, 400), [TESCO])).toBeNull();
    expect(pickNearbyStore(at(0, 30), [TESCO])?.storeId).toBe('t');
    expect(pickNearbyStore(at(0), [TESCO])?.storeId).toBe('t'); // unknown accuracy is allowed
  });
  it('keeps the current store while still within 1.5 radii (hysteresis) but not beyond', () => {
    expect(pickNearbyStore(at(200), [TESCO], { currentStoreId: 't' })?.storeId).toBe('t');
    expect(pickNearbyStore(at(200), [TESCO])).toBeNull();
    expect(pickNearbyStore(at(260), [TESCO], { currentStoreId: 't' })).toBeNull();
  });
  it('switches from the current store when another is genuinely inside and closer', () => {
    expect(pickNearbyStore(at(75), [TESCO, ALDI], { currentStoreId: 't' })?.storeId).toBe('a');
  });
  it('is deterministic for equal distances (name order)', () => {
    const a: StoreFence = { storeId: '2', name: 'B', lat: 54.9, lng: -1.6, radiusM: 150 };
    const b: StoreFence = { storeId: '1', name: 'A', lat: 54.9, lng: -1.6, radiusM: 150 };
    expect(pickNearbyStore(at(0), [a, b])?.storeId).toBe('1');
  });
  it('skips fences with bad coordinates and handles an invalid fix', () => {
    expect(pickNearbyStore(at(0), [{ ...TESCO, lat: Number.NaN }])).toBeNull();
    expect(pickNearbyStore({ lat: Number.NaN, lng: 0 }, [TESCO])).toBeNull();
  });
});

describe('selectDeviceFences', () => {
  it('caps the count, nearest first, and clamps radii', () => {
    const many = Array.from({ length: 30 }, (_, i): StoreFence => ({ storeId: `s${i}`, name: `S${i}`, lat: 54 + i * 0.01, lng: -1, radiusM: 5 }));
    const picked = selectDeviceFences(many, { lat: 54, lng: -1 });
    expect(picked).toHaveLength(MAX_DEVICE_FENCES);
    expect(picked[0]!.storeId).toBe('s0');
    expect(picked.every((f) => f.radiusM === 50)).toBe(true);
  });
  it('drops invalid fences', () => {
    expect(selectDeviceFences([{ ...TESCO, lng: 999 }, ALDI])).toEqual([ALDI]);
  });
});

describe('arrival nudges', () => {
  it('fires once per store per cooldown', () => {
    const t0 = 1_000_000;
    expect(shouldNotifyArrival([], 't', t0)).toBe(true);
    const mem = rememberArrival([], 't', t0);
    expect(shouldNotifyArrival(mem, 't', t0 + 60_000)).toBe(false);
    expect(shouldNotifyArrival(mem, 'a', t0 + 60_000)).toBe(true);
    expect(shouldNotifyArrival(mem, 't', t0 + ARRIVAL_COOLDOWN_MS)).toBe(true);
  });
  it('treats a clock that went backwards as allowed (never a stuck mute)', () => {
    expect(shouldNotifyArrival([{ storeId: 't', at: 5000 }], 't', 1000)).toBe(true);
  });
  it('words the message for 0, 1 and many items', () => {
    expect(arrivalMessage('Tesco', 6)).toEqual({ title: "You're near Tesco", body: '6 items on your list.' });
    expect(arrivalMessage('Tesco', 1).body).toBe('1 item on your list.');
    expect(arrivalMessage('Tesco', 0).body).toBe('Nothing left on your list.');
  });
  it('describes distances', () => {
    expect(describeDistance(84)).toBe('80 m');
    expect(describeDistance(1500)).toBe('1.5 km');
  });
});
