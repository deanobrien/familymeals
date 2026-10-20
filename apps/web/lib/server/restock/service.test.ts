import { describe, expect, it } from 'vitest';
import { deriveAll } from '../../shopping/engine';
import { buildDemoPantryService, DEMO_HOUSEHOLD_ID as H } from '../pantry/deps';
import { defaultIngredientLookup } from '../pantry/ingredients';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { InMemoryShoppingRepository } from '../shopping/repository';
import { InMemoryRestockRepository } from './repository';
import { createRestockService, stableUuid } from './service';

const NOW = '2026-10-19T12:00:00.000Z';
const USER = 'a1a1a102-0000-4000-8000-000000000001';
const ingredients = defaultIngredientLookup();
const TOM = ingredients.findByName('tinned tomatoes')!;
const PASTA = ingredients.findByName('pasta')!;
const converter = getIngredientCatalogue().converter;

function setup() {
  const pantry = buildDemoPantryService(() => NOW); // seeded: tinned tomatoes 2 can (6 days old), pasta 500 g
  const shopping = new InMemoryShoppingRepository({ converter });
  const repo = new InMemoryRestockRepository();
  const svc = createRestockService({ repo, pantry, shopping, ingredients, converter, now: () => NOW });
  return { pantry, shopping, repo, svc };
}
const listItems = async (shopping: InMemoryShoppingRepository) =>
  deriveAll((await shopping.snapshot(H)).state, { converter }).filter((v) => !v.item.removed);
const setTom = (svc: ReturnType<typeof setup>['svc'], over = {}) =>
  svc.setPar(H, { ingredientId: TOM.id, unit: 'can', min: 6, ...over });

describe('restock service', () => {
  it('owner example: minimum 6, stock 2 -> suggests adding 4 (with the reason)', async () => {
    const { svc } = setup();
    expect((await setTom(svc)).ok).toBe(true);
    const v = await svc.getView(H);
    expect(v.suggestions).toHaveLength(1);
    expect(v.suggestions[0]).toMatchObject({ name: TOM.name, quantity: 4, quantityLabel: '4 cans', checkQuantity: false });
    expect(v.suggestions[0]!.explanation).toBe('You have 2 cans; minimum 6 cans; 0 cans already on the list -> add 4 cans');
    expect(v.pars[0]).toMatchObject({ belowMin: true, available: 2, label: 'Minimum 6 cans', status: '2 cans in stock - below minimum' });
    const banner = await svc.getBanner(H);
    expect(banner.items).toEqual([{ parId: v.pars[0]!.id, name: TOM.name, quantityLabel: '4 cans', checkQuantity: false }]);
  });

  it('adds to the shopping list with restock provenance, merges, and is idempotent', async () => {
    const { svc, shopping } = setup();
    await setTom(svc);
    const r = await svc.addToList(H, USER);
    expect(r).toMatchObject({ ok: true, added: 1 });
    const items = await listItems(shopping);
    expect(items).toHaveLength(1);
    expect(items[0]!.item).toMatchObject({ displayName: TOM.name, ingredientId: TOM.id });
    expect(items[0]!.item.notes).toMatch(/^Restock: /);
    expect(items[0]!.outstanding).toBe(4);
    // covered now: nothing further to add, and the second call changes nothing
    expect((await svc.getView(H)).suggestions).toEqual([]);
    expect(await svc.addToList(H, USER)).toMatchObject({ ok: true, added: 0 });
    expect(await listItems(shopping)).toHaveLength(1);
  });

  it('two simultaneous "add all" calls add the items once (deterministic command ids)', async () => {
    const { svc, shopping } = setup();
    await setTom(svc);
    await Promise.all([svc.addToList(H, USER), svc.addToList(H, USER)]);
    const items = await listItems(shopping);
    expect(items).toHaveLength(1);
    expect(items[0]!.outstanding).toBe(4);
  });

  it('counts what is already on the list and merges into the existing item', async () => {
    const { svc, shopping } = setup();
    await shopping.submit(H, {
      type: 'add_item', commandId: stableUuid('c1'), actor: USER, at: NOW, itemId: stableUuid('i1'), displayName: TOM.name,
      ingredientId: TOM.id, category: 'Tins & jars', quantity: { kind: 'exact', value: 1, unit: 'can', originalText: '1 can' },
    });
    await setTom(svc);
    expect((await svc.getView(H)).suggestions[0]!.quantity).toBe(3);
    await svc.addToList(H, USER);
    const items = await listItems(shopping);
    expect(items).toHaveLength(1); // merged into the existing live item
    expect(items[0]!.outstanding).toBe(4);
  });

  it('buying them and adding them to the pantry clears the suggestion', async () => {
    const { svc, shopping, pantry } = setup();
    await setTom(svc);
    await svc.addToList(H, USER);
    const [item] = await listItems(shopping);
    await shopping.submit(H, { type: 'tick', commandId: stableUuid('t1'), actor: USER, at: NOW, itemId: item!.item.id });
    // ticked but not in the pantry yet: the list no longer covers it, so the suggestion returns until the stock is added
    expect((await svc.getView(H)).suggestions).toHaveLength(1);
    expect((await pantry.addItem(H, { ingredientId: TOM.id, value: 4, unit: 'can' })).ok).toBe(true);
    expect((await svc.getView(H)).suggestions).toEqual([]);
    expect((await svc.getView(H)).pars[0]).toMatchObject({ belowMin: false, available: 6 });
  });

  it('the minimum survives the stock reaching zero', async () => {
    const { svc, pantry } = setup();
    await setTom(svc);
    const stock = (await pantry.getView(H)).categories.flatMap((c) => c.items).find((i) => i.name === TOM.name)!;
    await pantry.correctItem(H, { id: stock.id, value: 0, unit: 'can' });
    const v = await svc.getView(H);
    expect(v.suggestions[0]).toMatchObject({ quantity: 6 });
    expect(v.pars).toHaveLength(1);
  });

  it('rounds to whole packs, restock-to tops up, and validates', async () => {
    const { svc } = setup();
    expect((await svc.setPar(H, { ingredientId: PASTA.id, unit: 'g', min: 1000, restockTo: 1500, packValue: 500, packUnit: 'g' })).ok).toBe(true);
    const s = (await svc.getView(H)).suggestions[0]!; // have 500 g -> need 1000 -> 2 packs
    expect(s).toMatchObject({ name: PASTA.name, quantity: 1000 });
    expect(s.explanation).toContain('(2 x 500 g)');
    expect(await svc.setPar(H, { ingredientId: TOM.id, unit: 'can', min: 0 })).toMatchObject({ ok: false });
    expect(await svc.setPar(H, { ingredientId: TOM.id, unit: 'can', min: 5, restockTo: 3 })).toMatchObject({ ok: false, error: expect.stringMatching(/below the minimum/) });
    expect(await svc.setPar(H, { ingredientId: TOM.id, unit: 'can', min: 5, packValue: 400 })).toMatchObject({ ok: false });
    expect(await svc.setPar(H, { ingredientId: TOM.id, unit: 'can', min: 5, packValue: 2, packUnit: 'bunch' })).toMatchObject({ ok: false, error: expect.stringMatching(/cannot be compared/) });
    expect(await svc.setPar(H, { unit: 'nope', min: 5, name: 'x' })).toMatchObject({ ok: false });
    expect(await svc.setPar(H, { unit: 'item', min: 5 })).toMatchObject({ ok: false });
  });

  it('setting a minimum again replaces it (one per ingredient); free text is allowed', async () => {
    const { svc } = setup();
    await setTom(svc);
    await setTom(svc, { min: 8 });
    await svc.setPar(H, { name: '  Birthday   candles ', unit: 'item', min: 10 });
    const v = await svc.getView(H);
    expect(v.pars.map((p) => [p.name, p.minValue])).toEqual([['Birthday candles', 10], [TOM.name, 8]]);
    expect(v.suggestions.map((s) => [s.name, s.quantity])).toEqual([['Birthday candles', 10], [TOM.name, 6]]);
  });

  it('snooze hides one suggestion for N days; remove deletes the minimum', async () => {
    const { svc } = setup();
    await setTom(svc);
    const id = (await svc.getView(H)).pars[0]!.id;
    expect((await svc.snooze(H, id, 7)).ok).toBe(true);
    const v = await svc.getView(H);
    expect(v.suggestions).toEqual([]);
    expect(v.snoozedCount).toBe(1);
    expect(v.pars[0]!.snoozedUntil).toBe('2026-10-26');
    expect((await svc.getBanner(H)).items).toEqual([]);
    expect(await svc.snooze(H, id, 0)).toMatchObject({ ok: false });
    expect((await svc.removePar(H, id)).ok).toBe(true);
    expect((await svc.getView(H)).pars).toEqual([]);
    expect(await svc.removePar(H, id)).toMatchObject({ ok: false });
  });

  it('disabled minimums are ignored', async () => {
    const { svc } = setup();
    await setTom(svc, { enabled: false });
    expect((await svc.getView(H)).suggestions).toEqual([]);
  });

  it('auto-add: off by default (suggestions only); on adds, skips "check quantity", and is repeat-safe', async () => {
    const { svc, shopping } = setup();
    await setTom(svc);
    expect(await svc.autoAdd(H, USER)).toBe(0);
    expect(await listItems(shopping)).toHaveLength(0);
    expect((await svc.updateSettings(H, { autoAdd: true })).ok).toBe(true);
    expect(await svc.autoAdd(H, USER)).toBe(1);
    expect(await svc.autoAdd(H, USER)).toBe(0);
    const items = await listItems(shopping);
    expect(items).toHaveLength(1);
    expect(items[0]!.outstanding).toBe(4);
    // a minimum counted in a unit that cannot be compared with the stock is left for the user
    await svc.setPar(H, { ingredientId: PASTA.id, unit: 'can', min: 3 });
    expect(await svc.autoAdd(H, USER)).toBe(0);
    expect((await svc.getView(H)).suggestions.find((s) => s.name === PASTA.name)).toMatchObject({ checkQuantity: true });
  });

  it('is scoped per household', async () => {
    const { svc } = setup();
    await setTom(svc);
    const other = await svc.getView('a1a1a101-0000-4000-8000-0000000000ff');
    expect(other.pars).toEqual([]);
    expect(other.suggestions).toEqual([]);
  });
});

describe('stableUuid', () => {
  it('is deterministic, uuid-shaped, and seed-sensitive', () => {
    expect(stableUuid('a')).toBe(stableUuid('a'));
    expect(stableUuid('a')).not.toBe(stableUuid('b'));
    expect(stableUuid('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
