import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { aggregateRequirements, mergeRequirementSets, requirementKey, type AggregateInput, type AggregatedRequirement } from '../../src/aggregate';
import { parseIngredientLine } from '../../src/parse';
import { IngredientMatcher } from '../../src/normalise';
import type { CanonicalIngredient, Quantity, Unit } from '../../src/contract';
import {
  approx, CATALOGUE, CORIANDER_FRESH, CORIANDER_GROUND, exact, FLOUR_NO_DENSITY, FLOUR_WITH_DENSITY, GARLIC, line, MILK, ONION,
  range, SALT, toTaste, unparsed,
} from './fixtures';

function only(reqs: AggregatedRequirement[]): AggregatedRequirement {
  expect(reqs).toHaveLength(1);
  return reqs[0]!;
}

describe('BRIEF §8 required cases', () => {
  it('2 onions + 1 onion = 3 onions', () => {
    const r = only(aggregateRequirements([
      line(exact(2, undefined, '2 onions'), { ingredientId: ONION.id, recipeId: 'r1' }),
      line(exact(1, undefined, '1 onion'), { ingredientId: ONION.id, recipeId: 'r2' }),
    ], CATALOGUE));
    expect(r.quantity).toMatchObject({ kind: 'exact', value: 3 });
    expect(r.quantity.unit).toBeUndefined();
    expect(r.displayName).toBe('onion');
    expect(r.unresolved).toBeUndefined();
    expect(r.contributions.map((c) => c.recipeId).sort()).toEqual(['r1', 'r2']);
  });

  it('250ml + 500ml milk = 750ml', () => {
    const r = only(aggregateRequirements([
      line(exact(250, 'ml'), { ingredientId: MILK.id }),
      line(exact(500, 'ml'), { ingredientId: MILK.id }),
    ], CATALOGUE));
    expect(r.quantity).toMatchObject({ kind: 'exact', value: 750, unit: 'ml' });
    expect(r.unresolved).toBeUndefined();
  });

  it('200g + 200ml flour are NOT combined without density', () => {
    const r = only(aggregateRequirements([
      line(exact(200, 'g'), { ingredientId: FLOUR_NO_DENSITY.id }),
      line(exact(200, 'ml'), { ingredientId: FLOUR_NO_DENSITY.id }),
    ], [FLOUR_NO_DENSITY]));
    expect(r.quantity).toMatchObject({ kind: 'exact', value: 200, unit: 'g' });
    expect(r.unresolved).toHaveLength(1);
    expect(r.unresolved![0]).toMatchObject({ kind: 'exact', value: 200, unit: 'ml' });
    expect(r.contributions).toHaveLength(2);
    expect(r.estimate).toBe(false);
  });

  it('200g + 200ml flour ARE combined with density (0.53 g/ml -> 306 g)', () => {
    const r = only(aggregateRequirements([
      line(exact(200, 'g'), { ingredientId: FLOUR_WITH_DENSITY.id }),
      line(exact(200, 'ml'), { ingredientId: FLOUR_WITH_DENSITY.id }),
    ], [FLOUR_WITH_DENSITY]));
    expect(r.quantity).toMatchObject({ kind: 'exact', value: 306, unit: 'g' });
    expect(r.unresolved).toBeUndefined();
    expect(r.estimate).toBe(false);
  });

  it('a pinch of salt never gets a weight', () => {
    const r = only(aggregateRequirements([
      line(approx('pinch', 'a pinch of salt'), { ingredientId: SALT.id }),
      line(exact(1, 'tsp', '1 tsp salt'), { ingredientId: SALT.id }),
    ], CATALOGUE, { allowEstimatedCountToMass: true }));
    expect(r.quantity).toMatchObject({ kind: 'exact', value: 1, unit: 'tsp' });
    expect(r.unresolved).toEqual([approx('pinch', 'a pinch of salt')]);
    const alone = only(aggregateRequirements([line(approx('pinch'), { ingredientId: SALT.id })], CATALOGUE));
    expect(alone.quantity).toEqual(approx('pinch'));
    expect(alone.quantity.unit).toBeUndefined();
    expect(alone.quantity.value).toBeUndefined();
  });

  it('fresh coriander and ground coriander remain separate requirements', () => {
    const m = new IngredientMatcher(CATALOGUE);
    const inputs = ['1 bunch fresh coriander', '2 tsp ground coriander', 'a handful of coriander leaves'].map((t, i) => {
      const p = parseIngredientLine(t);
      return line(p.quantity, { ingredientId: m.match(p.name).ingredientId, recipeId: `r${i}`, name: p.name });
    });
    const reqs = aggregateRequirements(inputs, CATALOGUE);
    expect(reqs).toHaveLength(2);
    const fresh = reqs.find((r) => r.ingredientId === CORIANDER_FRESH.id)!;
    const ground = reqs.find((r) => r.ingredientId === CORIANDER_GROUND.id)!;
    expect(fresh.quantity).toMatchObject({ kind: 'exact', value: 1, unit: 'bunch' });
    expect(fresh.unresolved).toHaveLength(1);
    expect(ground.quantity).toMatchObject({ kind: 'exact', value: 2, unit: 'tsp' });
  });

  it('1 tbsp + 3 tsp = 30 ml (2 tbsp-equivalent)', () => {
    const r = only(aggregateRequirements([
      line(exact(1, 'tbsp'), { ingredientId: 'ing-oil' }),
      line(exact(3, 'tsp'), { ingredientId: 'ing-oil' }),
    ]));
    expect(r.quantity).toMatchObject({ kind: 'exact', value: 30, unit: 'ml' });
  });
});

describe('aggregation — unit handling', () => {
  it('keeps the cook\'s unit when all parts share it', () => {
    const r = only(aggregateRequirements([line(exact(1, 'tbsp'), { ingredientId: 'x' }), line(exact(2, 'tbsp'), { ingredientId: 'x' })]));
    expect(r.quantity).toMatchObject({ value: 3, unit: 'tbsp' });
  });
  it('mixed mass units sum in grams', () => {
    const r = only(aggregateRequirements([line(exact(1, 'kg'), { ingredientId: 'x' }), line(exact(250, 'g'), { ingredientId: 'x' }), line(exact(500, 'mg'), { ingredientId: 'x' })]));
    expect(r.quantity).toMatchObject({ value: 1250.5, unit: 'g' });
  });
  it('unitless and "item" counts combine as items', () => {
    const r = only(aggregateRequirements([line(exact(2), { ingredientId: ONION.id }), line(exact(1, 'item'), { ingredientId: ONION.id })], CATALOGUE));
    expect(r.quantity).toMatchObject({ value: 3, unit: 'item' });
  });
  it('different count units do not combine (cloves vs bulbs, cans vs packs)', () => {
    const r = only(aggregateRequirements([
      line(exact(3, 'clove'), { ingredientId: GARLIC.id }),
      line(exact(2, 'clove'), { ingredientId: GARLIC.id }),
      line(exact(1, 'item'), { ingredientId: GARLIC.id }),
    ], CATALOGUE, { allowEstimatedCountToMass: true }));
    expect(r.quantity).toMatchObject({ value: 5, unit: 'clove' });
    expect(r.unresolved).toEqual([expect.objectContaining({ value: 1, unit: 'item' })]);
  });
  it('density only used when needed: volume-only stays in volume', () => {
    const r = only(aggregateRequirements([line(exact(1, 'l'), { ingredientId: MILK.id }), line(exact(1, 'pint'), { ingredientId: MILK.id })], CATALOGUE));
    expect(r.quantity).toMatchObject({ value: 1568.26125, unit: 'ml' });
  });
  it('volume joins mass via density even when volume dominates by count', () => {
    const r = only(aggregateRequirements([
      line(exact(100, 'ml'), { ingredientId: MILK.id }),
      line(exact(100, 'ml'), { ingredientId: MILK.id }),
      line(exact(97, 'g'), { ingredientId: MILK.id }),
    ], CATALOGUE));
    expect(r.quantity).toMatchObject({ value: 303, unit: 'g' });
  });
  it('primary bucket = most contributions; ties prefer mass > volume > item > other counts', () => {
    const a = only(aggregateRequirements([
      line(exact(1, 'ml'), { ingredientId: 'z' }), line(exact(2, 'ml'), { ingredientId: 'z' }), line(exact(5, 'g'), { ingredientId: 'z' }),
    ]));
    expect(a.quantity).toMatchObject({ value: 3, unit: 'ml' });
    expect(a.unresolved).toEqual([expect.objectContaining({ value: 5, unit: 'g' })]);
    const b = only(aggregateRequirements([line(exact(2, 'clove'), { ingredientId: 'z' }), line(exact(1), { ingredientId: 'z' })]));
    expect(b.quantity).toMatchObject({ value: 1 });
    expect(b.unresolved).toEqual([expect.objectContaining({ unit: 'clove' })]);
    const c = only(aggregateRequirements([line(exact(2, 'clove'), { ingredientId: 'z' }), line(exact(1, 'can'), { ingredientId: 'z' })]));
    expect(c.quantity.unit).toBe('can');
  });
  it('secondary buckets are themselves summed', () => {
    const r = only(aggregateRequirements([
      line(exact(100, 'g'), { ingredientId: FLOUR_NO_DENSITY.id }),
      line(exact(100, 'g'), { ingredientId: FLOUR_NO_DENSITY.id }),
      line(exact(1, 'cup'), { ingredientId: FLOUR_NO_DENSITY.id }),
      line(exact(2, 'tbsp'), { ingredientId: FLOUR_NO_DENSITY.id }),
    ], [FLOUR_NO_DENSITY]));
    expect(r.quantity).toMatchObject({ value: 200, unit: 'g' });
    expect(r.unresolved).toEqual([expect.objectContaining({ kind: 'exact', value: 280, unit: 'ml' })]);
  });
});

describe('aggregation — count <-> mass estimates', () => {
  const inputs = (): AggregateInput[] => [line(exact(2), { ingredientId: ONION.id }), line(exact(200, 'g'), { ingredientId: ONION.id })];
  it('kept separate by default', () => {
    const r = only(aggregateRequirements(inputs(), CATALOGUE));
    expect(r.estimate).toBe(false);
    expect(r.unresolved).toHaveLength(1);
  });
  it('combined only with opt-in and unitWeightG, flagged estimate', () => {
    const r = only(aggregateRequirements(inputs(), CATALOGUE, { allowEstimatedCountToMass: true }));
    expect(r.quantity).toMatchObject({ value: 500, unit: 'g' });
    expect(r.estimate).toBe(true);
    expect(r.unresolved).toBeUndefined();
  });
  it('no unitWeightG -> never combined even with opt-in', () => {
    const noWeight: CanonicalIngredient = { ...ONION, unitWeightG: undefined };
    const r = only(aggregateRequirements(inputs(), [noWeight], { allowEstimatedCountToMass: true }));
    expect(r.estimate).toBe(false);
    expect(r.unresolved).toHaveLength(1);
  });
  it('counts alone stay counts even when a unit weight exists', () => {
    const r = only(aggregateRequirements([line(exact(2), { ingredientId: ONION.id })], CATALOGUE, { allowEstimatedCountToMass: true }));
    expect(r.quantity).toMatchObject({ value: 2 });
    expect(r.estimate).toBe(false);
  });
});

describe('aggregation — ranges, approximate, to_taste, unparsed', () => {
  it('ranges add both ends; exact adds to both', () => {
    const r = only(aggregateRequirements([
      line(range(2, 3, 'clove'), { ingredientId: GARLIC.id }),
      line(exact(1, 'clove'), { ingredientId: GARLIC.id }),
      line(range(1, 2, 'clove'), { ingredientId: GARLIC.id }),
    ], CATALOGUE));
    expect(r.quantity).toMatchObject({ kind: 'range', min: 4, max: 6, unit: 'clove' });
  });
  it('range + range with mixed units sums in base units', () => {
    const r = only(aggregateRequirements([line(range(1, 2, 'kg'), { ingredientId: 'p' }), line(range(100, 200, 'g'), { ingredientId: 'p' })]));
    expect(r.quantity).toMatchObject({ kind: 'range', min: 1100, max: 2200, unit: 'g' });
  });
  it('approximate quantities with a unit are not summed ("about 200g")', () => {
    const about: Quantity = { kind: 'approximate', approxLabel: 'about', value: 200, unit: 'g', originalText: 'about 200g' };
    const r = only(aggregateRequirements([line(about, { ingredientId: 'f' }), line(exact(100, 'g'), { ingredientId: 'f' })]));
    expect(r.quantity).toMatchObject({ kind: 'exact', value: 100 });
    expect(r.unresolved).toEqual([about]);
  });
  it('to_taste alone -> to_taste; repeated to_taste collapse', () => {
    const r = only(aggregateRequirements([line(toTaste('salt to taste'), { ingredientId: SALT.id }), line(toTaste('season to taste'), { ingredientId: SALT.id })], CATALOGUE));
    expect(r.quantity.kind).toBe('to_taste');
    expect(r.unresolved).toBeUndefined();
    expect(r.contributions).toHaveLength(2);
  });
  it('to_taste next to a numeric amount is listed as unresolved', () => {
    const r = only(aggregateRequirements([line(toTaste(), { ingredientId: SALT.id }), line(exact(1, 'tsp'), { ingredientId: SALT.id })], CATALOGUE));
    expect(r.quantity).toMatchObject({ kind: 'exact', value: 1, unit: 'tsp' });
    expect(r.unresolved).toEqual([toTaste()]);
  });
  it('approximate-only group: summary quantity, all parts unresolved', () => {
    const r = only(aggregateRequirements([line(approx('pinch', 'a pinch of salt'), { ingredientId: SALT.id }), line(approx('pinch', 'pinch salt'), { ingredientId: SALT.id })], CATALOGUE));
    expect(r.quantity).toMatchObject({ kind: 'approximate', approxLabel: 'pinch' });
    expect(r.quantity.value).toBeUndefined();
    expect(r.unresolved).toHaveLength(2);
  });
  it('approximate with mixed labels has no single label', () => {
    const r = only(aggregateRequirements([line(approx('pinch'), { ingredientId: SALT.id }), line(approx('dash'), { ingredientId: SALT.id }), line(toTaste(), { ingredientId: SALT.id })], CATALOGUE));
    expect(r.quantity.kind).toBe('approximate');
    expect(r.quantity.approxLabel).toBeUndefined();
    expect(r.unresolved).toHaveLength(3);
  });
  it('unparsed-only groups stay unparsed; a single unparsed line is passed through', () => {
    const two = only(aggregateRequirements([line(unparsed('some herbs'), { ingredientId: 'h', id: 'u1' }), line(unparsed('more herbs'), { ingredientId: 'h', id: 'u2' })]));
    expect(two.quantity).toEqual({ kind: 'unparsed', originalText: 'some herbs + more herbs' });
    expect(two.unresolved).toHaveLength(2);
    const one = only(aggregateRequirements([line(unparsed('a splodge'), { ingredientId: 'h' })]));
    expect(one.quantity).toEqual(unparsed('a splodge'));
    expect(one.unresolved).toBeUndefined();
  });
  it('malformed numeric quantities are never summed', () => {
    const bad: Quantity = { kind: 'exact', originalText: 'broken' };
    const r = only(aggregateRequirements([line(bad, { ingredientId: 'b' }), line(exact(2, 'g'), { ingredientId: 'b' })]));
    expect(r.quantity).toMatchObject({ value: 2 });
    expect(r.unresolved).toEqual([bad]);
  });
});

describe('aggregation — grouping, optional, provenance', () => {
  it('optional and required lines of the same ingredient are separate requirements', () => {
    const reqs = aggregateRequirements([
      line(exact(100, 'g'), { ingredientId: 'cheese', name: 'cheddar' }),
      line(exact(50, 'g'), { ingredientId: 'cheese', optional: true, name: 'cheddar' }),
      line(exact(25, 'g'), { ingredientId: 'cheese', optional: true, name: 'cheddar' }),
    ]);
    expect(reqs).toHaveLength(2);
    const req = reqs.find((r) => !r.optional)!;
    const opt = reqs.find((r) => r.optional)!;
    expect(req.quantity.value).toBe(100);
    expect(opt.quantity.value).toBe(75);
    expect(opt.key).toBe('id:cheese|optional');
  });
  it('unmatched lines group only by identical normalised name', () => {
    const reqs = aggregateRequirements([
      line(exact(2), { name: 'Shallots' }),
      line(exact(1), { name: 'shallot' }),
      line(exact(1), { name: 'banana shallot' }),
    ]);
    expect(reqs.map((r) => [r.displayName, r.quantity.value])).toEqual([['Shallots', 2 + 1], ['banana shallot', 1]].sort());
    expect(reqs.find((r) => r.key === 'name:shallot')!.displayName).toBe('Shallots');
  });
  it('unmatched lines without a usable name are never combined', () => {
    const reqs = aggregateRequirements([line(exact(2), { id: 'a' }), line(exact(3), { id: 'b' }), line(exact(1), { id: 'c', name: '!!!' })]);
    expect(reqs).toHaveLength(3);
    expect(reqs.map((r) => r.key).sort()).toEqual(['line:a', 'line:b', 'line:c']);
    expect(reqs.find((r) => r.key === 'line:c')!.displayName).toBe('!!!');
    expect(reqs.find((r) => r.key === 'line:a')!.displayName).toBe('2');
  });
  it('matched id not in catalogue: uses supplied name, else "Unknown ingredient"', () => {
    expect(only(aggregateRequirements([line(exact(1), { ingredientId: 'ghost', name: 'Ghost pepper' })])).displayName).toBe('Ghost pepper');
    expect(only(aggregateRequirements([line(exact(1), { ingredientId: 'ghost' })])).displayName).toBe('Unknown ingredient');
  });
  it('catalogue may be a Map', () => {
    const r = only(aggregateRequirements([line(exact(1), { ingredientId: ONION.id })], new Map([[ONION.id, ONION]])));
    expect(r.displayName).toBe('onion');
  });
  it('contributions carry recipe, planned meal, line id and the (scaled) quantity', () => {
    const r = only(aggregateRequirements([
      line(exact(2), { ingredientId: ONION.id, recipeId: 'r1', id: 'l1', plannedMealId: 'pm1', scale: 1.5 }),
      line(exact(1), { ingredientId: ONION.id, recipeId: 'r2', id: 'l2' }),
    ], CATALOGUE));
    expect(r.contributions).toEqual([
      { recipeId: 'r1', recipeIngredientId: 'l1', plannedMealId: 'pm1', quantity: { kind: 'exact', value: 3, originalText: '2' } },
      { recipeId: 'r2', recipeIngredientId: 'l2', quantity: { kind: 'exact', value: 1, originalText: '1' } },
    ]);
    expect(r.quantity.value).toBe(4);
  });
  it('scale factor of 1 passes quantity through by reference', () => {
    const q = exact(5, 'g');
    expect(only(aggregateRequirements([line(q, { ingredientId: 'a', scale: 1 })])).contributions[0]!.quantity).toBe(q);
  });
  it('to_taste is not scaled', () => {
    const r = only(aggregateRequirements([line(toTaste(), { ingredientId: SALT.id, scale: 4 })], CATALOGUE));
    expect(r.quantity).toEqual(toTaste());
  });
  it('output sorted by displayName then key; empty input -> empty output', () => {
    const reqs = aggregateRequirements([line(exact(1), { ingredientId: MILK.id }), line(exact(1), { ingredientId: ONION.id }), line(exact(1), { ingredientId: GARLIC.id })], CATALOGUE);
    expect(reqs.map((r) => r.displayName)).toEqual(['garlic', 'milk', 'onion']);
    expect(aggregateRequirements([])).toEqual([]);
  });
  it('requirementKey', () => {
    expect(requirementKey(line(exact(1), { ingredientId: 'i' }))).toBe('id:i');
    expect(requirementKey(line(exact(1), { name: 'Red Onions' }))).toBe('name:red onion');
    expect(requirementKey(line(exact(1), { id: 'L', optional: true }))).toBe('line:L|optional');
  });
});

describe('end-to-end: parse -> match -> scale -> aggregate', () => {
  it('builds a shopping list from three recipes', () => {
    const m = new IngredientMatcher([...CATALOGUE.filter((c) => c.id !== FLOUR_NO_DENSITY.id), FLOUR_WITH_DENSITY]);
    const cat = [...CATALOGUE.filter((c) => c.id !== FLOUR_NO_DENSITY.id), FLOUR_WITH_DENSITY];
    const recipes: Array<{ id: string; servings: number; lines: string[] }> = [
      { id: 'curry', servings: 4, lines: ['2 onions, chopped', '3 garlic cloves', '1 tbsp ground coriander', 'fresh coriander, to serve', 'salt to taste'] },
      { id: 'soup', servings: 2, lines: ['1 large onion', '500ml milk', 'a pinch of salt', '100g plain flour'] },
      { id: 'cake', servings: 8, lines: ['200ml flour', '250ml milk', '1 tsp ground coriander (optional)'] },
    ];
    const inputs: AggregateInput[] = [];
    for (const rec of recipes) {
      rec.lines.forEach((text, i) => {
        const p = parseIngredientLine(text);
        const match = m.match(p.name);
        inputs.push(line(p.quantity, {
          ingredientId: match.ingredientId, recipeId: rec.id, id: `${rec.id}-${i}`, name: p.name, optional: p.optional, scale: 4 / rec.servings,
        }));
      });
    }
    const reqs = aggregateRequirements(inputs, cat);
    const byName = Object.fromEntries(reqs.map((r) => [`${r.displayName}${r.optional ? '?' : ''}`, r]));
    expect(byName.onion!.quantity).toMatchObject({ kind: 'exact', value: 4 }); // 2 + 1*2
    expect(byName.milk!.quantity).toMatchObject({ value: 1125, unit: 'ml' }); // 500*2 + 250*0.5
    expect(byName['plain flour']!.quantity).toMatchObject({ value: 253, unit: 'g' }); // 100*2 + 200*0.5*0.53
    expect(byName['ground coriander']!.quantity).toMatchObject({ value: 1, unit: 'tbsp' });
    expect(byName['ground coriander?']!.quantity).toMatchObject({ value: 0.5, unit: 'tsp' });
    expect(byName.coriander!.quantity.kind).toBe('unparsed');
    expect(byName.salt!.quantity).toMatchObject({ kind: 'approximate', approxLabel: 'pinch' });
    expect(byName.garlic!.quantity).toMatchObject({ value: 3, unit: 'clove' });
    // provenance: every input line appears exactly once
    const ids = reqs.flatMap((r) => r.contributions.map((c) => c.recipeIngredientId)).sort();
    expect(ids).toEqual(inputs.map((i) => i.line.id).sort());
  });
});

// ---------------------------------------------------------------------------------------------
// Property-based checks: order independence, associativity, provenance completeness.

const ING_IDS = ['ing-onion', 'ing-milk', 'ing-flour', 'ing-salt', 'ing-garlic', undefined] as const;
const UNITS: Array<Unit | undefined> = [undefined, 'g', 'kg', 'mg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'item', 'clove', 'can'];
const PROP_CATALOGUE: CanonicalIngredient[] = [ONION, MILK, FLOUR_WITH_DENSITY, SALT, GARLIC];

const quantityArb: fc.Arbitrary<Quantity> = fc.oneof(
  { weight: 5, arbitrary: fc.record({ v: fc.integer({ min: 0, max: 5000 }), u: fc.constantFrom(...UNITS) }).map(({ v, u }) => exact(v / 4, u)) },
  { weight: 2, arbitrary: fc.record({ a: fc.integer({ min: 0, max: 100 }), d: fc.integer({ min: 1, max: 100 }), u: fc.constantFrom(...UNITS) }).map(({ a, d, u }) => range(a, a + d, u)) },
  { weight: 1, arbitrary: fc.constantFrom(approx('pinch'), approx('handful'), toTaste(), unparsed('??'), { kind: 'approximate', approxLabel: 'about', value: 200, unit: 'g', originalText: 'about 200g' } as Quantity) },
);

let uid = 0;
const inputArb: fc.Arbitrary<AggregateInput> = fc.record({
  q: quantityArb,
  ing: fc.constantFrom(...ING_IDS),
  name: fc.constantFrom('shallot', 'Shallots', 'leek', undefined),
  optional: fc.boolean(),
  recipe: fc.constantFrom('r1', 'r2', 'r3'),
  meal: fc.constantFrom('m1', 'm2', undefined),
  scale: fc.constantFrom(undefined, 0.5, 1, 2, 3),
}).map((r) => {
  uid += 1;
  return line(r.q, { ingredientId: r.ing, name: r.name, optional: r.optional, recipeId: r.recipe, plannedMealId: r.meal, scale: r.scale, id: `p${uid}` });
});

const optsArb = fc.record({ allowEstimatedCountToMass: fc.boolean() });

describe('aggregation properties', () => {
  it('is order independent (commutative)', () => {
    fc.assert(fc.property(fc.array(inputArb, { maxLength: 25 }), optsArb, fc.integer(), (inputs, opts, seed) => {
      const shuffled = [...inputs].sort((a, b) => ((a.line.id.length * 31 + seed) % 7) - ((b.line.id.length * 17 + seed) % 5));
      expect(aggregateRequirements(shuffled, PROP_CATALOGUE, opts)).toEqual(aggregateRequirements(inputs, PROP_CATALOGUE, opts));
      expect(aggregateRequirements([...inputs].reverse(), PROP_CATALOGUE, opts)).toEqual(aggregateRequirements(inputs, PROP_CATALOGUE, opts));
    }), { numRuns: 300 });
  });

  it('merge(agg(A), agg(B)) == agg(A ++ B)', () => {
    fc.assert(fc.property(fc.array(inputArb, { maxLength: 15 }), fc.array(inputArb, { maxLength: 15 }), optsArb, (a, b, opts) => {
      const merged = mergeRequirementSets(aggregateRequirements(a, PROP_CATALOGUE, opts), aggregateRequirements(b, PROP_CATALOGUE, opts), PROP_CATALOGUE, opts);
      expect(merged).toEqual(aggregateRequirements([...a, ...b], PROP_CATALOGUE, opts));
    }), { numRuns: 300 });
  });

  it('merge is associative and commutative', () => {
    fc.assert(fc.property(fc.array(inputArb, { maxLength: 10 }), fc.array(inputArb, { maxLength: 10 }), fc.array(inputArb, { maxLength: 10 }), optsArb, (a, b, c, opts) => {
      const [A, B, C] = [a, b, c].map((x) => aggregateRequirements(x, PROP_CATALOGUE, opts)) as [AggregatedRequirement[], AggregatedRequirement[], AggregatedRequirement[]];
      const left = mergeRequirementSets(mergeRequirementSets(A, B, PROP_CATALOGUE, opts), C, PROP_CATALOGUE, opts);
      const right = mergeRequirementSets(A, mergeRequirementSets(B, C, PROP_CATALOGUE, opts), PROP_CATALOGUE, opts);
      expect(left).toEqual(right);
      expect(mergeRequirementSets(A, B, PROP_CATALOGUE, opts)).toEqual(mergeRequirementSets(B, A, PROP_CATALOGUE, opts));
    }), { numRuns: 200 });
  });

  it('every input line appears exactly once in contributions', () => {
    fc.assert(fc.property(fc.array(inputArb, { maxLength: 30 }), optsArb, (inputs, opts) => {
      const reqs = aggregateRequirements(inputs, PROP_CATALOGUE, opts);
      const ids = reqs.flatMap((r) => r.contributions.map((c) => c.recipeIngredientId)).sort();
      expect(ids).toEqual(inputs.map((i) => i.line.id).sort());
    }), { numRuns: 300 });
  });

  it('nothing is lost: summed parts + unresolved parts cover every contribution', () => {
    fc.assert(fc.property(fc.array(inputArb, { maxLength: 30 }), optsArb, (inputs, opts) => {
      for (const r of aggregateRequirements(inputs, PROP_CATALOGUE, opts)) {
        const nonNumericContribs = r.contributions.filter((c) => c.quantity.kind !== 'exact' && c.quantity.kind !== 'range' && c.quantity.kind !== 'to_taste').length;
        const unresolvedNonNumeric = (r.unresolved ?? []).filter((q) => q.kind === 'approximate' || q.kind === 'unparsed').length;
        if (r.contributions.length > 1) expect(unresolvedNonNumeric).toBe(nonNumericContribs);
        // approximate / to_taste / unparsed are never converted into a weight
        for (const q of r.unresolved ?? []) if (q.kind !== 'exact' && q.kind !== 'range') expect(r.contributions.some((c) => c.quantity === q)).toBe(true);
      }
    }), { numRuns: 300 });
  });

  it('total in grams for a single-unit mass group equals the sum of scaled parts', () => {
    fc.assert(fc.property(fc.array(fc.integer({ min: 0, max: 10000 }), { minLength: 1, maxLength: 20 }), (vals) => {
      const r = only(aggregateRequirements(vals.map((v) => line(exact(v, 'g'), { ingredientId: 'm' }))));
      expect(r.quantity.value).toBe(vals.reduce((s, v) => s + v, 0));
    }));
  });

  it('estimate flag only when opted in', () => {
    fc.assert(fc.property(fc.array(inputArb, { maxLength: 20 }), (inputs) => {
      for (const r of aggregateRequirements(inputs, PROP_CATALOGUE, { allowEstimatedCountToMass: false })) expect(r.estimate).toBe(false);
    }), { numRuns: 200 });
  });
});
