import { describe, expect, it } from 'vitest';
import { applyPlacements, createStorePrefs, queuePlacement } from './store-prefs';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
};
const book = {
  stores: [{ id: 's1', name: 'ALDI' }],
  aisles: [{ id: 'a1', storeId: 's1', label: '1', sortOrder: 10 }, { id: 'a2', storeId: 's1', label: '2', sortOrder: 20 }],
  placements: [{ storeId: 's1', targetType: 'category' as const, targetKey: 'Bakery', aisleId: 'a1' }],
};

describe('store prefs', () => {
  it('remembers the store per member and household, and the cached book', () => {
    const st = memory();
    const a = createStorePrefs('h1', 'alice', st);
    const b = createStorePrefs('h1', 'bob', st);
    a.setStoreId('s1');
    expect(a.getStoreId()).toBe('s1');
    expect(b.getStoreId()).toBeNull();
    a.setStoreId(null);
    expect(a.getStoreId()).toBeNull();
    a.setBook(book);
    expect(b.getBook()).toEqual(book); // the book is the household's, shared by members on this device
    expect(createStorePrefs('h2', 'alice', st).getBook()).toBeNull();
    a.setLearn(true);
    expect(a.getLearn()).toBe(true);
    expect(b.getLearn()).toBe(false);
  });

  it('survives missing or broken storage', () => {
    const none = createStorePrefs('h', 'u', null);
    none.setStoreId('x');
    expect(none.getStoreId()).toBeNull();
    const broken = createStorePrefs('h', 'u', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } });
    broken.setBook(book);
    expect(broken.getBook()).toBeNull();
    const junk = memory();
    junk.setItem('fr.shopping.storebook:h', '{not json');
    expect(createStorePrefs('h', 'u', junk).getBook()).toBeNull();
    junk.setItem('fr.shopping.storebook:h', JSON.stringify({ stores: 1 }));
    expect(createStorePrefs('h', 'u', junk).getBook()).toBeNull();
  });

  it('queues placement edits last-write-wins per target and applies them to a book', () => {
    let q = queuePlacement([], { storeId: 's1', targetType: 'ingredient', targetKey: 'tom', aisleId: 'a1' });
    q = queuePlacement(q, { storeId: 's1', targetType: 'ingredient', targetKey: 'tom', aisleId: 'a2' });
    q = queuePlacement(q, { storeId: 's1', targetType: 'category', targetKey: 'Bakery', aisleId: null });
    expect(q).toHaveLength(2);
    const out = applyPlacements(book, q);
    expect(out.placements).toEqual([{ storeId: 's1', targetType: 'ingredient', targetKey: 'tom', aisleId: 'a2' }]);
    expect(applyPlacements(book, [{ storeId: 's1', targetType: 'item', targetKey: 'x', aisleId: 'gone' }]).placements).toEqual(book.placements);
  });
});
