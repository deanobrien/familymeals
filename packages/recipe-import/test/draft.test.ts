import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/recipe-extraction.json';
import {
  RecipeExtractionSchema, applyCorrections, buildDraft, finaliseDraft, DraftNotReadyError, findDuplicates, mergeExtractions,
  type RecipeExtraction,
} from '../src/index.js';
import { testMatcher, testParser } from './helpers.js';

const deps = { parser: testParser, matcher: testMatcher, now: () => new Date('2026-10-19T10:00:00Z') };
const base = () => RecipeExtractionSchema.parse(fixture);
let n = 0;
const newId = () => `uuid-${++n}`;

describe('buildDraft with L4 fixture', () => {
  it('builds a clean draft: originalText kept, no blocking issues, title proposed', () => {
    const d = buildDraft(base(), deps, { sourceImageRefs: ['img/1.jpg'] });
    expect(d.ingredients).toHaveLength(6);
    expect(d.ingredients.map((i) => i.originalText)).toEqual(base().ingredients.map((i) => i.originalText));
    expect(d.titleProposed).toBe(true);
    expect(d.title.warnings[0]).toMatch(/proposed/);
    expect(d.issues.filter((i) => i.blocking)).toEqual([]);
    expect(d.ingredients[0]!.ingredientId.value).toBe('id-lentils');
    expect(d.extractedAt).toBe('2026-10-19T10:00:00.000Z');
  });

  it('pinch and to-taste are kept as approximate/to_taste and are not blocking', () => {
    const d = buildDraft(base(), deps);
    const salt = d.ingredients.find((i) => i.name.value === 'salt')!;
    const lemon = d.ingredients.find((i) => i.name.value === 'lemon juice')!;
    expect(salt.quantity.value.kind).toBe('approximate');
    expect(salt.quantity.value.value).toBeUndefined();
    expect(lemon.quantity.value.kind).toBe('to_taste');
    expect(lemon.optional).toBe(true);
    expect(d.issues.some((i) => i.code === 'ingredient_unparsed_quantity')).toBe(false);
  });

  it('user title wins; AI title kept as alternative', () => {
    const d = buildDraft(base(), deps, { userTitle: 'Granny soup' });
    expect(d.title.value).toBe('Granny soup');
    expect(d.title.alternative).toBe("Nana's Lentil Soup");
    expect(d.titleProposed).toBe(false);
  });

  it('AI vs parser quantity disagreement warns and never overwrites', () => {
    const e = base();
    e.ingredients[0]!.quantity = { kind: 'exact', value: 250, unit: 'g', originalText: '250g' }; // text says 200g
    const d = buildDraft(e, deps);
    const q = d.ingredients[0]!.quantity;
    expect(q.value.value).toBe(250);
    expect(q.alternative?.value).toBe(200);
    expect(q.status).toBe('needs_clarification');
    expect(q.warnings[0]).toMatch(/differs/);
    expect(d.issues.some((i) => i.code === 'parse_disagreement')).toBe(true);
  });

  it('unit disagreement (ml vs g) is flagged', () => {
    const e = base();
    e.ingredients[0]!.quantity = { kind: 'exact', value: 200, unit: 'ml', originalText: '200ml' };
    expect(buildDraft(e, deps).ingredients[0]!.quantity.status).toBe('needs_clarification');
  });

  it('unparsable line is kept, flagged unparsed, and blocks finalise until fixed', () => {
    const e = base();
    e.ingredients.push({
      originalText: 'some o1d smudge ~~', name: 'smudge', optional: false, confidence: 0.2,
      quantity: { kind: 'unparsed', originalText: 'some o1d smudge ~~' },
    });
    const d = buildDraft(e, deps);
    const line = d.ingredients[6]!;
    expect(line.originalText).toBe('some o1d smudge ~~');
    expect(line.quantity.status).toBe('unparsed');
    expect(line.affectsCost).toBe(true);
    expect(d.issues.find((i) => i.code === 'ingredient_unparsed_quantity')?.blocking).toBe(true);
    expect(() => finaliseDraft(d, { newId })).toThrow(DraftNotReadyError);

    const fixed = applyCorrections(d, { ingredients: [{ key: line.key, set: { quantity: { kind: 'exact', value: 1, unit: 'item', originalText: '1' } } }] });
    expect(fixed.issues.filter((i) => i.blocking)).toEqual([]);
    expect(fixed.ingredients[6]!.quantity.status).toBe('ok');
    expect(() => finaliseDraft(fixed, { newId })).not.toThrow();
  });

  it('optional unparsed line is not blocking', () => {
    const e = base();
    e.ingredients.push({ originalText: '??', name: 'mystery', optional: true, confidence: 0.2, quantity: { kind: 'unparsed', originalText: '??' } });
    expect(buildDraft(e, deps).issues.some((i) => i.blocking)).toBe(false);
  });

  it('low confidence and unmatched ingredient surface as statuses/issues', () => {
    const e = base();
    e.ingredients[1]!.confidence = 0.4;
    e.ingredients.push({ originalText: '3 g saffron', name: 'saffron', optional: false, confidence: 0.9, quantity: { kind: 'exact', value: 3, unit: 'g', originalText: '3 g' } });
    const d = buildDraft(e, deps);
    expect(d.ingredients[1]!.quantity.status).toBe('low_confidence');
    const s = d.ingredients[6]!;
    expect(s.ingredientId.value).toBeUndefined();
    expect(s.matchAlternatives).toHaveLength(1);
    expect(d.issues.some((i) => i.code === 'unmatched_ingredient' && i.ingredientKey === s.key)).toBe(true);
  });

  it('parser throwing does not break the draft', () => {
    const d = buildDraft(base(), { ...deps, parser: { parse: () => { throw new Error('x'); } } });
    expect(d.ingredients[0]!.quantity.warnings[0]).toMatch(/parser failed/);
    expect(d.ingredients[0]!.quantity.value.value).toBe(200);
  });

  it('missing servings is a non-blocking issue', () => {
    const e = base(); delete e.servings;
    const d = buildDraft(e, deps);
    expect(d.servings.status).toBe('needs_clarification');
    expect(d.issues.find((i) => i.code === 'missing_servings')?.blocking).toBe(false);
  });
});

describe('multi-page merge', () => {
  const page2 = (): RecipeExtraction => ({
    title: "Nana's Lentil Soup (p2)", tags: ['soup', 'Budget'], warnings: [], confidence: { steps: 0.6 },
    ingredients: [
      { originalText: '1 onion, finely chopped', name: 'onion', optional: false, confidence: 0.9, quantity: { kind: 'exact', value: 1, unit: 'item', originalText: '1' } },
      { originalText: '1 tsp cumin', name: 'cumin', optional: false, confidence: 0.9, quantity: { kind: 'exact', value: 1, unit: 'tsp', originalText: '1 tsp' } },
    ],
    steps: ['Blend if desired and season.', 'Serve with bread.'],
  });

  it('dedupes across pages, preserves order, unions tags, min confidence', () => {
    const m = mergeExtractions([base(), page2()]);
    expect(m.ingredients.map((i) => i.name)).toEqual(['red lentils', 'onion', 'garlic', 'vegetable stock', 'salt', 'lemon juice', 'cumin']);
    expect(m.steps).toEqual([...base().steps, 'Serve with bread.']);
    expect(m.tags).toEqual(['soup', 'vegan', 'budget']);
    expect(m.confidence.steps).toBe(0.6);
    expect(m.servings).toBe(4);
    expect(m.warnings.some((w) => /different title/.test(w))).toBe(true);
  });

  it('buildDraft accepts pages; original stores all pages', () => {
    const d = buildDraft([base(), page2()], deps);
    expect(d.ingredients).toHaveLength(7);
    expect('pages' in d.original && d.original.pages).toHaveLength(2);
    expect(d.steps.map((s) => s.key)).toEqual(['step-1', 'step-2', 'step-3', 'step-4']);
  });
});

describe('corrections + finalise', () => {
  it('applies edits immutably, marks edited, recomputes issues, finalises payloads', () => {
    const d0 = buildDraft(base(), deps, { sourceImageRefs: ['a.jpg', 'b.jpg'], source: 'Family recipe card' });
    const snapshot = JSON.stringify(d0);
    const d1 = applyCorrections(d0, {
      title: 'Nana Lentil Soup', servings: 6, tags: ['soup'],
      ingredients: [
        { key: 'ing-1', set: { quantity: { kind: 'exact', value: 300, unit: 'g', originalText: '300g' } } },
        { key: 'ing-6', remove: true },
        { key: 'ing-3', set: { ingredientId: null } },
      ],
      addIngredients: [{ originalText: '1 tsp cumin', name: 'cumin', quantity: { kind: 'exact', value: 1, unit: 'tsp', originalText: '1 tsp' } }],
      steps: ['Soften the onion and garlic in a little oil.', 'Simmer everything 30 minutes.'],
    });
    expect(JSON.stringify(d0)).toBe(snapshot);
    expect(d1.title.edited).toBe(true);
    expect(d1.titleProposed).toBe(false);
    expect(d1.ingredients.map((i) => i.key)).toEqual(['ing-1', 'ing-2', 'ing-3', 'ing-4', 'ing-5', 'ing-7']);
    expect(d1.steps[0]!.key).toBe('step-1');
    expect(d1.steps[1]!.edited).toBe(true);

    n = 0;
    const f = finaliseDraft(d1, { newId });
    expect(f.recipe).toMatchObject({ id: 'uuid-1', title: 'Nana Lentil Soup', servings: 6, source: 'Family recipe card' });
    expect(f.ingredients[0]).toMatchObject({ recipeId: 'uuid-1', quantityKind: 'exact', quantityValue: 300, unit: 'g', originalText: '200g red lentils', order: 0 });
    const salt = f.ingredients.find((i) => i.name === 'salt')!;
    expect(salt).toMatchObject({ quantityKind: 'approximate', approxLabel: 'pinch' });
    expect(salt.quantityValue).toBeUndefined();
    expect(f.ingredients.find((i) => i.name === 'garlic')!.ingredientId).toBeUndefined();
    expect(f.steps.map((s) => s.order)).toEqual([0, 1]);
    expect(f.version.original).toEqual(base());
    expect(f.version.corrected.title).toBe('Nana Lentil Soup');
    expect(f.version.corrected.ingredients[0]!.quantity.value).toBe(300);
    expect(f.version.sourceImageRefs).toEqual(['a.jpg', 'b.jpg']);
    expect(f.version.extractedAt).toBe('2026-10-19T10:00:00.000Z');
  });

  it('rejects invalid edits', () => {
    const d = buildDraft(base(), deps);
    expect(() => applyCorrections(d, { ingredients: [{ key: 'nope', remove: true }] })).toThrow(/unknown/);
    expect(() => applyCorrections(d, { servings: 0 })).toThrow();
    expect(() => applyCorrections(d, { ingredients: [{ key: 'ing-1', set: { quantity: { kind: 'range', min: 5, max: 1, originalText: 'x' } } }] })).toThrow(/invalid quantity/);
  });

  it('reordering ingredients', () => {
    const d = applyCorrections(buildDraft(base(), deps), { ingredientOrder: ['ing-3', 'ing-1'] });
    expect(d.ingredients.slice(0, 3).map((i) => i.key)).toEqual(['ing-3', 'ing-1', 'ing-2']);
  });

  it('missing title blocks finalise', () => {
    const d = applyCorrections(buildDraft(base(), deps), { title: '  ' });
    expect(d.issues.some((i) => i.code === 'missing_title' && i.blocking)).toBe(true);
    expect(() => finaliseDraft(d)).toThrow(DraftNotReadyError);
  });
});

describe('findDuplicates', () => {
  const existing = [
    { id: 'r1', title: "Nana's lentil soup!", ingredientNames: ['Red Lentils', 'Onion', 'Garlic', 'Vegetable stock', 'Salt', 'Lemon juice'] },
    { id: 'r2', title: 'Lentil Soup', ingredientNames: ['red lentils', 'onion', 'carrot', 'cumin', 'stock'] },
    { id: 'r3', title: 'Chocolate cake', ingredientNames: ['flour', 'cocoa', 'sugar', 'eggs'] },
  ];
  const cand = { title: 'Nanas Lentil Soup', ingredientNames: ['red lentils', 'onion', 'garlic', 'vegetable stock', 'salt', 'lemon juice'] };

  it('flags near-identical, ignores unrelated, best first', () => {
    const m = findDuplicates(cand, existing);
    expect(m.map((x) => x.recipeId)).toEqual(['r1']);
    expect(m[0]!.ingredientSimilarity).toBe(1);
  });
  it('exact normalised title with overlapping ingredients is flagged', () => {
    const m = findDuplicates({ title: 'lentil soup', ingredientNames: ['red lentils', 'onion', 'carrot'] }, existing);
    expect(m.map((x) => x.recipeId)).toContain('r2');
  });
  it('prefers ingredientIds when both sides have them', () => {
    const m = findDuplicates({ title: 'x', ingredientIds: ['a', 'b'] }, [{ id: 'z', title: 'y', ingredientIds: ['a', 'b'] }]);
    expect(m[0]!.ingredientSimilarity).toBe(1);
  });
  it('empty ingredient sets never match on ingredients alone', () => {
    expect(findDuplicates({ title: 'a' }, [{ id: 'z', title: 'b' }])).toEqual([]);
  });
});
