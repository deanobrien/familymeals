import { MockDataSource } from '@/data/mockDataSource';
import { formatNutrient, formatQuantity } from '@/lib/format';
import { prepareForUpload, MAX_IMAGES } from '@/lib/extraction';

describe('MockDataSource', () => {
  it('rejects bad credentials and accepts good ones', async () => {
    const ds = new MockDataSource();
    await expect(ds.signIn('nope', 'x')).rejects.toThrow();
    await expect(ds.signIn('a@b.co', 'secret1')).resolves.toMatchObject({ email: 'a@b.co' });
  });

  it('scopes recipes and shopping to the household', async () => {
    const ds = new MockDataSource();
    expect((await ds.listRecipes('hh-2')).map((r) => r.id)).toEqual(['r-3']);
    expect((await ds.getShoppingList('hh-2')).items).toHaveLength(1);
  });

  it('delivers immediately when online', async () => {
    const ds = new MockDataSource();
    await ds.tickItem('hh-1', 's-1');
    expect(ds.pendingCount()).toBe(0);
    expect(ds.deliveredCount()).toBe(1);
  });

  it('queues ticks offline, shows pending, and flushes once on reconnect', async () => {
    const ds = new MockDataSource({ online: false });
    const ev = await ds.tickItem('hh-1', 's-1');
    expect(ds.pendingCount()).toBe(1);
    expect((await ds.getShoppingList('hh-1')).pendingItemIds).toEqual(['s-1']);
    ds.setOnline(true);
    expect(await ds.flushPending()).toBe(1);
    expect(await ds.flushPending()).toBe(0);
    expect(ds.pendingCount()).toBe(0);
    expect(ev.id).toBeTruthy();
  });
});

describe('formatting', () => {
  it('never renders unknown nutrition as zero', () => {
    expect(formatNutrient(undefined)).toBe('Unknown');
    expect(formatNutrient({ nutrient: 'fibre', status: 'unknown', unit: 'g', estimate: false })).toBe('Unknown');
    expect(formatNutrient({ nutrient: 'fibre', status: 'unavailable', unit: 'g', estimate: false })).toBe('Unknown');
    expect(formatNutrient({ nutrient: 'fat', status: 'zero', unit: 'g', estimate: false })).toBe('0 g');
    expect(formatNutrient({ nutrient: 'protein', status: 'known', value: 31, unit: 'g', estimate: true })).toBe('~31 g');
  });

  it('formats quantities', () => {
    expect(formatQuantity({ kind: 'exact', value: 500, unit: 'g', originalText: '500g' })).toBe('500 g');
    expect(formatQuantity({ kind: 'to_taste', originalText: 'to taste' })).toBe('to taste');
    expect(formatQuantity({ kind: 'approximate', approxLabel: 'pinch', originalText: 'a pinch' })).toBe('pinch');
  });
});

describe('extraction prep', () => {
  const img = { uri: 'file:///a.jpg', width: 4000, height: 3000 };
  it('names pages and uses the resizer', async () => {
    const out = await prepareForUpload([img, img], async (i) => ({ ...i, width: 1600, height: 1200 }));
    expect(out.map((o) => o.name)).toEqual(['page-1.jpg', 'page-2.jpg']);
    expect(out[0]).toMatchObject({ mimeType: 'image/jpeg', width: 1600 });
  });
  it('rejects empty and oversized batches', async () => {
    await expect(prepareForUpload([])).rejects.toThrow();
    await expect(prepareForUpload(Array(MAX_IMAGES + 1).fill(img), async (i) => i)).rejects.toThrow();
  });
});
