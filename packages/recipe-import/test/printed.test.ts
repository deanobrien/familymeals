import { describe, expect, it } from 'vitest';
import {
  RecipeExtractionSchema, applyCorrections, buildDraft, finaliseDraft, mergeExtractions, type RecipeExtraction,
} from '../src/index.js';
import { testMatcher, testParser } from './helpers.js';

const deps = { parser: testParser, matcher: testMatcher, now: () => new Date('2026-10-19T10:00:00Z') };

const card = (over: Record<string, unknown> = {}): RecipeExtraction => RecipeExtractionSchema.parse({
  title: 'Smoky Chicken Wraps',
  ingredients: [
    { originalText: '200ml vegetable stock [400ml]', name: 'vegetable stock', quantity: { kind: 'exact', value: 200, unit: 'ml', originalText: '200ml' }, confidence: 0.9 },
    { originalText: '1 tsp smoked paprika [2 tsp]', name: 'smoked paprika', quantity: { kind: 'exact', value: 1, unit: 'tsp', originalText: '1 tsp' }, confidence: 0.9 },
    { originalText: 'salt', name: 'salt', quantity: { kind: 'to_taste', originalText: 'salt' }, pantryStaple: true, confidence: 0.9 },
  ],
  steps: ['Cook.'],
  servings: 2,
  printedNutrition: { basis: 'per person', note: 'supplied ingredients only', values: [{ nutrient: 'Calories', amount: 640, unit: 'kcal' }, { nutrient: 'Fat', amount: 14, unit: 'g' }] },
  printedAllergens: ['A1: gluten', 'A7: milk'],
  sourcePublisher: 'Example Meal Kit Co',
  sourceReference: 'Recipe bag 1234',
  frontImageIndex: 2,
  frontImageRotation: 90,
  ...over,
});

describe('bracketed meal-kit quantities', () => {
  const d = buildDraft(card(), deps, { sourceImageRefs: ['p1', 'p2'] });

  it('keeps the base amount, the full printed line, and notes the alternative in warnings', () => {
    const stock = d.ingredients[0]!;
    expect(stock.originalText).toBe('200ml vegetable stock [400ml]');
    expect(stock.quantity.value).toMatchObject({ kind: 'exact', value: 200, unit: 'ml' });
    expect(stock.quantity.warnings.join(' ')).toMatch(/\[400ml\]/);
    // parser reads the base amount, so there is no disagreement and nothing blocks
    expect(stock.quantity.status).toBe('ok');
    expect(stock.quantity.alternative).toBeUndefined();
    expect(d.issues.filter((i) => i.blocking)).toEqual([]);
    expect(d.servings.value).toBe(2);
  });

  it('adds one draft-level warning when the AI did not mention the brackets', () => {
    expect(d.warnings.filter((w) => /bracket/i.test(w))).toHaveLength(1);
    const mentioned = buildDraft(card({ warnings: ['Card gives amounts for 2 people, with doubled amounts in [brackets] for 4'] }), deps);
    expect(mentioned.warnings.filter((w) => /bracket/i.test(w))).toHaveLength(1);
  });

  it('still flags it if the AI used the bracketed (doubled) value', () => {
    const wrong = card();
    wrong.ingredients[0]!.quantity = { kind: 'exact', value: 400, unit: 'ml', originalText: '400ml' };
    const dd = buildDraft(wrong, deps);
    expect(dd.ingredients[0]!.quantity.status).toBe('needs_clarification');
    expect(dd.ingredients[0]!.quantity.alternative).toMatchObject({ value: 200 });
  });

  it('a non-quantity bracket on a line is not treated as an alternative amount', () => {
    const dd = buildDraft(card({ ingredients: [{ originalText: '1 onion [optional]', name: 'onion', quantity: { kind: 'exact', value: 1, unit: 'item', originalText: '1' }, optional: false, confidence: 0.9 }] }), deps);
    expect(dd.ingredients[0]!.quantity.warnings.join(' ')).not.toMatch(/larger serving/);
  });
});

describe('pantry staples', () => {
  it('"You need: olive oil, salt" lines are flagged, to_taste, never blocking, original text preserved', () => {
    const d = buildDraft(card(), deps);
    const salt = d.ingredients[2]!;
    expect(salt.pantryStaple).toBe(true);
    expect(salt.quantity.value.kind).toBe('to_taste');
    expect(salt.quantity.status).toBe('ok');
    expect(salt.quantity.warnings).toEqual([]);
    expect(salt.originalText).toBe('salt');
    expect(d.issues.some((i) => i.blocking)).toBe(false);
    expect(d.ingredients[0]!.pantryStaple).toBeUndefined();
  });
});

describe('printed nutrition, allergens and source', () => {
  const d = buildDraft(card(), deps, { sourceImageRefs: ['p1', 'p2'] });

  it('stores printed nutrition labelled as source-provided and not calculated', () => {
    expect(d.printedNutrition).toMatchObject({ basis: 'per person', source: 'recipe card', calculated: false });
    expect(d.printedNutrition!.values).toHaveLength(2);
    expect(d.printedAllergens).toEqual(['A1: gluten', 'A7: milk']);
  });

  it('puts the publisher / reference in the source fields', () => {
    expect(d.sourcePublisher).toBe('Example Meal Kit Co');
    expect(d.sourceReference).toBe('Recipe bag 1234');
    expect(d.source).toBe('Example Meal Kit Co (Recipe bag 1234)');
    expect(buildDraft(card(), deps, { source: 'Mum' }).source).toBe('Mum');
  });

  it('carries the cover page and rotation; ignores a front index beyond the uploaded pages', () => {
    expect(d.coverPage).toBe(2);
    expect(d.coverRotation).toBe(90);
    const far = buildDraft(card({ frontImageIndex: 5 }), deps, { sourceImageRefs: ['p1', 'p2'] });
    expect(far.coverPage).toBeUndefined();
    const noRot = buildDraft(card({ frontImageRotation: undefined }), deps, { sourceImageRefs: ['p1', 'p2'] });
    expect(noRot.coverRotation).toBeUndefined();
    expect(buildDraft(card({ frontImageRotation: -90 }), deps).coverRotation).toBe(270);
  });

  it('survives corrections and finalise, still labelled, with the cover image reference', () => {
    const edited = applyCorrections(d, { servings: 4 });
    expect(edited.printedNutrition).toEqual(d.printedNutrition);
    const withRef = { ...edited, coverImageRef: '/api/uploads/abc/cover.jpg' };
    let i = 0;
    const f = finaliseDraft(withRef, { newId: () => `id-${++i}` });
    expect(f.recipe.printedNutrition).toMatchObject({ source: 'recipe card', calculated: false, basis: 'per person' });
    expect(f.recipe.printedAllergens).toEqual(['A1: gluten', 'A7: milk']);
    expect(f.recipe.source).toBe('Example Meal Kit Co (Recipe bag 1234)');
    expect(f.recipe.imageRef).toBe('/api/uploads/abc/cover.jpg');
    expect(f.ingredients.find((x) => x.name === 'salt')!.pantryStaple).toBe(true);
    expect(f.ingredients[0]!.originalText).toBe('200ml vegetable stock [400ml]');
    expect(f.version.corrected.printedNutrition?.values[0]).toMatchObject({ nutrient: 'Calories', amount: 640 });
    // the version "original" is exactly what the AI said
    expect(f.version.original).toEqual(card());
  });

  it('optional: a plain recipe has none of these', () => {
    const plain = buildDraft(card({ printedNutrition: undefined, printedAllergens: undefined, sourcePublisher: undefined, sourceReference: undefined, frontImageIndex: undefined }), deps);
    expect(plain.printedNutrition).toBeUndefined();
    expect(plain.printedAllergens).toBeUndefined();
    expect(plain.source).toBeUndefined();
    expect(plain.coverPage).toBeUndefined();
  });
});

describe('multi-page merge keeps printed data', () => {
  it('takes nutrition from whichever page has it and unions allergens', () => {
    const front = card({ steps: ['Cook.'] });
    const back = card({ printedNutrition: undefined, printedAllergens: ['A7: milk', 'A11: sesame'], sourcePublisher: undefined, frontImageIndex: undefined, steps: ['Serve.'] });
    const m = mergeExtractions([back, front]);
    expect(m.printedNutrition?.basis).toBe('per person');
    expect(m.printedAllergens).toEqual(['A7: milk', 'A11: sesame', 'A1: gluten']);
    expect(m.sourcePublisher).toBe('Example Meal Kit Co');
    expect(m.frontImageIndex).toBe(2);
  });
});
