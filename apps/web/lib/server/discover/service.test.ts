import { beforeEach, describe, expect, it } from 'vitest';
import { MockRecipeSource } from '@fr/recipe-sources';
import { saveImport } from '../import/pipeline';
import { InMemoryRecipeSink } from '../import/sink';
import { getUpload } from '../import/upload-store';
import { buildRules, categoriesFor, discoverIdeas, discoverSearch, startDiscoverDraft } from './service';
import { recipeSourceStatus } from './source';

const source = new MockRecipeSource();
const peanuts = { hardExclusions: [{ ingredientName: 'peanuts', kind: 'allergy' as const }] };
const none = { hardExclusions: [] };
const titles = (o: Awaited<ReturnType<typeof discoverSearch>>) => (o.ok ? o.cards.map((c) => c.title) : []);

describe('discoverSearch', () => {
  it('returns attributed cards with an unverified diet label', async () => {
    const o = await discoverSearch({ q: 'salmon' }, none, {}, source);
    expect(o.ok && o.cards[0]).toMatchObject({ title: 'Lemon Grilled Salmon', diet: 'fish', attribution: { publisher: 'TheMealDB', url: 'https://www.themealdb.com/meal/90001' } });
  });

  it('never returns a recipe with a household hard exclusion (peanut allergy), whatever the search', async () => {
    const o = await discoverSearch({ q: 'noodles' }, peanuts, {}, source);
    expect(titles(o)).toEqual([]);
    expect(o.ok && o.withheld).toBe(1);
    const ing = await discoverSearch({ ingredient: 'peanut' }, peanuts, {}, source);
    expect(titles(ing)).toEqual([]);
  });

  it('the client can add exclusions (allergen group, diet) but the household ones always apply', async () => {
    const dairy = await discoverSearch({ q: 'pancakes' }, none, { allergens: ['milk'] }, source);
    expect(titles(dairy)).toEqual([]);
    const noFish = await discoverSearch({ category: 'Seafood' }, none, { excludeDiets: ['fish'] }, source);
    expect(titles(noFish)).toEqual([]);
    const all = await discoverSearch({ category: 'Seafood' }, peanuts, {}, source);
    expect(titles(all)).toEqual(['Lemon Grilled Salmon', 'Cod and Pea Bake', 'Quick Prawn Stir Fry']);
  });

  it('fails safe: unmatched ingredient lines hide the recipe while exclusions are active, and say so', async () => {
    const withEx = await discoverSearch({ q: 'tart' }, peanuts, {}, source);
    expect(titles(withEx)).toEqual([]);
    expect(withEx.ok && withEx.withheldUnverifiable).toBe(1);
    const without = await discoverSearch({ q: 'tart' }, none, {}, source);
    expect(titles(without)).toEqual(['Gruyere Leek Tart']);
  });

  it('returns nothing (not everything) for an empty search', async () => {
    expect(titles(await discoverSearch({}, none, {}, source))).toEqual([]);
  });

  it('reports a readable error when the source is down', async () => {
    const down = { ...source, search: async () => { throw new Error('boom'); } } as unknown as MockRecipeSource;
    const o = await discoverSearch({ q: 'x' }, none, {}, down);
    expect(o.ok).toBe(false);
  });
});

describe('discoverIdeas (planner gaps)', () => {
  it('fish need -> only recipes that look like fish, never the household exclusions', async () => {
    const o = await discoverIdeas({ dietCategory: 'fish', mealType: 'dinner' }, peanuts, {}, source);
    expect(titles(o)).toEqual(['Lemon Grilled Salmon', 'Cod and Pea Bake', 'Quick Prawn Stir Fry']);
    const noPrawn = await discoverIdeas({ dietCategory: 'fish' }, peanuts, { terms: ['prawns'] }, source);
    expect(titles(noPrawn)).toEqual(['Lemon Grilled Salmon', 'Cod and Pea Bake']);
  });

  it("vegetarian need ignores the publisher's category and trusts only the ingredients", async () => {
    const o = await discoverIdeas({ dietCategory: 'vegetarian' }, none, {}, source);
    // Parmesan (rennet) and the unmatched Gruyere never qualify; the chilli and dal do.
    expect(titles(o)).toEqual(expect.arrayContaining(['Smoky Vegetable Chilli', 'Red Lentil Dal']));
    expect(titles(o)).not.toContain('Mushroom Risotto');
    expect(titles(o)).not.toContain('Gruyere Leek Tart');
  });

  it('a peanut-allergic household never gets the satay in vegetarian ideas', async () => {
    const o = await discoverIdeas({ dietCategory: 'vegetarian' }, peanuts, {}, source);
    expect(titles(o)).not.toContain('Peanut Satay Noodles');
  });

  it('maps needs to source categories', () => {
    expect(categoriesFor({ dietCategory: 'fish' })).toEqual(['Seafood']);
    expect(categoriesFor({ mealType: 'breakfast' })).toEqual(['Breakfast']);
  });
});

describe('buildRules', () => {
  it('expands household terms and allergens to ids and groups', () => {
    const { rules, active } = buildRules(peanuts, { allergens: ['dairy'] });
    expect(active).toBe(true);
    expect(rules.terms).toEqual(expect.arrayContaining(['peanuts', 'dairy']));
    expect(rules.excludeIngredientIds.size).toBeGreaterThan(0);
    expect(rules.textHitsAllergen('Cheddar cheese')).toBe(true);
    expect(rules.textHitsAllergen('Carrot')).toBe(false);
  });
  it('is inactive with no exclusions', () => {
    expect(buildRules(none).active).toBe(false);
  });
});

describe('startDiscoverDraft -> review -> save (same pipeline as photo import, no AI)', () => {
  const owner = { userId: 'u1', householdId: 'h1' };
  beforeEach(() => undefined);

  it('builds a draft with source + original kept and saves it with a link back and the publisher image', async () => {
    const out = await startDiscoverDraft('90001', owner, none, source);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const { draft, uploadId } = out;
    expect(draft.sourcePublisher).toBe('TheMealDB');
    expect(draft.sourceReference).toBe('https://www.themealdb.com/meal/90001');
    expect(draft.cuisine).toBe('British');
    expect(draft.coverImageRef).toMatch(/^https:\/\/www\.themealdb\.com\//);
    expect(draft.steps.length).toBe(3);
    expect(draft.tags).toEqual(expect.arrayContaining(['fish', 'diet-unverified']));
    expect(draft.ingredients[0]!.ingredientId.value).toBeDefined(); // salmon matched by the engine matcher
    expect(getUpload(uploadId)?.owner).toEqual(owner);

    const sink = new InMemoryRecipeSink();
    // servings are not given by the source: the reviewer sets them
    const edited = structuredClone(draft);
    edited.servings = { value: 4, status: 'ok', warnings: [] };
    // a tampering client cannot swap the attribution or the cover
    edited.sourcePublisher = 'Someone else';
    edited.coverImageRef = 'https://evil.example/x.jpg';
    const saved = await saveImport({ uploadId, draft: edited, owner }, { sink });
    expect(saved.ok).toBe(true);
    const f = await sink.get((saved as { id: string }).id);
    expect(f!.recipe.sourcePublisher).toBe('TheMealDB');
    expect(f!.recipe.imageRef).toMatch(/^https:\/\/www\.themealdb\.com\//);
    expect(f!.recipe.cuisine).toBe('British');
    expect(f!.ingredients[1]!.originalText).toBe('2 tbsp Olive Oil');
  });

  it('refuses a recipe the household excludes, and a recipe that vanished', async () => {
    const nope = await startDiscoverDraft('90004', owner, peanuts, source);
    expect(nope.ok).toBe(false);
    const gone = await startDiscoverDraft('99999', owner, none, source);
    expect(gone.ok).toBe(false);
  });

  it('another user cannot save my draft', async () => {
    const out = await startDiscoverDraft('90005', owner, none, source);
    if (!out.ok) throw new Error('draft failed');
    const r = await saveImport({ uploadId: out.uploadId, draft: out.draft, owner: { userId: 'u2', householdId: 'h1' } }, { sink: new InMemoryRecipeSink() });
    expect(r.ok).toBe(false);
  });
});

describe('recipeSourceStatus', () => {
  it('describes the key without revealing it', () => {
    const saved = { ...process.env };
    try {
      delete process.env.RECIPE_SOURCE;
      delete process.env.THEMEALDB_API_KEY;
      expect(recipeSourceStatus()).toMatchObject({ provider: 'themealdb', keyKind: 'test' });
      process.env.THEMEALDB_API_KEY = 'super-secret-supporter-key';
      const s = recipeSourceStatus();
      expect(s.keyKind).toBe('supporter');
      expect(JSON.stringify(s)).not.toContain('super-secret');
      process.env.RECIPE_SOURCE = 'mock';
      expect(recipeSourceStatus()).toMatchObject({ provider: 'mock', keyKind: 'none' });
    } finally {
      process.env = saved;
    }
  });
});
