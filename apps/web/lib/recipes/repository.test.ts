import { beforeEach, describe, expect, it } from 'vitest';
import { InMemoryRecipeRepository } from './memory-repository';
import { loadSeedRecipes } from './seed';
import { nutritionRows } from './nutrition';
import { parseRecipeQuery, recipeInputSchema, recipeQueryToParams, type RecipeInput, type RecipeQuery } from './schema';
import { costPerServing } from './types';
import { withCanonicalIngredients } from './factory';
import { createRecipeCalculator } from '../server/calc';

const base: RecipeQuery = { q: '', tags: [], sort: 'name', page: 1, pageSize: 50 };
const q = (patch: Partial<RecipeQuery> = {}): RecipeQuery => ({ ...base, ...patch });

const input = (patch: Partial<RecipeInput> = {}): RecipeInput => ({
  title: 'Test Soup',
  description: '',
  imageUrl: null,
  sourceAttribution: '',
  sourceUrl: '',
  originalText: 'orig text',
  prepMinutes: 5,
  cookMinutes: 10,
  servings: 2,
  cuisine: 'British',
  mealType: 'lunch',
  diet: 'vegan',
  tags: ['Soup'],
  ingredients: [
    { name: 'carrot', quantity: { kind: 'exact', value: 2, unit: 'item', originalText: '2' }, optional: false },
    { name: 'stock', quantity: { kind: 'exact', value: 500, unit: 'ml', originalText: '500 ml' }, optional: false },
    { name: 'salt', quantity: { kind: 'to_taste', originalText: 'to taste' }, optional: false },
  ],
  steps: ['Chop.', 'Simmer.'],
  ...patch,
});

describe('seed', () => {
  it('loads every recipe fixture', () => {
    const seed = loadSeedRecipes();
    expect(seed.length).toBe(8);
    expect(new Set(seed.map((r) => r.id)).size).toBe(seed.length);
    expect(seed.every((r) => r.ingredients.length > 0 && r.steps.length > 0)).toBe(true);
    expect(seed.some((r) => r.title === 'Sunday Tomato Pasta')).toBe(true);
  });
});

describe('InMemoryRecipeRepository', () => {
  let repo: InMemoryRecipeRepository;
  beforeEach(() => {
    repo = new InMemoryRecipeRepository(withCanonicalIngredients(loadSeedRecipes()), createRecipeCalculator());
  });

  it('lists sorted by name and pages', async () => {
    const all = await repo.list(q());
    expect(all.total).toBe(8);
    const titles = all.items.map((r) => r.title);
    expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, 'en-GB', { sensitivity: 'base' })));
    const p2 = await repo.list(q({ pageSize: 3, page: 3 }));
    expect(p2.items).toHaveLength(2);
    expect(p2.pageCount).toBe(3);
    // out-of-range pages clamp
    expect((await repo.list(q({ pageSize: 3, page: 99 }))).page).toBe(3);
  });

  it('searches across title, ingredients and tags', async () => {
    expect((await repo.list(q({ q: 'tomato' }))).items.map((r) => r.title)).toContain('Sunday Tomato Pasta');
    const byIngredient = await repo.list(q({ q: 'spaghetti' }));
    expect(byIngredient.items.map((r) => r.title)).toEqual(['Sunday Tomato Pasta']);
    const byTag = await repo.list(q({ q: 'comfort' }));
    expect(byTag.total).toBe(2);
    expect((await repo.list(q({ q: 'zzzz-nothing' }))).total).toBe(0);
    // every token must match somewhere
    expect((await repo.list(q({ q: 'fish comfort' }))).total).toBe(1);
  });

  it('filters by cuisine, meal type, prep time, diet, price band and tags', async () => {
    expect((await repo.list(q({ cuisine: 'indian' }))).items.map((r) => r.cuisine)).toEqual(['Indian']);
    expect((await repo.list(q({ mealType: 'breakfast' }))).total).toBe(1);
    const quickPrep = await repo.list(q({ maxPrepMinutes: 10 }));
    expect(quickPrep.items.every((r) => (r.prepMinutes ?? 99) <= 10)).toBe(true);
    expect((await repo.list(q({ diet: 'fish' }))).total).toBe(1);
    const low = await repo.list(q({ priceBand: 'low' }));
    expect(low.total).toBeGreaterThan(0);
    expect(low.items.every((r) => (costPerServing(r) ?? 9999) < 150)).toBe(true);
    const high = await repo.list(q({ priceBand: 'high' }));
    expect(high.items.every((r) => (costPerServing(r) ?? 0) > 300)).toBe(true);
    expect((await repo.list(q({ priceBand: 'unknown' }))).items.every((r) => costPerServing(r) == null)).toBe(true);
    expect((await repo.list(q({ tags: ['family', 'quick'] }))).items.map((r) => r.title)).toEqual(['Sunday Tomato Pasta']);
  });

  it('supports collections', async () => {
    expect((await repo.list(q({ collection: 'favourites' }))).items.every((r) => r.favourite)).toBe(true);
    const quick = await repo.list(q({ collection: 'quick' }));
    expect(quick.total).toBeGreaterThan(0);
    expect(quick.items.every((r) => (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0) <= 30)).toBe(true);
    const budget = await repo.list(q({ collection: 'budget' }));
    expect(budget.items.every((r) => (costPerServing(r) ?? 9999) < 150)).toBe(true);
    const veg = await repo.list(q({ collection: 'vegetarian' }));
    expect(veg.items.every((r) => r.diet === 'vegetarian' || r.diet === 'vegan')).toBe(true);
  });

  it('sorts with unknown values last', async () => {
    // Computed costs: a recipe nothing in the catalogue can price has an unknown cost and sorts last.
    await repo.create(input({
      title: 'Zzz Mystery Dish',
      ingredients: [{ name: 'quantum goo', quantity: { kind: 'exact', value: 1, unit: 'g', originalText: '1 g' }, optional: false }],
    }));
    const byCost = (await repo.list(q({ sort: 'cost' }))).items;
    const costs = byCost.map(costPerServing);
    expect(costs[costs.length - 1]).toBeNull();
    expect(costs.filter((c) => c != null).length).toBeGreaterThan(5);
    const known = costs.filter((c): c is number => c != null);
    expect(known).toEqual([...known].sort((a, b) => a - b));
    const byRating = (await repo.list(q({ sort: 'rating' }))).items;
    expect(byRating[0]?.rating).toBe(5);
    expect(byRating[byRating.length - 1]?.rating).toBeNull();
    const recent = (await repo.list(q({ sort: 'recent' }))).items;
    expect((recent[0]?.createdAt ?? '') >= (recent[1]?.createdAt ?? '')).toBe(true);
  });

  it('creates, gets, updates and deletes', async () => {
    const created = await repo.create(input());
    expect(created.tags).toEqual(['soup']);
    // carrot is priced; stock is not in the catalogue, so the cost is a partial lower bound
    expect(created.cost.totalPence).toBeGreaterThan(0);
    expect(created.cost.partial).toBe(true);
    expect((await repo.get(created.id))?.title).toBe('Test Soup');

    const updated = await repo.update(created.id, input({ title: 'Better Soup', originalText: 'changed!' }));
    expect(updated?.title).toBe('Better Soup');
    // original text is write-once
    expect(updated?.originalText).toBe('orig text');
    expect(updated?.createdAt).toBe(created.createdAt);

    expect(await repo.update('00000000-0000-4000-8000-00000000ffff', input())).toBeNull();
    expect(await repo.delete(created.id)).toBe(true);
    expect(await repo.delete(created.id)).toBe(false);
    expect(await repo.get(created.id)).toBeNull();
  });

  it('recomputes cost and nutrition when ingredients or servings change', async () => {
    const [first] = (await repo.list(q({ q: 'pasta' }))).items;
    if (!first) throw new Error('seed missing');
    const same = await repo.update(first.id, {
      ...input(),
      title: first.title,
      servings: first.servings,
      ingredients: first.ingredients.map((i) => ({ name: i.name, quantity: i.quantity, optional: i.optional })),
    });
    expect(first.cost.totalPence).toBeGreaterThan(0);
    expect(same?.cost.totalPence).toBe(first.cost.totalPence);
    const changed = await repo.update(first.id, input());
    expect(changed?.cost.totalPence).not.toBe(first.cost.totalPence);
    expect(changed?.nutritionPerServing.length).toBeGreaterThan(0);
    // same ingredients, more servings: same total, lower per-serving cost
    const more = await repo.update(first.id, { ...input(), title: first.title, servings: first.servings * 2, ingredients: first.ingredients.map((i) => ({ name: i.name, quantity: i.quantity, optional: i.optional })) });
    expect(more?.cost.totalPence).toBe(first.cost.totalPence);
    expect(costPerServing(more!)).toBeLessThan(costPerServing(first)!);
  });

  it('duplicates with a copy title and fresh ids', async () => {
    const [src] = (await repo.list(q({ q: 'pasta' }))).items;
    if (!src) throw new Error('seed missing');
    const copy = await repo.duplicate(src.id);
    expect(copy?.title).toBe(`${src.title} (copy)`);
    expect(copy?.id).not.toBe(src.id);
    expect(copy?.favourite).toBe(false);
    expect(copy?.ingredients.map((i) => i.id)).not.toEqual(src.ingredients.map((i) => i.id));
    expect(copy?.ingredients.map((i) => i.name)).toEqual(src.ingredients.map((i) => i.name));
    expect(await repo.duplicate('00000000-0000-4000-8000-00000000ffff')).toBeNull();
  });

  it('toggles favourites', async () => {
    const [r] = (await repo.list(q({ q: 'porridge' }))).items;
    if (!r) throw new Error('seed missing');
    expect(r.favourite).toBe(false);
    expect((await repo.toggleFavourite(r.id))?.favourite).toBe(true);
    expect((await repo.toggleFavourite(r.id))?.favourite).toBe(false);
    expect(await repo.toggleFavourite('nope')).toBeNull();
  });

  it('lists tags with counts and cuisines', async () => {
    const tags = await repo.listTags();
    expect(tags.find((t) => t.tag === 'family')?.count).toBe(3);
    expect(tags[0]?.count).toBeGreaterThanOrEqual(tags[tags.length - 1]?.count ?? 0);
    expect(await repo.listCuisines()).toEqual(['British', 'Indian', 'Italian', 'Spanish']);
  });

  it('finds duplicates by normalised title or near-identical ingredients', async () => {
    expect((await repo.findDuplicates({ title: '  sunday TOMATO pasta!' })).map((r) => r.title)).toEqual(['Sunday Tomato Pasta']);
    const [src] = (await repo.list(q({ q: 'pasta' }))).items;
    if (!src) throw new Error('seed missing');
    const byIngredients = await repo.findDuplicates({ title: 'Totally different', ingredientNames: src.ingredients.map((i) => i.name) });
    expect(byIngredients.map((r) => r.id)).toEqual([src.id]);
    expect(await repo.findDuplicates({ title: 'Sunday Tomato Pasta' }, src.id)).toEqual([]);
    expect(await repo.findDuplicates({ title: 'Brand new thing', ingredientNames: ['x', 'y'] })).toEqual([]);
  });

  it('returns copies so callers cannot mutate the store', async () => {
    const [r] = (await repo.list(q())).items;
    if (!r) throw new Error('seed missing');
    r.title = 'mutated';
    expect((await repo.get(r.id))?.title).not.toBe('mutated');
  });
});

describe('recipeInputSchema', () => {
  it('accepts a valid recipe', () => {
    expect(recipeInputSchema.safeParse(input()).success).toBe(true);
  });
  it('rejects empty title, missing ingredients/steps and bad quantities', () => {
    const bad = recipeInputSchema.safeParse(
      input({
        title: ' ',
        steps: [],
        ingredients: [{ name: 'x', quantity: { kind: 'exact', originalText: '' }, optional: false }],
        servings: 0,
      }),
    );
    expect(bad.success).toBe(false);
    const paths = bad.success ? [] : bad.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['title', 'steps', 'servings', 'ingredients.0.quantity.value']));
  });
  it('rejects ranges with min above max and non-http source URLs', () => {
    const r = recipeInputSchema.safeParse(
      input({
        sourceUrl: 'javascript:alert(1)',
        ingredients: [{ name: 'x', quantity: { kind: 'range', min: 5, max: 2, unit: 'g', originalText: '5-2' }, optional: false }],
      }),
    );
    expect(r.success).toBe(false);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
    expect(paths).toEqual(expect.arrayContaining(['sourceUrl', 'ingredients.0.quantity.min']));
  });
});

describe('URL query', () => {
  it('parses leniently and round-trips', () => {
    const parsed = parseRecipeQuery({ q: ' soup ', sort: 'bogus', prep: '45', meal: 'dinner', tag: ['a', 'B'], page: '-3', collection: 'quick' });
    expect(parsed).toMatchObject({ q: 'soup', sort: 'name', maxPrepMinutes: undefined, mealType: 'dinner', tags: ['a', 'b'], page: 1, collection: 'quick' });
    const params = recipeQueryToParams({ ...parsed, sort: 'cost', page: 2, view: 'list' });
    expect(params.toString()).toBe('q=soup&meal=dinner&tag=a&tag=b&collection=quick&sort=cost&page=2&view=list');
    expect(parseRecipeQuery(Object.fromEntries(params))).toMatchObject({ sort: 'cost', page: 2 });
  });
});

describe('nutritionRows', () => {
  it('shows missing nutrients as unknown, never zero', () => {
    const rows = nutritionRows([], 1);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === 'unknown' && r.value == null)).toBe(true);
  });
  it('scales known values for per-recipe and keeps unknown and zero distinct', () => {
    const rows = nutritionRows(
      [
        { nutrient: 'energy_kcal', status: 'known', value: 300, unit: 'kcal', estimate: true },
        { nutrient: 'salt', status: 'zero', value: 0, unit: 'g', estimate: false },
        { nutrient: 'fibre', status: 'unknown', unit: 'g', estimate: true },
      ],
      4,
    );
    expect(rows.find((r) => r.label === 'Energy')?.value).toBe(1200);
    expect(rows.find((r) => r.label === 'Salt')?.status).toBe('zero');
    expect(rows.find((r) => r.label === 'Fibre')?.status).toBe('unknown');
    expect(rows.find((r) => r.label === 'Protein')?.status).toBe('unknown');
  });
});
