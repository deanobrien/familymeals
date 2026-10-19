// Contract test: the real Supabase repositories running against the real migrations (PGlite), acting as an `authenticated`
// household member so RLS applies. Proves the TS <-> SQL contract (RPC argument names, jsonb shapes, row mapping).
// NOT proven here: PostgREST itself (URL/header handling, schema cache, JWT verification) - see DECISIONS D59.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { RecipeInput } from '../../recipes/schema';
import type { PlanDoc } from '../../plan/types';
import type { PantryItem } from '../../pantry/engine';
import { SupabaseMealPlanRepository, SupabasePlanRecipeSource } from './meal-plan-repository';
import { SupabasePantryRepository } from './pantry-repository';
import { SupabaseRecipeRepository } from './recipe-repository';
import { createPgliteSupabase, type PgliteSupabase } from './test-support/pglite-client';

const ALICE = 'a0000000-0000-4000-8000-000000000001';
const BOB = 'b0000000-0000-4000-8000-000000000002';
const HA = 'aa000000-0000-4000-8000-0000000000aa';
const HB = 'bb000000-0000-4000-8000-0000000000bb';
const SPAGHETTI = '11000000-0000-4000-8000-000000000001';
const ONION = '11000000-0000-4000-8000-000000000002';
const R = (n: number) => `a1000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

let pg: PgliteSupabase;
const recipes = (household = HA, user: string | null = ALICE) => new SupabaseRecipeRepository({ client: pg.client, householdId: household, userId: user });

const exact = (value: number, unit: 'g' | 'item' | 'ml', originalText: string) => ({ kind: 'exact' as const, value, unit, originalText });
function input(over: Partial<RecipeInput> = {}): RecipeInput {
  return {
    title: 'Tomato pasta',
    description: 'Quick supper',
    imageUrl: 'https://example.test/pasta.jpg',
    sourceAttribution: 'Nan',
    sourceUrl: 'https://example.test/pasta',
    originalText: 'Boil pasta. Add sauce.',
    prepMinutes: 10,
    cookMinutes: 15,
    servings: 4,
    cuisine: 'Italian',
    mealType: 'dinner',
    diet: 'vegetarian',
    tags: ['Quick', 'pasta'],
    ingredients: [
      { name: 'spaghetti', ingredientId: SPAGHETTI, quantity: exact(400, 'g', '400 g'), optional: false },
      { name: 'fresh basil', quantity: { kind: 'approximate', approxLabel: 'handful', originalText: 'a handful' }, optional: true, preparation: 'torn' },
      { name: 'salt', quantity: { kind: 'to_taste', originalText: 'to taste' }, optional: false },
    ],
    steps: ['Boil the pasta', 'Make the sauce'],
    ...over,
  };
}

beforeAll(async () => {
  pg = await createPgliteSupabase();
  await pg.admin(`
    insert into auth.users (id, email) values ('${ALICE}', 'alice@example.test'), ('${BOB}', 'bob@example.test');
    insert into public.households (id, name, created_by) values ('${HA}', 'Alice home', '${ALICE}'), ('${HB}', 'Bob home', '${BOB}');
    insert into public.ingredients (id, name, slug, category, form) values
      ('${SPAGHETTI}', 'Spaghetti', 'spaghetti', 'Grains', null), ('${ONION}', 'Onion', 'onion', 'Vegetables', 'fresh');`);
  await pg.actAs(ALICE);
}, 120_000);
afterAll(async () => {
  await pg?.close();
});

describe('SupabaseRecipeRepository against the real schema', () => {
  it('creates with an explicit id and reads back a faithful RecipeView', async () => {
    const created = await recipes().create(input(), { id: R(1) });
    expect(created).toMatchObject({
      id: R(1), title: 'Tomato pasta', description: 'Quick supper', imageUrl: 'https://example.test/pasta.jpg',
      sourceAttribution: 'Nan', sourceUrl: 'https://example.test/pasta', originalText: 'Boil pasta. Add sauce.',
      prepMinutes: 10, cookMinutes: 15, servings: 4, cuisine: 'Italian', mealType: 'dinner', diet: 'vegetarian',
      tags: ['pasta', 'quick'], favourite: false, rating: null,
      cost: { totalPence: null, kind: 'generic_estimate' }, nutritionPerServing: [],
    });
    expect(created.ingredients.map((i) => [i.name, i.ingredientId, i.quantity.kind, i.optional, i.order])).toEqual([
      ['spaghetti', SPAGHETTI, 'exact', false, 0],
      ['fresh basil', undefined, 'approximate', true, 1],
      ['salt', undefined, 'to_taste', false, 2],
    ]);
    expect(created.ingredients[0]!.quantity).toEqual(exact(400, 'g', '400 g'));
    expect(created.ingredients[1]).toMatchObject({ preparation: 'torn', quantity: { approxLabel: 'handful', originalText: 'a handful' } });
    expect(created.steps.map((s) => [s.order, s.text])).toEqual([[0, 'Boil the pasta'], [1, 'Make the sauce']]);
    expect(created.createdAt).toMatch(/^\d{4}-\d\d-\d\dT.*Z$/);
    expect(await recipes().get(R(1))).toEqual(created);
  });

  it('rejects a duplicate explicit id and a non-uuid id', async () => {
    await expect(recipes().create(input(), { id: R(1) })).rejects.toThrow(/already exists/);
    await expect(recipes().create(input(), { id: 'fx-01' })).rejects.toThrow(/UUID/);
    expect(await recipes().get('fx-01')).toBeNull();
    expect(await recipes().update('fx-01', input())).toBeNull();
    expect(await recipes().delete('fx-01')).toBe(false);
  });

  it('lists, searches, filters, sorts and pages server-side', async () => {
    await recipes().create(input({ title: 'Beef stew', description: 'Slow', imageUrl: null, cuisine: 'British', diet: 'meat', prepMinutes: 30, cookMinutes: 180, servings: 6, tags: ['winter', 'pasta'],
      ingredients: [{ name: 'beef shin', quantity: exact(800, 'g', '800 g'), optional: false }], steps: ['Stew'] }), { id: R(2) });
    await recipes().create(input({ title: 'Porridge', description: '', imageUrl: null, cuisine: '', mealType: 'breakfast', diet: 'vegan', prepMinutes: 2, cookMinutes: 5, servings: 1, tags: [],
      ingredients: [{ name: 'rolled oats', quantity: exact(50, 'g', '50 g'), optional: false }], steps: ['Heat'] }), { id: R(3) });
    const q = (over: object = {}) => ({ q: '', tags: [] as string[], sort: 'name' as const, page: 1, pageSize: 12, ...over });
    const titles = async (over: object = {}) => (await recipes().list(q(over))).items.map((r) => r.title);

    expect(await titles()).toEqual(['Beef stew', 'Porridge', 'Tomato pasta']);
    expect(await titles({ q: 'spaghetti' })).toEqual(['Tomato pasta']);
    expect(await titles({ q: 'oats' })).toEqual(['Porridge']);
    expect(await titles({ tags: ['pasta'] })).toEqual(['Beef stew', 'Tomato pasta']);
    expect(await titles({ tags: ['pasta', 'winter'] })).toEqual(['Beef stew']);
    expect(await titles({ cuisine: 'italian' })).toEqual(['Tomato pasta']);
    expect(await titles({ mealType: 'breakfast' })).toEqual(['Porridge']);
    expect(await titles({ diet: 'meat' })).toEqual(['Beef stew']);
    expect(await titles({ maxPrepMinutes: 15 })).toEqual(['Porridge', 'Tomato pasta']);
    expect(await titles({ collection: 'quick' })).toEqual(['Porridge', 'Tomato pasta']);
    expect(await titles({ collection: 'vegetarian' })).toEqual(['Porridge', 'Tomato pasta']);
    expect(await titles({ sort: 'prep' })).toEqual(['Porridge', 'Tomato pasta', 'Beef stew']);
    expect(await titles({ priceBand: 'low' })).toEqual([]);
    expect(await titles({ priceBand: 'unknown' })).toEqual(['Beef stew', 'Porridge', 'Tomato pasta']);

    const p2 = await recipes().list(q({ pageSize: 2, page: 2 }));
    expect(p2).toMatchObject({ total: 3, page: 2, pageSize: 2, pageCount: 2 });
    expect(p2.items.map((r) => r.title)).toEqual(['Tomato pasta']);
    const clamped = await recipes().list(q({ pageSize: 2, page: 9 }));
    expect(clamped).toMatchObject({ total: 3, page: 2, pageCount: 2 });
    expect(clamped.items).toHaveLength(1);
    expect(await recipes().list(q({ q: 'zzzzzz' }))).toMatchObject({ items: [], total: 0, page: 1, pageCount: 1 });
  });

  it('keeps originalText write-once and the canonical ingredient id across an edit', async () => {
    const updated = await recipes().update(R(1), input({
      title: 'Tomato pasta v2', originalText: 'OVERWRITE ATTEMPT', imageUrl: null,
      ingredients: [{ name: 'spaghetti', quantity: exact(200, 'g', '200 g'), optional: false }], steps: ['Boil', 'Serve'],
    }));
    expect(updated).toMatchObject({ title: 'Tomato pasta v2', originalText: 'Boil pasta. Add sauce.', imageUrl: null });
    expect(updated!.ingredients).toHaveLength(1);
    expect(updated!.ingredients[0]).toMatchObject({ name: 'spaghetti', ingredientId: SPAGHETTI });
    expect(updated!.steps.map((s) => s.text)).toEqual(['Boil', 'Serve']);
    expect(await recipes().update(R(99), input())).toBeNull();
    const v = await pg.db.query<{ n: number }>(`select count(*)::int n from public.recipe_versions where recipe_id = '${R(1)}'`);
    expect(v.rows[0]!.n).toBe(2);
    await recipes().update(R(1), input({ title: 'Tomato pasta', ingredients: input().ingredients }));
  });

  it('favourites are per member; duplicate copies without favourite/rating; delete archives', async () => {
    expect((await recipes().toggleFavourite(R(2)))!.favourite).toBe(true);
    expect((await recipes(HA, BOB).get(R(2)))!.favourite).toBe(false);
    expect((await recipes().list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 12, collection: 'favourites' })).items.map((r) => r.title)).toEqual(['Beef stew']);
    const copy = await recipes().duplicate(R(2));
    expect(copy).toMatchObject({ title: 'Beef stew (copy)', favourite: false, rating: null, originalText: (await recipes().get(R(2)))!.originalText });
    expect(copy!.id).not.toBe(R(2));
    expect((await recipes().toggleFavourite(R(2)))!.favourite).toBe(false);
    expect(await recipes().toggleFavourite(R(99))).toBeNull();
    await expect(recipes(HA, null).toggleFavourite(R(2))).rejects.toThrow(/signed-in/);

    expect(await recipes().delete(copy!.id)).toBe(true);
    expect(await recipes().get(copy!.id)).toBeNull();
    expect(await recipes().delete(copy!.id)).toBe(false);
    expect((await recipes().list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 12 })).total).toBe(3);
  });

  it('lists tag counts and cuisines, and finds duplicates', async () => {
    expect(await recipes().listTags()).toEqual([{ tag: 'pasta', count: 2 }, { tag: 'quick', count: 1 }, { tag: 'winter', count: 1 }]);
    expect(await recipes().listCuisines()).toEqual(['British', 'Italian']);
    expect((await recipes().findDuplicates({ title: 'tomato PASTA (copy)' })).map((r) => r.id)).toEqual([R(1)]);
    expect(await recipes().findDuplicates({ title: 'tomato pasta' }, R(1))).toEqual([]);
    expect(await recipes().findDuplicates({ title: 'other', ingredientNames: ['spaghetti'] })).toEqual([]);
  });

  it('is household-isolated: another household sees nothing, and cannot write into this one', async () => {
    await pg.actAs(BOB);
    expect((await recipes(HA, BOB).list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 12 })).total).toBe(0);
    expect(await recipes(HA, BOB).get(R(1))).toBeNull();
    await expect(recipes(HA, BOB).create(input())).rejects.toThrow();
    expect(await recipes(HA, BOB).delete(R(1))).toBe(false);
    await pg.actAs(ALICE);
    expect(await recipes().get(R(1))).not.toBeNull();
  });
});

describe('SupabaseMealPlanRepository + SupabasePlanRecipeSource against the real schema', () => {
  const plans = () => new SupabaseMealPlanRepository(pg.client, ALICE);
  const P1 = 'd1000000-0000-4000-8000-000000000001';
  const P2 = 'd1000000-0000-4000-8000-000000000002';
  const doc = (over: Partial<PlanDoc> = {}): PlanDoc => ({
    id: P1, householdId: HA, weekStart: '2026-10-19', mealTypes: ['lunch', 'dinner'], status: 'draft', budgetPence: 5000,
    prompt: 'cheap week', proposalId: 'prop-1', updatedAt: '2026-01-01T00:00:00.000Z',
    entries: {
      '2026-10-19|dinner': { kind: 'recipe', recipeId: R(2), servings: 4, note: 'big pot' },
      '2026-10-20|lunch': { kind: 'leftovers' },
      '2026-10-21|dinner': { kind: 'eating_out', note: 'pizza' },
    },
    ...over,
  });

  it('round-trips a PlanDoc (updatedAt comes from the row)', async () => {
    await plans().save(doc());
    const back = await plans().getByWeek(HA, '2026-10-19');
    expect(back).toEqual({ ...doc(), updatedAt: back!.updatedAt });
    expect(back!.updatedAt).not.toBe('2026-01-01T00:00:00.000Z');
    expect(await plans().get(HA, P1)).toEqual(back);
    expect(await plans().list(HA)).toEqual([back]);
    expect(await plans().getByWeek(HA, '2026-10-26')).toBeNull();
  });

  it('re-save updates in place, approves, and archives a competing plan for the same week', async () => {
    await plans().save(doc({ status: 'approved', entries: { '2026-10-19|dinner': { kind: 'recipe', recipeId: R(2), servings: 6 } } }));
    expect((await plans().get(HA, P1))!).toMatchObject({ status: 'approved', entries: { '2026-10-19|dinner': { servings: 6 } } });
    expect(Object.keys((await plans().get(HA, P1))!.entries)).toHaveLength(1);
    await plans().save(doc({ id: P2, status: 'draft', entries: {}, mealTypes: ['dinner'] }));
    expect((await plans().list(HA)).map((p) => p.id)).toEqual([P2]);
    expect(await plans().get(HA, P1)).toBeNull();
    const kept = await pg.db.query<{ n: number }>(`select count(*)::int n from public.planned_meals where meal_plan_id = '${P1}'`);
    expect(kept.rows[0]!.n).toBe(1);
  });

  it('refuses ids that cannot be stored and does not leak across households', async () => {
    await expect(plans().save(doc({ id: 'plan-1' }))).rejects.toThrow(/UUID/);
    await expect(plans().save(doc({ householdId: 'demo-household' }))).rejects.toThrow(/UUID/);
    await expect(plans().save(doc({ entries: { '2026-10-19|dinner': { kind: 'recipe', recipeId: 'fx-1', servings: 2 } } }))).rejects.toThrow(/UUID/);
    expect(await plans().get('demo-household', P2)).toBeNull();
    await pg.actAs(BOB);
    expect(await new SupabaseMealPlanRepository(pg.client, BOB).list(HA)).toEqual([]);
    await expect(new SupabaseMealPlanRepository(pg.client, BOB).save(doc({ id: P2, status: 'approved' }))).rejects.toThrow();
    await pg.actAs(ALICE);
  });

  it('plan recipe source lists and fetches recipes with unknown cost, quick/diet tags and the member favourite flag', async () => {
    const source = new SupabasePlanRecipeSource(pg.client, ALICE);
    const all = await source.list(HA);
    expect(all.map((r) => r.title)).toEqual(['Beef stew', 'Porridge', 'Tomato pasta']);
    const porridge = all.find((r) => r.title === 'Porridge')!;
    expect(porridge).toMatchObject({ mealTypes: ['breakfast'], dietCategory: 'vegan', baseServings: 1, costPerServingPence: null, totalMinutes: 7 });
    expect(porridge.tags).toEqual(expect.arrayContaining(['vegan', 'quick']));
    expect(porridge.ingredientLines).toEqual([{ name: 'rolled oats', quantityText: '50 g' }]);
    const two = await source.get(HA, [R(1), R(2), 'fx-nope']);
    expect(two.map((r) => r.id).sort()).toEqual([R(1), R(2)]);
    expect(two.find((r) => r.id === R(1))!.ingredientIds).toEqual([SPAGHETTI]);
    expect(await source.get('demo-household', [R(1)])).toEqual([]);
  });
});

describe('SupabasePantryRepository against the real schema', () => {
  const pantry = () => new SupabasePantryRepository(pg.client);
  const item = (n: number, over: Partial<PantryItem> = {}): PantryItem => ({
    id: `e1000000-0000-4000-8000-${String(n).padStart(12, '0')}`, householdId: HA, ingredientId: ONION, name: 'onion',
    quantity: exact(3, 'item', '3'), expiry: '2026-11-01', lastUpdated: '2026-10-10T09:00:00.000Z', source: 'manual', ...over,
  });

  it('round-trips engine items, preserving lastUpdated and event ids', async () => {
    const items = [
      item(1, { sourceEventIds: ['ee000000-0000-4000-8000-000000000001'] }),
      item(2, { name: 'mystery tin', ingredientId: '99999999-0000-4000-8000-000000000009', quantity: { kind: 'approximate', approxLabel: 'tin', originalText: 'a tin' }, source: 'purchase', lastUpdated: '2026-10-11T09:00:00.000Z' }),
    ];
    delete (items[1] as { expiry?: string }).expiry;
    await pantry().replaceItems(HA, items);
    const back = await pantry().listItems(HA);
    // unknown canonical ids are stored as NULL (line kept, unmatched)
    const expected = [items[1]!, items[0]!].map((i) => (i.name === 'mystery tin' ? (({ ingredientId: _drop, ...rest }) => rest)(i) : i));
    expect(back).toEqual(expected);
  });

  it('replaces atomically: absent rows are deleted, present rows updated, unmodelled columns kept', async () => {
    await pg.db.query(`update public.pantry_items set notes = 'keep me' where display_name = 'onion'`);
    await pantry().replaceItems(HA, [item(1, { quantity: exact(2, 'item', '2') })]);
    const back = await pantry().listItems(HA);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ quantity: { value: 2 }, lastUpdated: '2026-10-10T09:00:00.000Z' });
    const notes = await pg.db.query<{ notes: string }>(`select notes from public.pantry_items`);
    expect(notes.rows[0]!.notes).toBe('keep me');
    await expect(pantry().replaceItems(HA, [item(3, { id: 'not-a-uuid' })])).rejects.toThrow(/UUID/);
    expect(await pantry().listItems('demo-household')).toEqual([]);
  });

  it('stores every engine source, including correction and leftover (D147, found live)', async () => {
    await pantry().replaceItems(HA, [item(1, { source: 'correction' }), item(2, { source: 'leftover', name: 'stew' })]);
    const back = await pantry().listItems(HA);
    expect(back.map((i) => i.source).sort()).toEqual(['correction', 'leftover']);
    await pantry().replaceItems(HA, [item(1, { quantity: exact(2, 'item', '2') })]); // restore for the tests below
  });

  it('settings default, save and read back; handled events are idempotent', async () => {
    expect(await pantry().getSettings(HA)).toEqual({ purchaseMode: 'suggest', staleAfterDays: 14 });
    await pantry().saveSettings(HA, { purchaseMode: 'auto', staleAfterDays: 21 });
    await pantry().saveSettings(HA, { purchaseMode: 'off', staleAfterDays: 30 });
    expect(await pantry().getSettings(HA)).toEqual({ purchaseMode: 'off', staleAfterDays: 30 });
    const e1 = 'ee000000-0000-4000-8000-000000000001';
    const e2 = 'ee000000-0000-4000-8000-000000000002';
    expect(await pantry().getHandledEventIds(HA)).toEqual(new Set());
    await pantry().markEventsHandled(HA, [e1, e2]);
    await pantry().markEventsHandled(HA, [e1]);
    await pantry().markEventsHandled(HA, []);
    expect(await pantry().getHandledEventIds(HA)).toEqual(new Set([e1, e2]));
    await expect(pantry().markEventsHandled(HA, ['nope'])).rejects.toThrow(/UUID/);
  });

  it('is household-isolated', async () => {
    await pg.actAs(BOB);
    expect(await pantry().listItems(HA)).toEqual([]);
    expect(await pantry().getHandledEventIds(HA)).toEqual(new Set());
    expect(await pantry().getSettings(HA)).toEqual({ purchaseMode: 'suggest', staleAfterDays: 14 });
    await expect(pantry().replaceItems(HA, [item(9)])).rejects.toThrow();
    await pg.actAs(ALICE);
    expect(await pantry().listItems(HA)).toHaveLength(1);
  });
});
