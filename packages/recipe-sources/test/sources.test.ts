import { describe, expect, it, vi } from 'vitest';
import { buildDraft, RecipeExtractionSchema, type IngredientParser } from '@fr/recipe-import';
import {
  FIXTURE_MEALS, MockRecipeSource, RecipeSourceError, TheMealDbSource, TtlCache, checkRecipe, createRateLimiter, dietTags,
  filterByExclusions, inferDiet, normaliseMeal, splitInstructions, toExtraction, type ExclusionRules, type SourceRecipe,
} from '../src/index.js';

const parser: IngredientParser = {
  parse(text) {
    const m = /^(\d+(?:\.\d+)?)\s*(g|kg|ml|tbsp|tsp)?\s+(.*)$/i.exec(text);
    if (m) return { quantity: { kind: 'exact', value: Number(m[1]), ...(m[2] ? { unit: m[2].toLowerCase() as 'g' } : {}), originalText: text }, name: m[3]!, optional: false };
    return { quantity: { kind: 'unparsed', originalText: text }, name: text, optional: false };
  },
};

const recipes: SourceRecipe[] = FIXTURE_MEALS.map((m) => normaliseMeal(m)!);
const byTitle = (t: string) => recipes.find((r) => r.title.startsWith(t))!;

function fakeFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const f = vi.fn(async (url: string | URL | Request) => {
    const u = String(url);
    calls.push(u);
    const key = Object.keys(routes).find((k) => u.includes(k));
    if (!key) return new Response('', { status: 404 });
    const body = routes[key];
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
  });
  return { f: f as unknown as typeof fetch, calls };
}
const sleep = async () => undefined;

describe('TheMealDB mapping', () => {
  it('normalises a raw meal: ingredients, measures, area, tags, attribution, https image only', () => {
    const r = byTitle('Lemon Grilled Salmon');
    expect(r.attribution).toEqual({ publisher: 'TheMealDB', url: 'https://www.themealdb.com/meal/90001', id: '90001' });
    expect(r.area).toBe('British');
    expect(r.tags).toEqual(['Fish', 'Quick']);
    expect(r.ingredients[0]).toEqual({ name: 'Salmon', measure: '4 fillets' });
    expect(r.ingredients).toHaveLength(5);
    expect(r.imageUrl).toMatch(/^https:\/\/www\.themealdb\.com\//);
    const evil = normaliseMeal({ ...FIXTURE_MEALS[0]!, strMealThumb: 'https://evil.example/x.jpg' });
    expect(evil?.imageUrl).toBeUndefined();
    const js = normaliseMeal({ ...FIXTURE_MEALS[0]!, strMealThumb: 'javascript:alert(1)' });
    expect(js?.imageUrl).toBeUndefined();
  });

  it('rejects meals with no ingredients or no instructions', () => {
    expect(normaliseMeal({ idMeal: '1', strMeal: 'Empty', strInstructions: 'Do things' })).toBeNull();
    expect(normaliseMeal({ idMeal: '1', strMeal: 'Silent', strIngredient1: 'Egg', strMeasure1: '1', strInstructions: '  ' })).toBeNull();
  });

  it('maps to a valid extraction: original text kept, area -> cuisine, category -> tag, source recorded, no servings invented', () => {
    const r = byTitle('Lemon Grilled Salmon');
    const x = toExtraction(r, parser, inferDiet(r, () => 'fruit_veg'));
    expect(RecipeExtractionSchema.safeParse(x).success).toBe(true);
    expect(x.cuisine).toBe('British');
    expect(x.servings).toBeUndefined();
    expect(x.sourcePublisher).toBe('TheMealDB');
    expect(x.sourceReference).toBe('https://www.themealdb.com/meal/90001');
    expect(x.ingredients[1]!.originalText).toBe('2 tbsp Olive Oil');
    expect(x.ingredients[1]!.quantity).toMatchObject({ kind: 'exact', value: 2, unit: 'tbsp' });
    // bare salt / pepper become to-taste pantry staples; a bare main ingredient stays unparsed for the reviewer
    expect(x.ingredients[3]).toMatchObject({ name: 'Salt', pantryStaple: true, quantity: { kind: 'to_taste' } });
    expect(x.steps).toEqual(['Heat the grill to high.', 'Brush the salmon with olive oil, season and grill for 8 minutes.', 'Serve with lemon wedges.']);
    expect(x.tags).toContain('seafood');
    expect(x.tags).toContain('diet-unverified');
    expect(x.warnings.join(' ')).toMatch(/not verified/);
  });

  it('feeds the SAME buildDraft as a photo import (no AI): draft keeps the source and flags unparsed lines', () => {
    const r = byTitle('Cod and Pea Bake');
    const draft = buildDraft(toExtraction(r, parser), { parser, matcher: { match: () => ({ confidence: 0, alternatives: [] }) } }, { source: 'TheMealDB' });
    expect(draft.sourcePublisher).toBe('TheMealDB');
    expect(draft.sourceReference).toBe('https://www.themealdb.com/meal/90002');
    expect(draft.ingredients[3]!.quantity.value.kind).toBe('exact'); // "1 tbsp Fresh Parsley"
    expect(draft.original).toMatchObject({ title: 'Cod and Pea Bake' });
  });

  it('splits numbered, STEP-headed and single-paragraph instructions', () => {
    expect(splitInstructions('1. Chop.\r\n2. Fry.')).toEqual(['Chop.', 'Fry.']);
    expect(splitInstructions('STEP 1\nChop.\nSTEP 2\nFry.')).toEqual(['Chop.', 'Fry.']);
    const long = Array.from({ length: 20 }, (_, i) => `Do thing number ${i + 1} carefully.`).join(' ');
    const steps = splitInstructions(long);
    expect(steps.length).toBeGreaterThan(1);
    expect(steps.join(' ')).toBe(long);
  });
});

describe('diet inference (never assumed)', () => {
  const catalogue = new Map<string, string>([
    ['onion', 'fruit_veg'], ['red pepper', 'fruit_veg'], ['kidney beans', 'tinned_jarred'], ['tinned tomatoes', 'tinned_jarred'], ['chilli powder', 'herbs_spices'],
    ['smoked paprika', 'herbs_spices'], ['basmati rice', 'pasta_rice_grains'], ['red lentils', 'tinned_jarred'], ['turmeric', 'herbs_spices'], ['ground cumin', 'herbs_spices'],
    ['garlic clove', 'fruit_veg'], ['water', 'drinks'], ['salt', 'herbs_spices'], ['salmon', 'fish_seafood'], ['plain flour', 'baking'], ['milk', 'dairy_eggs'],
    ['egg', 'dairy_eggs'], ['butter', 'dairy_eggs'], ['caster sugar', 'baking'], ['chicken breast', 'meat_poultry'], ['mushroom', 'fruit_veg'], ['arborio rice', 'pasta_rice_grains'],
    ['vegetable stock', 'sauces_condiments'], ['parmesan', 'dairy_eggs'],
  ]);
  const cat = (n: string) => catalogue.get(n.toLowerCase());

  it('labels vegan only when every line is matched and none is an animal product', () => {
    expect(inferDiet(byTitle('Red Lentil Dal'), cat).diet).toBe('vegan');
    expect(inferDiet(byTitle('Smoky Vegetable Chilli'), cat).diet).toBe('vegan');
  });
  it('dairy/egg downgrades vegan to vegetarian; meat and fish win', () => {
    const pancakes = byTitle('Fluffy Pancakes');
    expect(inferDiet(pancakes, cat).diet).toBe('vegetarian');
    expect(inferDiet(byTitle('Lemon Grilled Salmon'), cat).diet).toBe('fish');
    expect(inferDiet(byTitle('Chicken and Leek Pie'), cat).diet).toBe('meat');
  });
  it('an unmatched line or a hedged ingredient (parmesan, plain stock) never yields vegetarian', () => {
    expect(inferDiet(byTitle('Gruyere Leek Tart'), cat).diet).toBe('meat');
    expect(inferDiet(byTitle('Mushroom Risotto'), cat).diet).toBe('meat'); // parmesan: rennet, not verifiable
    expect(inferDiet({ title: 'Soup', ingredients: [{ name: 'Beef Stock', measure: '1l' }] }, () => 'x').diet).toBe('meat');
  });
  it("ignores the publisher's own category (a 'Vegetarian' dish with chicken is meat)", () => {
    const sneaky: SourceRecipe = { ...byTitle('Smoky Vegetable Chilli'), category: 'Vegetarian', ingredients: [{ name: 'Chicken Breast', measure: '1' }] };
    expect(inferDiet(sneaky, cat).diet).toBe('meat');
  });
  it('is always unverified and tags the draft', () => {
    const d = inferDiet(byTitle('Red Lentil Dal'), cat);
    expect(d.verified).toBe(false);
    expect(dietTags(d)).toEqual(['vegan', 'diet-unverified']);
    expect(dietTags(inferDiet(byTitle('Chicken and Leek Pie'), cat))).toEqual(['diet-unverified']);
  });
});

describe('exclusion filtering (server-side, fail-safe)', () => {
  const ids = new Map<string, string>([['peanut butter', 'id-pb'], ['peanuts', 'id-peanut'], ['salmon', 'id-salmon'], ['olive oil', 'id-oil'], ['lemon', 'id-lemon'], ['salt', 'id-salt'], ['black pepper', 'id-pepper'], ['cod', 'id-cod'], ['peas', 'id-peas'], ['fresh parsley', 'id-parsley'], ['egg noodles', 'id-noodles'], ['soy sauce', 'id-soy'], ['spring onion', 'id-so']]);
  const rules = (over: Partial<ExclusionRules> = {}): ExclusionRules => ({
    terms: [], excludeIngredientIds: new Set(), excludeDiets: [],
    resolveIngredientId: (n) => ids.get(n.toLowerCase()),
    textHitsAllergen: (t) => /peanut|groundnut/i.test(t),
    ...over,
  });

  it('removes a recipe containing an excluded ingredient id, term, or allergen keyword', () => {
    const r1 = rules({ excludeIngredientIds: new Set(['id-peanut', 'id-pb']) });
    expect(checkRecipe(byTitle('Peanut Satay Noodles'), r1, 'vegetarian', true).ok).toBe(false);
    expect(checkRecipe(byTitle('Lemon Grilled Salmon'), r1, 'fish', true).ok).toBe(true);
    const r2 = rules({ terms: ['salmon'] });
    expect(checkRecipe(byTitle('Lemon Grilled Salmon'), r2, 'fish', true)).toMatchObject({ ok: false, reason: 'exclusion' });
    const r3 = rules(); // ids empty: only the keyword net catches "Peanut Butter"
    expect(checkRecipe(byTitle('Peanut Satay Noodles'), r3, 'vegetarian', true)).toMatchObject({ ok: false, reason: 'exclusion' });
  });

  it('catches an excluded term mentioned only in the method', () => {
    const r: SourceRecipe = { ...byTitle('Cod and Pea Bake'), instructions: 'Bake, then scatter crushed walnuts on top.' };
    expect(checkRecipe(r, rules({ terms: ['walnut'] }), 'fish', true)).toMatchObject({ ok: false });
  });

  it('fails safe on an unmatched line when exclusions are active, but not when none are', () => {
    const leek = byTitle('Gruyere Leek Tart'); // Gruyere / Leek / pastry unmatched here
    expect(checkRecipe(leek, rules({ terms: ['peanut'] }), 'vegetarian', true)).toMatchObject({ ok: false, reason: 'unverifiable' });
    expect(checkRecipe(leek, rules(), 'vegetarian', false).ok).toBe(true);
  });

  it('hides diet categories and reports withheld counts', () => {
    const out = filterByExclusions(recipes, rules({ excludeDiets: ['meat'], terms: ['peanut'] }), (r) => (r.title.includes('Chicken') ? 'meat' : 'fish'), true);
    expect(out.kept.map((r) => r.title)).toContain('Lemon Grilled Salmon');
    expect(out.kept.map((r) => r.title)).not.toContain('Chicken and Leek Pie');
    expect(out.kept.map((r) => r.title)).not.toContain('Peanut Satay Noodles');
    expect(out.withheld).toBe(recipes.length - out.kept.length);
    expect(out.withheldUnverifiable).toBeGreaterThan(0);
  });
});

describe('TheMealDbSource (fake fetch)', () => {
  const salmonRaw = FIXTURE_MEALS[0]!;

  it('uses the key in the URL, validates with zod, and caches', async () => {
    const { f, calls } = fakeFetch({ 'search.php?s=salmon': { meals: [salmonRaw] } });
    const src = new TheMealDbSource({ apiKey: 'secret-key', fetch: f, sleep, minIntervalMs: 0 });
    const a = await src.search('salmon');
    const b = await src.search('salmon');
    expect(a[0]!.title).toBe('Lemon Grilled Salmon');
    expect(b).toEqual(a);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('/v1/secret-key/search.php?s=salmon');
  });

  it("defaults to the test key '1'", async () => {
    const { f, calls } = fakeFetch({ 'lookup.php': { meals: [salmonRaw] } });
    await new TheMealDbSource({ fetch: f, sleep, minIntervalMs: 0 }).byId('90001');
    expect(calls[0]).toContain('/v1/1/lookup.php?i=90001');
  });

  it('handles null meals, empty bodies and non-numeric ids without throwing', async () => {
    const { f } = fakeFetch({ 'search.php': { meals: null }, 'lookup.php': '' });
    const src = new TheMealDbSource({ fetch: f, sleep, minIntervalMs: 0 });
    expect(await src.search('zzz')).toEqual([]);
    expect(await src.byId('123')).toBeNull();
    expect(await src.byId('../etc')).toBeNull();
    expect(await src.search('')).toEqual([]);
  });

  it('filter endpoints hydrate details via lookup, cap the count, and apply the other filters', async () => {
    const { f, calls } = fakeFetch({
      'filter.php?c=Seafood': { meals: [{ idMeal: '90001', strMeal: 'x', strMealThumb: null }, { idMeal: '90002', strMeal: 'y', strMealThumb: null }, { idMeal: '90009', strMeal: 'z', strMealThumb: null }] },
      'lookup.php?i=90001': { meals: [FIXTURE_MEALS[0]] },
      'lookup.php?i=90002': { meals: [FIXTURE_MEALS[1]] },
      'lookup.php?i=90009': { meals: [FIXTURE_MEALS[8]] },
    });
    const src = new TheMealDbSource({ fetch: f, sleep, minIntervalMs: 0 });
    const all = await src.search('', { category: 'Seafood' });
    expect(all.map((r) => r.id)).toEqual(['90001', '90002', '90009']);
    const chinese = await src.search('', { category: 'Seafood', area: 'Chinese' });
    expect(chinese.map((r) => r.id)).toEqual(['90009']);
    expect((await src.search('', { category: 'Seafood', limit: 1 })).length).toBe(1);
    expect(calls.filter((c) => c.includes('filter.php')).length).toBe(1); // cached
  });

  it('ingredient filter converts spaces to underscores', async () => {
    const { f, calls } = fakeFetch({ 'filter.php': { meals: null } });
    await new TheMealDbSource({ fetch: f, sleep, minIntervalMs: 0 }).byIngredient('chicken breast');
    expect(calls[0]).toContain('filter.php?i=chicken_breast');
  });

  it('maps HTTP and JSON failures to RecipeSourceError', async () => {
    const down = new TheMealDbSource({ fetch: (async () => new Response('', { status: 503 })) as unknown as typeof fetch, sleep, minIntervalMs: 0 });
    await expect(down.search('x')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const limited = new TheMealDbSource({ fetch: (async () => new Response('', { status: 429 })) as unknown as typeof fetch, sleep, minIntervalMs: 0 });
    await expect(limited.search('x')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    const bad = new TheMealDbSource({ fetch: (async () => new Response('{"meals":"nope"}')) as unknown as typeof fetch, sleep, minIntervalMs: 0 });
    await expect(bad.search('x')).rejects.toBeInstanceOf(RecipeSourceError);
    const offline = new TheMealDbSource({ fetch: (async () => { throw new TypeError('network'); }) as unknown as typeof fetch, sleep, minIntervalMs: 0 });
    await expect(offline.search('x')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });

  it('lists categories and areas', async () => {
    const { f } = fakeFetch({ 'list.php?c=list': { meals: [{ strCategory: 'Seafood' }, { strCategory: 'Beef' }] }, 'list.php?a=list': { meals: [{ strArea: 'Thai' }] } });
    const src = new TheMealDbSource({ fetch: f, sleep, minIntervalMs: 0 });
    expect(await src.categories()).toEqual(['Beef', 'Seafood']);
    expect(await src.areas()).toEqual(['Thai']);
  });
});

describe('mock provider', () => {
  it('honours the RecipeSource contract offline', async () => {
    const m = new MockRecipeSource();
    expect((await m.search('salmon')).map((r) => r.title)).toEqual(['Lemon Grilled Salmon']);
    expect((await m.search('', { area: 'Thai' })).length).toBe(1);
    expect((await m.byCategory('Seafood')).length).toBe(3);
    expect((await m.byIngredient('leek')).length).toBe(2);
    expect(await m.search('')).toEqual([]);
    expect((await m.byId('90005'))!.title).toBe('Red Lentil Dal');
    expect(await m.byId('nope')).toBeNull();
    expect(await m.random()).not.toBeNull();
  });
});

describe('cache and rate limiting', () => {
  it('expires entries after the TTL', () => {
    let t = 0;
    const c = new TtlCache<number>(1000, 10, () => t);
    c.set('a', 1);
    expect(c.get('a')).toBe(1);
    t = 1001;
    expect(c.get('a')).toBeUndefined();
  });
  it('spaces calls by the minimum interval', async () => {
    let t = 0;
    const waits: number[] = [];
    const limit = createRateLimiter(250, { now: () => t, sleep: async (ms) => { waits.push(ms); t += ms; } });
    await Promise.all([limit(async () => 1), limit(async () => 2), limit(async () => 3)]);
    expect(waits).toEqual([250, 250]);
  });
});
