// Behaviour both MoneyRepository implementations must share (in-memory for mock mode, Supabase over PGlite): so mock mode
// and the database cannot drift. `setup` returns a repository, the household, and a real store id belonging to it.
import { describe, expect, it } from 'vitest';
import { MoneyError, type MoneyRepository } from './repository';

export interface MoneyHarness { repo: MoneyRepository; household: string; storeId: string }

export function moneyRepositoryContract(name: string, setup: () => Promise<MoneyHarness>): void {
  describe(`MoneyRepository contract: ${name}`, () => {
    it('adds, lists (newest first, within the range), updates and deletes manual spend', async () => {
      const { repo, household, storeId } = await setup();
      const a = await repo.addSpend(household, { date: '2026-10-12', amountPence: 1250, storeId, category: 'Bakery', note: 'cake' });
      const b = await repo.addSpend(household, { date: '2026-10-14', amountPence: 480, retailer: 'Market stall' });
      await repo.addSpend(household, { date: '2026-09-01', amountPence: 999 });
      expect(a).toMatchObject({ date: '2026-10-12', amountPence: 1250, storeId, retailer: null, category: 'Bakery', note: 'cake' });
      expect(b).toMatchObject({ storeId: null, retailer: 'Market stall', category: null });
      expect((await repo.listSpend(household, '2026-10-01', '2026-10-31')).map((e) => e.id)).toEqual([b.id, a.id]);
      const u = await repo.updateSpend(household, a.id, { date: '2026-10-13', amountPence: 1300, storeId: null, retailer: 'Greggs' });
      expect(u).toMatchObject({ id: a.id, date: '2026-10-13', amountPence: 1300, storeId: null, retailer: 'Greggs', category: null, note: null });
      await repo.deleteSpend(household, b.id);
      expect((await repo.listSpend(household, '2026-10-01', '2026-10-31')).map((e) => e.id)).toEqual([a.id]);
      await expect(repo.updateSpend(household, '00000000-0000-4000-8000-00000000dead', { date: '2026-10-13', amountPence: 5 })).rejects.toBeInstanceOf(MoneyError);
    });

    it('stores retailer links per normalised text, replaces and removes them', async () => {
      const { repo, household, storeId } = await setup();
      expect(await repo.links(household)).toEqual({});
      await repo.setLink(household, 'tesco extra', storeId);
      await repo.setLink(household, 'tesco', storeId);
      await repo.setLink(household, 'tesco', storeId); // idempotent
      expect(await repo.links(household)).toEqual({ 'tesco extra': storeId, tesco: storeId });
      await repo.setLink(household, 'tesco extra', null);
      expect(await repo.links(household)).toEqual({ tesco: storeId });
      await expect(repo.setLink(household, '', storeId)).rejects.toBeInstanceOf(MoneyError);
    });

    it('refuses a store from another household', async () => {
      const { repo, household } = await setup();
      const foreign = '99999999-9999-4999-8999-999999999999';
      await expect(repo.addSpend(household, { date: '2026-10-12', amountPence: 100, storeId: foreign })).rejects.toBeTruthy();
      await expect(repo.setLink(household, 'x', foreign)).rejects.toBeTruthy();
    });
  });
}
