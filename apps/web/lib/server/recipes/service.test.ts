import { describe, expect, it } from 'vitest';
import { InMemoryRecipeRepository } from '../../recipes/memory-repository';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { checkDuplicates, previewLinks, saveRecipe, searchIngredients } from './service';

const catalogue = getIngredientCatalogue();
const MISSING = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const repo = () => new InMemoryRecipeRepository([]);

const recipe = (title: string, over: Record<string, unknown> = {}) => ({
  title, description: '', imageUrl: null, sourceAttribution: '', sourceUrl: '', originalText: '', prepMinutes: 5, cookMinutes: 10,
  servings: 2, cuisine: 'British', mealType: 'dinner', diet: 'vegetarian', tags: [],
  ingredients: [{ name: 'plain flour', quantity: { kind: 'exact', value: 200, unit: 'g', originalText: '200g' }, optional: false }],
  steps: ['Mix.'], ...over,
});

describe('saveRecipe', () => {
  it('creates, links catalogue ingredients and returns the link report', async () => {
    const r = repo();
    const out = await saveRecipe(r, catalogue, null, recipe('Scones'));
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.links).toHaveLength(1);
    expect((await r.get(out.id))?.ingredients[0]?.ingredientId).toBeTruthy();
  });

  it('reports the first error per field, and rejects a bad id or an unknown recipe without writing', async () => {
    const r = repo();
    const bad = await saveRecipe(r, catalogue, null, recipe('', { steps: [] }));
    expect(bad).toMatchObject({ ok: false });
    expect(!bad.ok && Object.keys(bad.fieldErrors).sort()).toEqual(['steps', 'title']);
    expect(await saveRecipe(r, catalogue, 'nope', recipe('X'))).toEqual({ ok: false, fieldErrors: {}, message: 'Invalid recipe id' });
    expect(await saveRecipe(r, catalogue, MISSING, recipe('X'))).toEqual({ ok: false, fieldErrors: {}, message: 'Recipe not found' });
    expect((await r.list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 10 })).total).toBe(0);
  });

  it('blocks duplicates unless forced, and ignores itself when editing', async () => {
    const r = repo();
    const first = await saveRecipe(r, catalogue, null, recipe('Scones'));
    if (!first.ok) throw new Error('unreachable');
    const dup = await saveRecipe(r, catalogue, null, recipe('Scones'));
    expect(dup).toMatchObject({ ok: false, duplicates: [{ id: first.id, title: 'Scones' }] });
    expect((await saveRecipe(r, catalogue, null, recipe('Scones'), true)).ok).toBe(true);
    expect((await saveRecipe(r, catalogue, first.id, recipe('Scones', { servings: 6 }))).ok).toBe(false); // the forced copy now exists
    expect((await saveRecipe(r, catalogue, first.id, recipe('Scones', { servings: 6 }), true)).ok).toBe(true);
    expect((await r.get(first.id))?.servings).toBe(6);
  });
});

describe('checkDuplicates / previewLinks / searchIngredients', () => {
  it('checkDuplicates finds twins, excludes by id and returns nothing for invalid input', async () => {
    const r = repo();
    const s = await saveRecipe(r, catalogue, null, recipe('Twin'));
    if (!s.ok) throw new Error('unreachable');
    expect(await checkDuplicates(r, 'Twin', ['plain flour'])).toEqual([{ id: s.id, title: 'Twin' }]);
    expect(await checkDuplicates(r, 'Twin', ['plain flour'], s.id)).toEqual([]);
    expect(await checkDuplicates(r, 'Twin', ['plain flour'], 'not-a-uuid')).toEqual([]);
    expect(await checkDuplicates(r, 'T'.repeat(161), [])).toEqual([]);
  });

  it('previewLinks matches per name and rejects invalid lists wholesale', () => {
    expect(previewLinks(catalogue, ['plain flour', 'zzz mystery item']).map((s) => s.status)).toEqual(['matched', 'unmatched']);
    expect(previewLinks(catalogue, [''])).toEqual([]);
    expect(previewLinks(catalogue, Array(101).fill('flour'))).toEqual([]);
  });

  it('searchIngredients needs 2+ characters', () => {
    expect(searchIngredients(catalogue, 'flour').length).toBeGreaterThan(0);
    expect(searchIngredients(catalogue, ' f ')).toEqual([]);
    expect(searchIngredients(catalogue, 'x'.repeat(61))).toEqual([]);
  });
});
