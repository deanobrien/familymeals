// Unit tests with a recording client: assert the exact RPC / table calls the repositories make, and the mapping of
// representative responses (including rows another writer may have left outside our strict rules).
import { describe, expect, it } from 'vitest';
import type { RecipeQuery } from '../../recipes/schema';
import type { PantryItem } from '../../pantry/engine';
import { SupabaseMealPlanRepository, SupabasePlanRecipeSource, planDocFromRows } from './meal-plan-repository';
import { SupabasePantryRepository, pantryItemFromRow, pantryItemToRpcRow } from './pantry-repository';
import { recipeViewFromDoc } from './recipe-mapper';
import { SupabaseRecipeRepository } from './recipe-repository';
import { SupabaseRepositoryError } from './rpc';
import { createFakeSupabase, type Responder } from './test-support/fake-client';

const H = 'aa000000-0000-4000-8000-0000000000aa';
const U = 'a0000000-0000-4000-8000-000000000001';
const RID = 'a1000000-0000-4000-8000-000000000001';
const ING = '11000000-0000-4000-8000-000000000001';
const TS = '2026-10-19T15:13:53.123456+00:00';

const query = (over: Partial<RecipeQuery> = {}): RecipeQuery => ({ q: '', tags: [], sort: 'name', page: 1, pageSize: 12, ...over });

function recipeDoc(over: Record<string, unknown> = {}) {
  return {
    id: RID, household_id: H, title: 'Tomato pasta', description: null, cover_image_path: null, source_url: null,
    source_attribution: null, prep_minutes: 10, cook_minutes: null, default_servings: 4, cuisine: null, meal_type: 'dinner',
    diet_category: 'vegetarian', status: 'active', created_by: U, created_at: TS, updated_at: TS,
    ingredients: [
      { id: 'a2000000-0000-4000-8000-000000000001', recipe_id: RID, household_id: H, ingredient_id: ING, display_name: 'spaghetti',
        original_text: '400 g', quantity_kind: 'exact', quantity_value: '400.000', quantity_min: null, quantity_max: null, unit: 'g',
        approx_label: null, preparation: null, group_label: null, optional: false, position: 0, created_at: TS, updated_at: TS },
    ],
    steps: [{ id: 'a3000000-0000-4000-8000-000000000001', recipe_id: RID, household_id: H, step_number: 1, instructions: 'Boil', duration_minutes: null, created_at: TS, updated_at: TS }],
    tags: ['pasta'], favourite: true, rating: 4.5, original_text: 'Boil it', image_url: 'https://example.test/p.jpg',
    nutrition: { servings: 4, values: [
      { id: 'c2000000-0000-4000-8000-000000000001', nutrition_profile_id: 'c1000000-0000-4000-8000-000000000001', household_id: H, nutrient: 'energy_kcal', value_status: 'known', value: 480, unit: 'kcal', source: 'cofid', estimate: true },
      { id: 'c2000000-0000-4000-8000-000000000002', nutrition_profile_id: 'c1000000-0000-4000-8000-000000000001', household_id: H, nutrient: 'fibre', value_status: 'unknown', value: null, unit: 'g', source: null, estimate: false },
    ] },
    ...over,
  };
}

function repo(respond: Responder, userId: string | null = U) {
  const fake = createFakeSupabase(respond);
  return { ...fake, repo: new SupabaseRecipeRepository({ client: fake.client, householdId: H, userId }) };
}

describe('recipeViewFromDoc', () => {
  it('maps a view document (strings for numerics, null columns, nutrition, extras)', () => {
    const v = recipeViewFromDoc(recipeDoc());
    expect(v).toMatchObject({
      id: RID, title: 'Tomato pasta', description: '', sourceUrl: '', sourceAttribution: '', cuisine: '', imageUrl: 'https://example.test/p.jpg',
      originalText: 'Boil it', prepMinutes: 10, cookMinutes: null, servings: 4, mealType: 'dinner', diet: 'vegetarian',
      tags: ['pasta'], favourite: true, rating: 4.5, cost: { totalPence: null, kind: 'generic_estimate' },
      createdAt: '2026-10-19T15:13:53.123Z',
    });
    expect(v.ingredients[0]).toEqual({
      id: 'a2000000-0000-4000-8000-000000000001', name: 'spaghetti', ingredientId: ING, preparation: undefined, optional: false, order: 0,
      quantity: { kind: 'exact', value: 400, unit: 'g', originalText: '400 g' },
    });
    expect(v.steps).toEqual([{ id: 'a3000000-0000-4000-8000-000000000001', order: 0, text: 'Boil' }]);
    expect(v.nutritionPerServing).toEqual([
      { nutrient: 'energy_kcal', status: 'known', value: 480, unit: 'kcal', source: 'cofid', estimate: true },
      { nutrient: 'fibre', status: 'unknown', unit: 'g', estimate: false },
    ]);
  });

  it('never invents a diet claim and tolerates ingredient rows another writer left outside our rules', () => {
    const doc = recipeDoc({ meal_type: null, diet_category: null, image_url: null, original_text: '', rating: null, nutrition: null });
    (doc.ingredients[0] as Record<string, unknown>).display_name = null;
    (doc.ingredients[0] as Record<string, unknown>).quantity_kind = 'approximate';
    (doc.ingredients[0] as Record<string, unknown>).unit = 'g'; // approximate must not carry a unit (domain rule)
    (doc.ingredients[0] as Record<string, unknown>).quantity_value = null;
    const v = recipeViewFromDoc(doc);
    expect(v.diet).toBe('meat');
    expect(v.mealType).toBe('dinner');
    expect(v.imageUrl).toBeNull();
    expect(v.rating).toBeNull();
    expect(v.nutritionPerServing).toEqual([]);
    expect(v.ingredients[0]).toMatchObject({ name: '400 g', quantity: { kind: 'unparsed', originalText: '400 g' }, ingredientId: ING });
  });
});

describe('SupabaseRecipeRepository query shape', () => {
  it('list sends every filter, sort and the page window to list_recipes, and maps the result', async () => {
    const { repo: r, calls } = repo(() => ({ data: { total: 25, items: [recipeDoc()] } }));
    const res = await r.list(query({
      q: 'pasta', cuisine: 'Italian', mealType: 'dinner', maxPrepMinutes: 30, diet: 'vegetarian', tags: ['quick', 'pasta'],
      collection: 'favourites', sort: 'rating', page: 2, pageSize: 10,
    }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ kind: 'rpc', name: 'list_recipes', args: {
      p_household_id: H, p_user_id: U, p_query: 'pasta', p_cuisine: 'Italian', p_meal_type: 'dinner', p_max_prep: 30, p_diet: 'vegetarian',
      p_tags: ['quick', 'pasta'], p_collection: 'favourites', p_sort: 'rating', p_limit: 10, p_offset: 10,
    } });
    expect(res).toMatchObject({ total: 25, page: 2, pageSize: 10, pageCount: 3 });
    expect(res.items[0]!.id).toBe(RID);
  });

  it('list sends nulls for absent filters', async () => {
    const { repo: r, calls } = repo(() => ({ data: { total: 0, items: [] } }));
    await r.list(query());
    expect(calls[0]!.args).toMatchObject({ p_query: '', p_cuisine: null, p_meal_type: null, p_max_prep: null, p_diet: null, p_tags: [], p_collection: null, p_limit: 12, p_offset: 0 });
  });

  it('list re-requests the last page when the page is out of range', async () => {
    const { repo: r, calls } = repo((c) => ({ data: { total: 25, items: c.args!.p_offset === 24 ? [recipeDoc()] : [] } }));
    const res = await r.list(query({ page: 99, pageSize: 12 }));
    expect(calls.map((c) => c.args!.p_offset)).toEqual([1176, 24]);
    expect(res).toMatchObject({ page: 3, pageCount: 3, total: 25 });
    expect(res.items).toHaveLength(1);
  });

  it('without a summariser cost is unknown: known bands / budget match nothing, "unknown" matches', async () => {
    const { repo: r } = repo(() => ({ data: { total: 1, items: [recipeDoc()] } }));
    expect((await r.list(query({ priceBand: 'low' }))).items).toEqual([]);
    expect((await r.list(query({ priceBand: 'high' }))).total).toBe(0);
    expect((await r.list(query({ collection: 'budget' }))).total).toBe(0);
    expect((await r.list(query({ priceBand: 'unknown' }))).total).toBe(1);
  });

  it('cost is computed on read by the summariser: bands, budget and cost sort resolve over the SQL-filtered set (D100)', async () => {
    const fake = createFakeSupabase((c) => ({ data: c.name === 'get_recipes' ? [recipeDoc()] : { total: 1, items: [recipeDoc()] } }));
    const summariser = { summarise: () => ({ cost: { totalPence: 400, kind: 'generic_estimate' as const }, nutritionPerServing: [] }) };
    const r = new SupabaseRecipeRepository({ client: fake.client, householdId: H, userId: U, summariser });
    const cheap = (await r.list(query({ priceBand: 'low' }))).total; // 400p total / default servings: depends on the doc
    const got = (await r.get(RID))!;
    expect(got.cost.totalPence).toBe(400); // every read is costed
    const band = (await r.list(query({ priceBand: 'high' }))).total + cheap + (await r.list(query({ priceBand: 'mid' }))).total;
    expect(band).toBe(1); // exactly one band holds the recipe
    const costed = (await r.list(query({ sort: 'cost' }))).items;
    expect(costed[0]!.cost.totalPence).toBe(400);
    // the SQL call never asks for the cost-only filters (they cannot be expressed in SQL)
    expect(fake.calls.filter((c) => c.name === 'list_recipes').every((c) => c.args!.p_collection === null && c.args!.p_limit === 10_000 || c.args!.p_limit === 12)).toBe(true);
  });

  it('get / getMany call get_recipes with valid, de-duplicated ids only', async () => {
    const { repo: r, calls } = repo(() => ({ data: [recipeDoc()] }));
    expect((await r.get(RID))!.id).toBe(RID);
    expect(await r.get('fx-01')).toBeNull();
    expect(await r.getMany(['fx-01'])).toEqual([]);
    await r.getMany([RID, RID, 'nope']);
    expect(calls.map((c) => [c.name, c.args!.p_ids])).toEqual([['get_recipes', [RID]], ['get_recipes', [RID]]]);
    expect(calls[0]!.args).toMatchObject({ p_household_id: H, p_user_id: U });
  });

  it('create / update send the RecipeInput to save_recipe', async () => {
    const input = { title: 'T' } as never;
    const { repo: r, calls } = repo(() => ({ data: recipeDoc() }));
    await r.create(input, { id: RID });
    await r.create(input);
    await r.update(RID, input);
    expect(calls.map((c) => [c.name, c.args!.p_mode, c.args!.p_id])).toEqual([
      ['save_recipe', 'create', RID], ['save_recipe', 'create', null], ['save_recipe', 'update', RID],
    ]);
    expect(calls[0]!.args).toMatchObject({ p_household_id: H, p_user_id: U, p_input: input });
  });

  it('update returns null when the recipe is missing; a duplicate id surfaces a clear error; other errors propagate', async () => {
    const miss = repo(() => ({ data: null }));
    expect(await miss.repo.update(RID, {} as never)).toBeNull();
    const dup = repo(() => ({ error: { message: 'duplicate key value', code: '23505' } }));
    await expect(dup.repo.create({} as never, { id: RID })).rejects.toThrow(`Recipe ${RID} already exists`);
    await expect(dup.repo.create({} as never)).rejects.toBeInstanceOf(SupabaseRepositoryError);
    const denied = repo(() => ({ error: { message: 'new row violates row-level security policy', code: '42501' } }));
    await expect(denied.repo.list(query())).rejects.toThrow(/rpc list_recipes.*42501/);
  });

  it('delete archives (never hard-deletes) within the household and reports whether a row changed', async () => {
    const hit = repo(() => ({ data: [{ id: RID }] }));
    expect(await hit.repo.delete(RID)).toBe(true);
    expect(hit.calls[0]).toMatchObject({ kind: 'from', name: 'recipes' });
    expect(hit.calls[0]!.ops).toEqual([
      ['update', { status: 'archived' }], ['eq', 'id', RID], ['eq', 'household_id', H], ['neq', 'status', 'archived'], ['select', 'id'],
    ]);
    const miss = repo(() => ({ data: [] }));
    expect(await miss.repo.delete(RID)).toBe(false);
  });

  it('toggleFavourite adds or removes the signed-in member\'s row, then re-reads', async () => {
    const add = repo((c) => (c.name === 'get_recipes' ? { data: [recipeDoc({ favourite: false })] } : { data: null }));
    await add.repo.toggleFavourite(RID);
    const ins = add.calls.find((c) => c.name === 'recipe_favourites')!;
    expect(ins.ops).toEqual([
      ['upsert', { recipe_id: RID, user_id: U, household_id: H }, { onConflict: 'recipe_id,user_id', ignoreDuplicates: true }],
    ]);
    const del = repo((c) => (c.name === 'get_recipes' ? { data: [recipeDoc({ favourite: true })] } : { data: null }));
    await del.repo.toggleFavourite(RID);
    expect(del.calls.find((c) => c.name === 'recipe_favourites')!.ops).toEqual([['delete'], ['match', { recipe_id: RID, user_id: U, household_id: H }]]);
    await expect(repo(() => ({ data: [recipeDoc()] }), null).repo.toggleFavourite(RID)).rejects.toThrow(/signed-in/);
  });

  it('duplicate saves a copy through save_recipe (create) with a (copy) title and the source original text', async () => {
    const { repo: r, calls } = repo((c) => (c.name === 'get_recipes' ? { data: [recipeDoc()] } : { data: recipeDoc({ id: 'a1000000-0000-4000-8000-0000000000c0' }) }));
    const copy = await r.duplicate(RID);
    expect(copy!.id).toBe('a1000000-0000-4000-8000-0000000000c0');
    const save = calls.find((c) => c.name === 'save_recipe')!;
    expect(save.args).toMatchObject({ p_mode: 'create', p_id: null });
    expect(save.args!.p_input).toMatchObject({
      title: 'Tomato pasta (copy)', originalText: 'Boil it', tags: ['pasta'], steps: ['Boil'],
      ingredients: [{ name: 'spaghetti', ingredientId: ING, quantity: { kind: 'exact', value: 400, unit: 'g' }, optional: false }],
    });
    expect(await repo(() => ({ data: [] })).repo.duplicate(RID)).toBeNull();
  });

  it('facets and duplicates', async () => {
    const f = repo(() => ({ data: { tags: [{ tag: 'pasta', count: 2 }], cuisines: ['Italian'] } }));
    expect(await f.repo.listTags()).toEqual([{ tag: 'pasta', count: 2 }]);
    expect(await f.repo.listCuisines()).toEqual(['Italian']);
    expect(f.calls.map((c) => [c.name, c.args])).toEqual([['recipe_facets', { p_household_id: H }], ['recipe_facets', { p_household_id: H }]]);
    const d = repo(() => ({ data: [recipeDoc()] }));
    expect((await d.repo.findDuplicates({ title: 'Tomato pasta', ingredientNames: ['a', 'b', 'c'] }, RID)).map((x) => x.id)).toEqual([RID]);
    expect(d.calls[0]).toMatchObject({ name: 'find_recipe_duplicates', args: { p_title: 'Tomato pasta', p_names: ['a', 'b', 'c'], p_exclude: RID } });
    await d.repo.findDuplicates({ title: 'x' }, 'fx-1');
    expect(d.calls[1]!.args).toMatchObject({ p_names: [], p_exclude: null });
  });
});

describe('meal plan repository', () => {
  const planRow = {
    plan: { id: 'd1000000-0000-4000-8000-000000000001', household_id: H, start_date: '2026-10-19', end_date: '2026-10-25', budget_target_pence: 5000,
      planning_prompt: 'cheap', constraints: { mealTypes: ['lunch', 'dinner'], proposalId: 'p1' }, status: 'approved', approved_at: TS, approved_by: U,
      created_by: U, created_at: TS, updated_at: TS },
    meals: [
      { id: 'f1000000-0000-4000-8000-000000000001', meal_plan_id: 'd1000000-0000-4000-8000-000000000001', household_id: H, meal_date: '2026-10-19', meal_type: 'dinner', kind: 'recipe', recipe_id: RID, servings: 4, approved: true, notes: 'pot', position: 0, created_at: TS, updated_at: TS },
      { id: 'f1000000-0000-4000-8000-000000000002', meal_plan_id: 'd1000000-0000-4000-8000-000000000001', household_id: H, meal_date: '2026-10-20', meal_type: 'lunch', kind: 'other', recipe_id: null, servings: 1, approved: true, notes: null, position: 0, created_at: TS, updated_at: TS },
    ],
  };

  it('maps plan + meal rows to a PlanDoc', () => {
    expect(planDocFromRows(planRow)).toEqual({
      id: 'd1000000-0000-4000-8000-000000000001', householdId: H, weekStart: '2026-10-19', mealTypes: ['lunch', 'dinner'], status: 'approved',
      budgetPence: 5000, prompt: 'cheap', proposalId: 'p1', updatedAt: '2026-10-19T15:13:53.123Z',
      entries: { '2026-10-19|dinner': { kind: 'recipe', recipeId: RID, servings: 4, note: 'pot' }, '2026-10-20|lunch': { kind: 'eating_out' } },
    });
  });

  it('derives mealTypes from the meals when no constraints snapshot exists and treats archived-like statuses as draft', () => {
    const doc = planDocFromRows({ ...planRow, plan: { ...planRow.plan, constraints: null, status: 'draft', budget_target_pence: null, planning_prompt: null } });
    expect(doc.mealTypes).toEqual(['lunch', 'dinner']);
    expect(doc).not.toHaveProperty('budgetPence');
    expect(doc).not.toHaveProperty('prompt');
    expect(doc.status).toBe('draft');
  });

  it('queries select_meal_plans by week / id / household and saves through save_meal_plan', async () => {
    const { client, calls } = createFakeSupabase(() => ({ data: [planRow] }));
    const plans = new SupabaseMealPlanRepository(client, U);
    expect((await plans.getByWeek(H, '2026-10-19'))!.id).toBe(planRow.plan.id);
    await plans.get(H, planRow.plan.id);
    await plans.list(H);
    expect(calls.map((c) => c.args)).toEqual([
      { p_household_id: H, p_id: null, p_start_date: '2026-10-19' },
      { p_household_id: H, p_id: planRow.plan.id, p_start_date: null },
      { p_household_id: H, p_id: null, p_start_date: null },
    ]);
    expect(await plans.getByWeek('demo-household', '2026-10-19')).toBeNull();
    expect(await plans.getByWeek(H, 'next week')).toBeNull();
    expect(await plans.get(H, 'plan-1')).toBeNull();
    expect(await plans.list('demo-household')).toEqual([]);
    expect(calls).toHaveLength(3);

    const doc = planDocFromRows(planRow);
    await plans.save(doc);
    expect(calls[3]).toMatchObject({ name: 'save_meal_plan', args: { p_household_id: H, p_user_id: U, p_doc: doc } });
  });

  it('plan recipe source maps recipe views to PlanRecipe and ignores non-uuid household / ids', async () => {
    const { client, calls } = createFakeSupabase((c) => (c.name === 'list_recipes' ? { data: { total: 1, items: [recipeDoc()] } } : { data: [recipeDoc()] }));
    const src = new SupabasePlanRecipeSource(client, U);
    const [r] = await src.list(H);
    expect(r).toMatchObject({ id: RID, title: 'Tomato pasta', baseServings: 4, costPerServingPence: null, favourite: true, mealTypes: ['lunch', 'dinner'], dietCategory: 'vegetarian', totalMinutes: 10, ingredientIds: [ING] });
    expect(r!.tags).toEqual(expect.arrayContaining(['pasta', 'vegetarian', 'quick']));
    expect(calls[0]!.args).toMatchObject({ p_household_id: H, p_user_id: U, p_limit: 10000, p_sort: 'name', p_offset: 0 });
    expect((await src.get(H, [RID, 'fx-1'])).map((x) => x.id)).toEqual([RID]);
    expect(await src.list('demo-household')).toEqual([]);
    expect(await src.get('demo-household', [RID])).toEqual([]);
  });
});

describe('pantry repository', () => {
  const row = {
    id: 'e1000000-0000-4000-8000-000000000001', household_id: H, ingredient_id: ING, product_pack_id: null, display_name: 'onion',
    quantity_kind: 'exact', quantity_value: '3.000', quantity_min: null, quantity_max: null, unit: 'item', approx_label: null, original_text: '3',
    expires_on: '2026-11-01', notes: null, source: 'purchase', receipt_line_id: null, created_by: null, created_at: TS,
    updated_at: '2026-10-19T16:00:00+00:00', stock_updated_at: '2026-10-10T09:00:00+00:00', source_event_ids: ['ee000000-0000-4000-8000-000000000001'],
  };
  const engine: PantryItem = {
    id: row.id, householdId: H, ingredientId: ING, name: 'onion', quantity: { kind: 'exact', value: 3, unit: 'item', originalText: '3' },
    expiry: '2026-11-01', lastUpdated: '2026-10-10T09:00:00.000Z', source: 'purchase', sourceEventIds: ['ee000000-0000-4000-8000-000000000001'],
  };

  it('maps rows to engine items: lastUpdated is stock_updated_at (not the trigger-bumped updated_at)', () => {
    expect(pantryItemFromRow(row)).toEqual(engine);
    const bare = pantryItemFromRow({ ...row, ingredient_id: null, expires_on: null, source_event_ids: [], quantity_kind: 'unparsed', quantity_value: null, unit: null, original_text: 'some' });
    expect(bare).toEqual({ id: row.id, householdId: H, name: 'onion', quantity: { kind: 'unparsed', originalText: 'some' }, lastUpdated: '2026-10-10T09:00:00.000Z', source: 'purchase' });
    expect(pantryItemFromRow({ ...row, quantity_kind: 'approximate', unit: 'g', quantity_value: null }).quantity).toEqual({ kind: 'unparsed', originalText: '3' });
  });

  it('maps engine items to replace_pantry_items rows (snake_case, flattened quantity)', () => {
    expect(pantryItemToRpcRow(engine)).toEqual({
      id: row.id, ingredient_id: ING, display_name: 'onion', quantity_kind: 'exact', quantity_value: 3, quantity_min: null, quantity_max: null,
      unit: 'item', approx_label: null, original_text: '3', expires_on: '2026-11-01', source: 'purchase',
      source_event_ids: ['ee000000-0000-4000-8000-000000000001'], stock_updated_at: '2026-10-10T09:00:00.000Z',
    });
    const bare: PantryItem = { id: engine.id, householdId: H, name: 'onion', quantity: engine.quantity, lastUpdated: engine.lastUpdated, source: 'manual' };
    expect(pantryItemToRpcRow(bare)).toMatchObject({ ingredient_id: null, expires_on: null, source_event_ids: [] });
  });

  it('lists household rows in pages of 1000 ordered by name', async () => {
    const page = (n: number) => Array.from({ length: n }, (_, i) => ({ ...row, id: `e1000000-0000-4000-8000-${String(i).padStart(12, '0')}` }));
    let call = 0;
    const { client, calls } = createFakeSupabase(() => ({ data: call++ === 0 ? page(1000) : page(5) }));
    const items = await new SupabasePantryRepository(client).listItems(H);
    expect(items).toHaveLength(1005);
    expect(calls[0]!.ops).toEqual([
      ['select', '*'], ['eq', 'household_id', H], ['order', 'display_name', { ascending: true }], ['order', 'id', { ascending: true }], ['range', 0, 999],
    ]);
    expect(calls[1]!.ops.at(-1)).toEqual(['range', 1000, 1999]);
    expect(await new SupabasePantryRepository(client).listItems('demo-household')).toEqual([]);
  });

  it('replaceItems sends every item to replace_pantry_items; refuses non-uuid ids', async () => {
    const { client, calls } = createFakeSupabase(() => ({ data: null }));
    const repo = new SupabasePantryRepository(client);
    await repo.replaceItems(H, [engine]);
    await repo.replaceItems(H, []);
    expect(calls.map((c) => [c.name, (c.args!.p_items as unknown[]).length, c.args!.p_household_id])).toEqual([['replace_pantry_items', 1, H], ['replace_pantry_items', 0, H]]);
    await expect(repo.replaceItems(H, [{ ...engine, id: 'x' }])).rejects.toThrow(/UUID/);
    await expect(repo.replaceItems('demo', [])).rejects.toThrow(/UUID/);
    expect(calls).toHaveLength(2);
  });

  it('settings: default when absent, mapped when present, upserted by household', async () => {
    const none = createFakeSupabase(() => ({ data: null }));
    expect(await new SupabasePantryRepository(none.client).getSettings(H)).toEqual({ purchaseMode: 'suggest', staleAfterDays: 14 });
    expect(none.calls[0]!.ops).toEqual([['select', 'purchase_mode, stale_after_days'], ['eq', 'household_id', H], ['maybeSingle']]);
    const some = createFakeSupabase(() => ({ data: { purchase_mode: 'auto', stale_after_days: 21 } }));
    expect(await new SupabasePantryRepository(some.client).getSettings(H)).toEqual({ purchaseMode: 'auto', staleAfterDays: 21 });
    const odd = createFakeSupabase(() => ({ data: { purchase_mode: 'whenever', stale_after_days: 7 } }));
    expect((await new SupabasePantryRepository(odd.client).getSettings(H)).purchaseMode).toBe('suggest');
    await new SupabasePantryRepository(some.client).saveSettings(H, { purchaseMode: 'off', staleAfterDays: 30 });
    expect(some.calls.at(-1)!.ops).toEqual([
      ['upsert', { household_id: H, purchase_mode: 'off', stale_after_days: 30 }, { onConflict: 'household_id' }],
    ]);
  });

  it('handled events: read as a set, mark with ignore-duplicates upsert (nothing sent for an empty list)', async () => {
    const e1 = 'ee000000-0000-4000-8000-000000000001';
    const { client, calls } = createFakeSupabase((c) => (c.ops[0]![0] === 'select' ? { data: [{ purchase_event_id: e1 }] } : { data: null }));
    const repo = new SupabasePantryRepository(client);
    expect(await repo.getHandledEventIds(H)).toEqual(new Set([e1]));
    await repo.markEventsHandled(H, [e1, e1]);
    await repo.markEventsHandled(H, []);
    expect(calls).toHaveLength(2);
    expect(calls[1]!.ops).toEqual([['upsert', [{ household_id: H, purchase_event_id: e1 }], { onConflict: 'household_id,purchase_event_id', ignoreDuplicates: true }]]);
    await expect(repo.markEventsHandled(H, ['nope'])).rejects.toThrow(/UUID/);
  });

  it('surfaces database errors', async () => {
    const { client } = createFakeSupabase(() => ({ error: { message: 'permission denied', code: '42501' } }));
    await expect(new SupabasePantryRepository(client).listItems(H)).rejects.toThrow(/permission denied/);
    await expect(new SupabasePantryRepository(client).saveSettings(H, { purchaseMode: 'off', staleAfterDays: 1 })).rejects.toThrow(/42501/);
  });
});
