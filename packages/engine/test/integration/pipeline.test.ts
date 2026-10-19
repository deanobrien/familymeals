/**
 * End-to-end engine pipeline over real refdata:
 * parse -> match (refdata ingredients) -> scale -> aggregate -> cost (refdata prices) -> nutrition (refdata CoFID).
 */
import { describe, expect, it } from 'vitest';
import { loadCofid, loadSeed } from '@fr/refdata';
import type { CanonicalIngredient, PriceObservation, Quantity, RecipeIngredientLine } from '../../src/contract';
import { parseIngredientLine } from '../../src/parse';
import { IngredientMatcher } from '../../src/normalise';
import { scaleToServings } from '../../src/scale';
import { aggregateRequirements } from '../../src/aggregate';
import { createGramsConverter, createQuantityConverter, convertQuantity } from '../../src/units';
import { costRecipe } from '../../src/cost';
import { calculateRecipeNutrition, type NutrientProfile, type NutritionLine } from '../../src/nutrition';

const seed = loadSeed();
const cofid = loadCofid();
const catalogue = seed.ingredients as unknown as CanonicalIngredient[];
const byId = new Map(catalogue.map((i) => [i.id, i]));
const lookup = (id: string) => byId.get(id);
const matcher = new IngredientMatcher(catalogue);
const foodByCode = new Map(cofid.foods.map((f) => [f.code, f]));
const seedById = new Map(seed.ingredients.map((i) => [i.id, i]));
const prices = seed.prices.map(
  (p): PriceObservation => ({
    ingredientId: p.ingredientId,
    pricePence: p.pricePence,
    packQuantity: p.packQuantity as Quantity,
    kind: p.kind,
    observedOn: p.observedOn,
    source: p.source,
  }),
);

function profileFor(ingredientId: string | undefined): NutrientProfile | undefined {
  const code = ingredientId ? seedById.get(ingredientId)?.cofid?.code : undefined;
  const food = code ? foodByCode.get(code) : undefined;
  if (!food) return undefined;
  const per100g: NutrientProfile['per100g'] = {};
  for (const n of food.nutrients) {
    per100g[n.nutrient] = {
      status: n.status,
      ...(n.value !== undefined ? { value: n.value } : {}),
      estimate: n.estimate,
      source: cofid.source.name,
    };
  }
  return { per100g, source: cofid.source.name };
}

interface Built {
  lines: RecipeIngredientLine[];
  names: string[];
}

function build(recipeId: string, texts: string[], from: number, to: number): Built {
  const lines: RecipeIngredientLine[] = [];
  const names: string[] = [];
  texts.forEach((text, order) => {
    const p = parseIngredientLine(text);
    const m = matcher.match(p.name);
    lines.push({
      id: `${recipeId}-l${order}`,
      recipeId,
      ...(m.status === 'matched' && m.ingredientId ? { ingredientId: m.ingredientId } : {}),
      quantity: scaleToServings(p.quantity, from, to),
      optional: p.optional,
      order,
    });
    names.push(p.name);
  });
  return { lines, names };
}

const quantityConv = createQuantityConverter(lookup);
const gramsConv = createGramsConverter(lookup);
const fixedNow = () => new Date('2026-10-19T12:00:00Z');

const BOLOGNESE = [
  '200g spaghetti',
  '400g tin chopped tomatoes',
  '1 large onion, finely chopped',
  '2 cloves garlic',
  '2 tbsp olive oil',
  '1 tsp fairy dust',
  'salt and pepper to taste',
];
const PANCAKES = ['100g plain flour', '300ml milk', '2 eggs', 'a pinch of nutmeg'];
const CURRY = ['2-3 carrots', '250g basmati rice', '1 can chickpeas'];

function nutritionLines(b: Built): NutritionLine[] {
  return b.lines.map((l, i) => {
    const profile = profileFor(l.ingredientId);
    return {
      id: l.id,
      name: b.names[i]!,
      ...(l.ingredientId ? { ingredientId: l.ingredientId } : {}),
      quantity: l.quantity,
      optional: l.optional,
      ...(profile ? { profile } : {}),
    };
  });
}

describe('engine pipeline (refdata)', () => {
  const bolognese = build('r1', BOLOGNESE, 2, 4);
  const pancakes = build('r2', PANCAKES, 4, 4);
  const curry = build('r3', CURRY, 4, 6);

  it('matches known lines and leaves unknown ones unmatched (never guessed)', () => {
    expect(bolognese.lines.map((l) => l.ingredientId !== undefined)).toEqual([true, true, true, true, true, false, false]);
    expect(pancakes.lines.every((l) => l.ingredientId)).toBe(true);
    expect(curry.lines.every((l) => l.ingredientId)).toBe(true);
  });

  it('scales exact quantities and preserves non-numeric kinds', () => {
    expect(bolognese.lines[0]!.quantity).toMatchObject({ kind: 'exact', value: 400, unit: 'g' });
    expect(bolognese.lines[6]!.quantity.kind).toBe('to_taste');
    expect(pancakes.lines[3]!.quantity.kind).toBe('approximate');
    expect(curry.lines[0]!.quantity).toMatchObject({ kind: 'range', min: 3, max: 4.5 });
  });

  it('aggregates across recipes, keeping unknowns separate and provenance intact', () => {
    const inputs = [...bolognese.lines, ...pancakes.lines, ...curry.lines].map((line) => ({ line }));
    const reqs = aggregateRequirements(inputs, catalogue);
    expect(reqs.length).toBeGreaterThanOrEqual(12);
    expect(reqs.some((r) => r.ingredientId === undefined)).toBe(true);
    expect(reqs.flatMap((r) => r.contributions)).toHaveLength(inputs.length);
  });

  describe('cost', () => {
    const cost = costRecipe({ lines: bolognese.lines, servings: 4, prices, converter: quantityConv, ingredients: lookup });

    it('is partial, non-zero, flags estimates and never prices unmatched / to-taste lines at 0', () => {
      expect(cost.totalPence).not.toBeNull();
      expect(cost.totalPence!).toBeGreaterThan(0);
      expect(cost.isPartial).toBe(true);
      expect(cost.includesEstimates).toBe(true);
      const reasons = Object.fromEntries(cost.uncosted.map((u) => [u.lineId, u.reason]));
      expect(reasons['r1-l5']).toBe('unmatched_ingredient');
      expect(reasons['r1-l6']).toBe('unmatched_ingredient'); // salt & pepper: no refdata match, so never costed
      expect(cost.lines.filter((l) => l.status === 'costed').every((l) => (l.costPence ?? -1) > 0)).toBe(true);
    });

    it('costs a range at its max', () => {
      const c = costRecipe({ lines: curry.lines, servings: 6, prices, converter: quantityConv, ingredients: lookup });
      const carrot = c.lines[0]!;
      expect(carrot.status).toBe('costed');
      expect(carrot.basis).toBe('range_max');
      const unit = curry.lines[0]!.quantity.unit;
      const exactMax = costRecipe({
        lines: [{ ...curry.lines[0]!, quantity: { kind: 'exact', value: 4.5, ...(unit ? { unit } : {}), originalText: 'x' } }],
        servings: 6,
        prices,
        converter: quantityConv,
        ingredients: lookup,
      });
      expect(carrot.costPence).toBe(exactMax.lines[0]!.costPence);
    });

    it('scales cost with servings', () => {
      const big = build('r1', BOLOGNESE, 2, 6);
      const small = build('r1', BOLOGNESE, 2, 4);
      const cBig = costRecipe({ lines: big.lines, servings: 6, prices, converter: quantityConv, ingredients: lookup });
      const cSmall = costRecipe({ lines: small.lines, servings: 4, prices, converter: quantityConv, ingredients: lookup });
      expect(cBig.totalPence!).toBeGreaterThan(cSmall.totalPence!);
      expect(cBig.totalPence! / cSmall.totalPence!).toBeCloseTo(1.5, 0);
    });
  });

  describe('nutrition', () => {
    it('withholds totals (unknown, not 0) when a line has no profile, and reports the missing lines', () => {
      const n = calculateRecipeNutrition(nutritionLines(bolognese), 4, gramsConv, { now: fixedNow });
      expect(n.missingIngredients.map((m) => m.id)).toEqual(expect.arrayContaining(['r1-l5', 'r1-l6']));
      expect(n.totals.energy_kcal.status).toBe('unknown');
      expect(n.totals.energy_kcal.value).toBeUndefined();
      expect(n.totals.energy_kcal.incomplete).toBe(true);
      expect(n.totals.energy_kcal.lowerBound).toBeGreaterThan(0);
      expect(n.ingredientCoveragePct).toBeLessThan(100);
      expect(n.perServing.energy_kcal.status).toBe('unknown');
    });

    it('computes known totals and flags unit-weight conversions as estimates', () => {
      const fully = build('r1', ['200g spaghetti', '1 large onion, finely chopped', '2 tbsp olive oil'], 2, 4);
      const n = calculateRecipeNutrition(nutritionLines(fully), 4, gramsConv, { now: fixedNow });
      expect(n.missingIngredients).toEqual([]);
      expect(n.totals.energy_kcal.status).toBe('known');
      expect(n.totals.energy_kcal.value!).toBeGreaterThan(500);
      expect(n.totals.energy_kcal.estimate).toBe(true);
      expect(n.perServing.energy_kcal.value!).toBeCloseTo(n.totals.energy_kcal.value! / 4, 6);
    });

    it('uses the midpoint for a range and flags it estimate', () => {
      const carrotLine = curry.lines[0]!;
      const unit = carrotLine.quantity.unit;
      const mid: Quantity = { kind: 'exact', value: (3 + 4.5) / 2, ...(unit ? { unit } : {}), originalText: 'mid' };
      const run = (q: Quantity) =>
        calculateRecipeNutrition(
          nutritionLines({ lines: [{ ...carrotLine, quantity: q }], names: ['carrot'] }),
          6,
          gramsConv,
          { now: fixedNow },
        );
      const r = run(carrotLine.quantity);
      const e = run(mid);
      expect(r.totals.energy_kcal.value).toBeCloseTo(e.totals.energy_kcal.value!, 6);
      expect(r.totals.energy_kcal.estimate).toBe(true);
    });

    it('pancakes: a pinch of nutmeg is not silently zero', () => {
      const n = calculateRecipeNutrition(nutritionLines(pancakes), 4, gramsConv, { now: fixedNow });
      expect(n.missingIngredients.some((m) => m.id === 'r2-l3')).toBe(true);
      expect(n.totals.energy_kcal.status).toBe('unknown');
      expect(n.totals.energy_kcal.lowerBound!).toBeGreaterThan(300);
    });
  });

  it('uses the single pint constant (568.26125 ml) end to end', () => {
    const r = convertQuantity({ kind: 'exact', value: 1, unit: 'pint', originalText: '1 pint' }, 'ml');
    expect(r.ok && r.quantity.value).toBeCloseTo(568.26125, 8);
    expect(
      quantityConv.convert({ kind: 'exact', value: 2, unit: 'pint', originalText: '' }, 'ml')?.value,
    ).toBeCloseTo(1136.5225, 6);
  });
});
