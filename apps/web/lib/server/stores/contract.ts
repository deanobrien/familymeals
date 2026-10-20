// Shared behaviour suite for StoreBookRepository: run against the in-memory implementation and against the real
// Supabase repository on PGlite (same expectations, so mock mode and Supabase mode cannot drift apart).
import { describe, expect, it } from 'vitest';
import { resolveAisle } from '../../shopping/engine';
import { StoreBookError, applyTemplate, type StoreBookRepository } from './repository';

export function storeBookContract(name: string, make: () => Promise<{ repo: StoreBookRepository; household: string }>) {
  describe(`StoreBookRepository: ${name}`, () => {
    const fresh = async () => make();
    const fields = (n: string, chain: string | null = null) => ({ name: n, chain, notes: null });

    it('creates stores, adds aisles at the end, renames and reorders them', async () => {
      const { repo, household: h } = await fresh();
      const aldi = await repo.createStore(h, fields('ALDI Gosforth', 'ALDI'));
      const a1 = await repo.addAisle(h, aldi.id, '1');
      const a5 = await repo.addAisle(h, aldi.id, '5');
      const a3 = await repo.addAisle(h, aldi.id, '3');
      expect(a1.sortOrder).toBeLessThan(a5.sortOrder);
      expect(a5.sortOrder).toBeLessThan(a3.sortOrder);
      await repo.renameAisle(h, a3.id, 'Frozen');
      await repo.reorderAisles(h, aldi.id, [a1.id, a3.id, a5.id]);
      const book = await repo.book(h);
      expect(book.stores).toEqual([{ id: aldi.id, name: 'ALDI Gosforth', chain: 'ALDI', notes: null }]);
      expect(book.aisles.filter((a) => a.storeId === aldi.id).sort((x, y) => x.sortOrder - y.sortOrder).map((a) => a.label)).toEqual(['1', 'Frozen', '5']);
    });

    it('reorder keeps unlisted aisles after the listed ones and ignores foreign ids', async () => {
      const { repo, household: h } = await fresh();
      const s = await repo.createStore(h, fields('S'));
      const [a, b, c] = [await repo.addAisle(h, s.id, 'a'), await repo.addAisle(h, s.id, 'b'), await repo.addAisle(h, s.id, 'c')];
      await repo.reorderAisles(h, s.id, [c.id, '00000000-0000-4000-8000-000000000000', c.id]);
      const order = (await repo.book(h)).aisles.sort((x, y) => x.sortOrder - y.sortOrder).map((x) => x.label);
      expect(order).toEqual(['c', 'a', 'b']);
      expect([a.id, b.id]).toBeTruthy();
    });

    it('rejects a duplicate store name (case-insensitive) and allows renaming a store', async () => {
      const { repo, household: h } = await fresh();
      const s = await repo.createStore(h, fields('Tesco'));
      await expect(repo.createStore(h, fields(' tesco '))).rejects.toMatchObject({ code: 'duplicate_name' });
      const other = await repo.createStore(h, fields('Tesco Express'));
      await expect(repo.updateStore(h, other.id, { name: 'TESCO' })).rejects.toBeInstanceOf(StoreBookError);
      const renamed = await repo.updateStore(h, s.id, { name: 'Tesco Extra', chain: 'Tesco', notes: 'big one' });
      expect(renamed).toMatchObject({ name: 'Tesco Extra', chain: 'Tesco', notes: 'big one' });
    });

    it('places a target in an aisle (replacing the old placement), clears it, and rejects a foreign-store aisle', async () => {
      const { repo, household: h } = await fresh();
      const aldi = await repo.createStore(h, fields('ALDI'));
      const lidl = await repo.createStore(h, fields('LIDL'));
      const a1 = await repo.addAisle(h, aldi.id, '1');
      const a2 = await repo.addAisle(h, aldi.id, '2');
      const l1 = await repo.addAisle(h, lidl.id, 'Fruit');
      await repo.setPlacement(h, aldi.id, 'ingredient', 'ing-tomato', a1.id);
      await repo.setPlacement(h, aldi.id, 'ingredient', 'ing-tomato', a2.id);
      await repo.setPlacement(h, lidl.id, 'ingredient', 'ing-tomato', l1.id);
      let book = await repo.book(h);
      expect(book.placements.filter((p) => p.storeId === aldi.id)).toEqual([{ storeId: aldi.id, targetType: 'ingredient', targetKey: 'ing-tomato', aisleId: a2.id }]);
      expect(resolveAisle({ id: 'x', displayName: 'Tomatoes', category: 'Fruit & veg', ingredientId: 'ing-tomato' }, lidl.id, book.aisles, book.placements)?.label).toBe('Fruit');
      await expect(repo.setPlacement(h, aldi.id, 'category', 'Frozen', l1.id)).rejects.toBeInstanceOf(StoreBookError);
      await repo.setPlacement(h, aldi.id, 'ingredient', 'ing-tomato', null);
      book = await repo.book(h);
      expect(book.placements.filter((p) => p.storeId === aldi.id)).toEqual([]);
      expect(book.placements.filter((p) => p.storeId === lidl.id)).toHaveLength(1);
    });

    it('deleting an aisle removes its placements; deleting a store removes everything under it', async () => {
      const { repo, household: h } = await fresh();
      const s = await repo.createStore(h, fields('S'));
      const a = await repo.addAisle(h, s.id, 'a');
      const b = await repo.addAisle(h, s.id, 'b');
      await repo.setPlacement(h, s.id, 'category', 'Dairy & eggs', a.id);
      await repo.setPlacement(h, s.id, 'category', 'Bakery', b.id);
      await repo.deleteAisle(h, a.id);
      expect((await repo.book(h)).placements.map((p) => p.targetKey)).toEqual(['Bakery']);
      await repo.deleteStore(h, s.id);
      expect(await repo.book(h)).toEqual({ stores: [], aisles: [], placements: [] });
    });

    it('applies a starting template (aisles + category placements) without overwriting existing placements', async () => {
      const { repo, household: h } = await fresh();
      const s = await repo.createStore(h, fields('LIDL', 'LIDL'));
      const mine = await repo.addAisle(h, s.id, 'Bakery');
      await repo.setPlacement(h, s.id, 'category', 'Fruit & veg', mine.id); // user already put fruit & veg in "Bakery"
      await applyTemplate(repo, h, s.id, 'discounter');
      const book = await repo.book(h);
      const labels = book.aisles.filter((a) => a.storeId === s.id).map((a) => a.label);
      expect(labels.filter((l) => l === 'Bakery')).toHaveLength(1); // reused, not duplicated
      expect(labels).toContain('Frozen');
      const fv = book.placements.find((p) => p.targetKey === 'Fruit & veg');
      expect(fv?.aisleId).toBe(mine.id);
      expect(book.placements.some((p) => p.targetKey === 'Frozen')).toBe(true);
    });

    it('copies a layout onto another store, replacing its aisles and placements', async () => {
      const { repo, household: h } = await fresh();
      const aldi = await repo.createStore(h, fields('ALDI', 'ALDI'));
      const lidl = await repo.createStore(h, fields('LIDL', 'LIDL'));
      const a = await repo.addAisle(h, aldi.id, '1');
      const b = await repo.addAisle(h, aldi.id, '2');
      await repo.setPlacement(h, aldi.id, 'ingredient', 'ing-milk', b.id);
      await repo.setPlacement(h, aldi.id, 'category', 'Bakery', a.id);
      const old = await repo.addAisle(h, lidl.id, 'old');
      await repo.setPlacement(h, lidl.id, 'category', 'Frozen', old.id);
      expect(await repo.copyLayout(h, aldi.id, lidl.id)).toBe(2);
      const book = await repo.book(h);
      const lidlAisles = book.aisles.filter((x) => x.storeId === lidl.id).sort((x, y) => x.sortOrder - y.sortOrder);
      expect(lidlAisles.map((x) => x.label)).toEqual(['1', '2']);
      expect(lidlAisles.map((x) => x.id)).not.toContain(a.id); // copies, not shared ids
      const milk = book.placements.find((p) => p.storeId === lidl.id && p.targetKey === 'ing-milk');
      expect(milk?.aisleId).toBe(lidlAisles[1]!.id);
      expect(book.placements.filter((p) => p.storeId === lidl.id)).toHaveLength(2);
      expect(book.placements.filter((p) => p.storeId === aldi.id)).toHaveLength(2); // source untouched
      await expect(repo.copyLayout(h, aldi.id, aldi.id)).rejects.toBeInstanceOf(StoreBookError);
    });
  });
}
