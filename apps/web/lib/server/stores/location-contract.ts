// Shared behaviour suite for StoreLocationRepository: the in-memory implementation and the real Supabase repository on
// PGlite must agree (same pattern as the store-book contract).
import { describe, expect, it } from 'vitest';
import { LocationInput } from '../../stores/locations';
import { StoreBookError, type StoreBookRepository } from './repository';
import type { StoreLocationRepository } from './locations';

type Made = { locs: StoreLocationRepository; book: StoreBookRepository; household: string };

export function storeLocationContract(name: string, make: () => Promise<Made>) {
  describe(`StoreLocationRepository: ${name}`, () => {
    const dev = (lat: number, lng: number, radiusM?: number) => LocationInput.parse({ lat, lng, radiusM, source: 'device' });
    const pc = (lat: number, lng: number, postcode: string) => LocationInput.parse({ lat, lng, source: 'postcode', postcode });

    it('saves a location per store (default radius 150), replaces it, and lists it', async () => {
      const { locs, book, household: h } = await make();
      const a = await book.createStore(h, { name: 'Tesco Extra', chain: 'Tesco', notes: null });
      const b = await book.createStore(h, { name: 'ALDI', chain: 'ALDI', notes: null });
      expect(await locs.list(h)).toEqual([]);
      const saved = await locs.set(h, a.id, dev(54.97, -1.61));
      expect(saved).toEqual({ storeId: a.id, lat: 54.97, lng: -1.61, radiusM: 150, source: 'device', postcode: null });
      await locs.set(h, b.id, pc(55.0, -1.62, 'ne31aa'));
      await locs.set(h, a.id, dev(54.98, -1.6, 220)); // replace
      const all = await locs.list(h);
      expect(all).toHaveLength(2);
      expect(all.find((l) => l.storeId === a.id)).toMatchObject({ lat: 54.98, lng: -1.6, radiusM: 220, source: 'device' });
      expect(all.find((l) => l.storeId === b.id)).toMatchObject({ source: 'postcode', postcode: 'NE3 1AA', radiusM: 150 });
    });

    it('clears a location, and clearing a store with none is harmless', async () => {
      const { locs, book, household: h } = await make();
      const a = await book.createStore(h, { name: 'Lidl', chain: null, notes: null });
      await locs.set(h, a.id, dev(54.9, -1.5));
      await locs.clear(h, a.id);
      await locs.clear(h, a.id);
      expect(await locs.list(h)).toEqual([]);
    });

    it('refuses a store that is not in the household', async () => {
      const { locs, household: h } = await make();
      await expect(locs.set(h, '00000000-0000-4000-8000-0000000000ff', dev(54.9, -1.5))).rejects.toBeInstanceOf(StoreBookError);
      expect(await locs.list(h)).toEqual([]);
    });

    it('deleting the store removes its location', async () => {
      const { locs, book, household: h } = await make();
      const a = await book.createStore(h, { name: 'Sainsburys', chain: null, notes: null });
      await locs.set(h, a.id, dev(54.9, -1.5));
      await book.deleteStore(h, a.id);
      expect(await locs.list(h)).toEqual([]);
    });
  });
}

describe('LocationInput', () => {
  it('clamps the radius to 50-1000 m and rounds it', () => {
    expect(LocationInput.parse({ lat: 1, lng: 1, radiusM: 5, source: 'device' }).radiusM).toBe(50);
    expect(LocationInput.parse({ lat: 1, lng: 1, radiusM: 99999, source: 'device' }).radiusM).toBe(1000);
    expect(LocationInput.parse({ lat: 1, lng: 1, radiusM: 120.6, source: 'device' }).radiusM).toBe(121);
  });
  it('rejects bad coordinates, an unknown source and a postcode source without a real postcode', () => {
    expect(LocationInput.safeParse({ lat: 91, lng: 0, source: 'device' }).success).toBe(false);
    expect(LocationInput.safeParse({ lat: 0, lng: -181, source: 'device' }).success).toBe(false);
    expect(LocationInput.safeParse({ lat: Number.NaN, lng: 0, source: 'device' }).success).toBe(false);
    expect(LocationInput.safeParse({ lat: 0, lng: 0, source: 'gps' }).success).toBe(false);
    expect(LocationInput.safeParse({ lat: 0, lng: 0, source: 'postcode', postcode: 'nonsense' }).success).toBe(false);
    expect(LocationInput.safeParse({ lat: 0, lng: 0, source: 'postcode' }).success).toBe(false);
  });
  it('drops a postcode sent with a device location', () => {
    expect(LocationInput.parse({ lat: 1, lng: 1, source: 'device', postcode: 'NE1 7RU' }).postcode).toBeNull();
  });
});
