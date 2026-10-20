import { describe, expect, it } from 'vitest';
import type { CanonicalIngredient } from '@fr/domain';
import { InMemoryRecipeRepository } from '../../recipes/memory-repository';
import type { RecipeInput } from '../../recipes/schema';
import { createRecipeCalculator } from '../calc';
import { createIngredientCatalogue, getIngredientCatalogue } from '../refdata/catalogue';
import { resolveLinks, searchCatalogue, suggestLink } from './ingredient-links';
import { rematchAllRecipes, rematchRecipe } from './rematch';

const ing = (id: string, name: string, aliases: string[] = []): CanonicalIngredient =>
  ({ id, name, category: 'test', aliases }) as CanonicalIngredient;

/** "mince" is the name of one ingredient and an alias of two more: ambiguous by construction. */
const synthetic = createIngredientCatalogue([
  ing('id-mince', 'mince'),
  ing('id-beef', 'beef mince', ['mince']),
  ing('id-tom', 'tomato'),
  ing('id-flour', 'plain flour', ['flour']),
]);
const real = getIngredientCatalogue();

const line = (name: string, patch: Partial<RecipeInput['ingredients'][number]> = {}): RecipeInput['ingredients'][number] => ({
  name,
  quantity: { kind: 'exact', value: 1, unit: 'item', originalText: '1' },
  optional: false,
  ...patch,
});

describe('suggestLink', () => {
  it('links an exact name or alias, tolerating plurals and a typed quantity', () => {
    expect(suggestLink(real, 'tinned tomatoes')).toMatchObject({ status: 'matched', ingredientName: 'tinned tomatoes' });
    expect(suggestLink(real, 'Onions')).toMatchObject({ status: 'matched', ingredientName: 'onion' });
    expect(suggestLink(real, '400g chopped tomatoes')).toMatchObject({ status: 'matched', ingredientName: 'tinned tomatoes' });
  });

  it('reports ambiguity with the colliding candidates and never picks one', () => {
    const s = suggestLink(synthetic, 'mince');
    expect(s.status).toBe('ambiguous');
    expect(s.ingredientId).toBeUndefined();
    expect(s.candidates.map((c) => c.id).sort()).toEqual(['id-beef', 'id-mince']);
  });

  it('offers near-misses for an unknown name without linking', () => {
    const s = suggestLink(real, 'coriander');
    expect(s.status).toBe('unmatched');
    expect(s.candidates.map((c) => c.name)).toEqual(expect.arrayContaining(['fresh coriander', 'ground coriander']));
    expect(suggestLink(real, 'unobtanium')).toEqual({ status: 'unmatched', candidates: [] });
  });
});

describe('searchCatalogue', () => {
  it('ranks exact, prefix and substring hits and ignores very short queries', () => {
    expect(searchCatalogue(real, 'a')).toEqual([]);
    const names = searchCatalogue(real, 'tomato').map((c) => c.name);
    expect(names[0]).toBe('tomato');
    expect(names).toContain('tinned tomatoes');
    expect(searchCatalogue(real, 'zzzzqq')).toEqual([]);
    expect(searchCatalogue(real, 'tomato', 3)).toHaveLength(3);
  });

  it('finds by alias', () => {
    expect(searchCatalogue(synthetic, 'flour').map((c) => c.id)).toEqual(['id-flour']);
  });
});

describe('resolveLinks', () => {
  it('matches new lines on save (exact -> link, ambiguous/unknown -> unlinked with candidates)', () => {
    const { ingredients, report } = resolveLinks(synthetic, [line('tomato'), line('mince'), line('dragon fruit')], null);
    expect(ingredients.map((i) => i.ingredientId)).toEqual(['id-tom', null, null]);
    expect(report.map((r) => [r.status, r.source])).toEqual([['matched', 'auto'], ['ambiguous', 'auto'], ['unmatched', 'auto']]);
    expect(report[1]!.candidates.length).toBe(2);
  });

  it('keeps an id the caller sends (manual choice) over what the matcher would pick', () => {
    const { ingredients, report } = resolveLinks(synthetic, [line('tomato', { ingredientId: 'id-flour' })], null);
    expect(ingredients[0]!.ingredientId).toBe('id-flour');
    expect(report[0]!.source).toBe('chosen');
  });

  it('treats an unknown id as absent and matches by name', () => {
    const { ingredients } = resolveLinks(synthetic, [line('tomato', { ingredientId: 'not-in-catalogue' })], null);
    expect(ingredients[0]!.ingredientId).toBe('id-tom');
  });

  it('never re-matches an explicit "not in list" (null)', () => {
    const { ingredients, report } = resolveLinks(synthetic, [line('tomato', { ingredientId: null })], null);
    expect(ingredients[0]!.ingredientId).toBeNull();
    expect(report[0]!.source).toBe('none');
  });

  it('on edit, preserves the previous link of an unchanged line (even a manual one) and only matches changed lines', () => {
    const prev = [
      { id: 'l1', name: 'tomato', ingredientId: 'id-flour', quantity: line('x').quantity, optional: false, order: 0 },
      { id: 'l2', name: 'mince', ingredientId: 'id-beef', quantity: line('x').quantity, optional: false, order: 1 },
      { id: 'l3', name: 'plain flour', quantity: line('x').quantity, optional: false, order: 2 },
    ];
    const { ingredients, report } = resolveLinks(
      synthetic,
      [line('Tomato'), line('mince'), line('plain flour'), line('tomatoes')],
      prev,
    );
    expect(ingredients.map((i) => i.ingredientId)).toEqual(['id-flour', 'id-beef', null, 'id-tom']);
    expect(report.map((r) => r.source)).toEqual(['kept', 'kept', 'kept', 'auto']);
  });
});

const base = (ingredients: RecipeInput['ingredients']): RecipeInput => ({
  title: 'Hand made',
  description: '',
  imageUrl: null,
  sourceAttribution: '',
  sourceUrl: '',
  originalText: '',
  prepMinutes: null,
  cookMinutes: null,
  servings: 2,
  cuisine: '',
  mealType: 'dinner',
  diet: 'vegan',
  tags: [],
  ingredients,
  steps: ['Cook.'],
});

describe('repository round trip with links', () => {
  it('stores the resolved ids so cost is computed, and an explicit null survives an edit', async () => {
    const repo = new InMemoryRecipeRepository([], createRecipeCalculator());
    const created = await repo.create(base(resolveLinks(real, [line('plain flour', { quantity: { kind: 'exact', value: 200, unit: 'g', originalText: '200 g' } }), line('mystery')], null).ingredients));
    expect(created.ingredients[0]!.ingredientId).toBeTruthy();
    expect(created.ingredients[1]!.ingredientId).toBeUndefined();
    expect(created.cost.totalPence).toBeGreaterThan(0);

    // user unlinks line 1 ("not in list"): null must not be carried over from the previous same-name line
    const edited = await repo.update(created.id, base([line('plain flour', { ingredientId: null }), line('mystery')]));
    expect(edited!.ingredients[0]!.ingredientId).toBeUndefined();
  });
});

describe('rematch', () => {
  it('links only lines without a link, keeps existing links, and skips the save when nothing is new', async () => {
    const repo = new InMemoryRecipeRepository([], createRecipeCalculator());
    const mk = await repo.create(base([line('plain flour'), line('olive oil', { ingredientId: real.matcher.match('olive oil').ingredientId! }), line('mystery')]));
    expect(mk.ingredients.map((i) => !!i.ingredientId)).toEqual([false, true, false]);

    const first = await rematchRecipe(repo, real, mk.id);
    expect(first).toMatchObject({ recipes: 1, updated: 1, linked: 1, unmatched: 1, ambiguous: 0 });
    const after = (await repo.get(mk.id))!;
    expect(after.ingredients.map((i) => !!i.ingredientId)).toEqual([true, true, false]);
    expect(after.ingredients[1]!.ingredientId).toBe(mk.ingredients[1]!.ingredientId);

    const updatedAt = after.updatedAt;
    const second = await rematchRecipe(repo, real, mk.id);
    expect(second).toMatchObject({ updated: 0, linked: 0 });
    expect((await repo.get(mk.id))!.updatedAt).toBe(updatedAt);
    expect(await rematchRecipe(repo, real, 'nope')).toBeNull();
  });

  it('rematchAllRecipes walks every recipe of the library across pages', async () => {
    const repo = new InMemoryRecipeRepository([], createRecipeCalculator());
    for (let i = 0; i < 60; i++) await repo.create({ ...base([line('plain flour')]), title: `R${i}` });
    const s = await rematchAllRecipes(repo, real);
    expect(s).toMatchObject({ recipes: 60, updated: 60, linked: 60 });
    expect((await repo.list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 100 })).items.every((r) => r.ingredients[0]!.ingredientId)).toBe(true);
  });
});
