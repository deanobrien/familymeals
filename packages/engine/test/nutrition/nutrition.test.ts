import { describe, expect, it } from 'vitest';
import type { Quantity } from '../../src/contract';
import {
  calculateRecipeNutrition, normaliseProfile, summariseWeek, withServings, NUTRITION_DISCLAIMER,
  type NutritionLine, type NutrientProfile, type UnitConverter, type PlannedMealNutrition,
} from '../../src/nutrition';

const NOW = () => new Date('2026-10-19T12:00:00Z');

/** Test double: mass units convert directly; 'item' uses a per-ingredient map; everything else unconvertible. */
const unitWeights: Record<string, number> = { onion: 150 };
const conv: UnitConverter = {
  toGrams(id, q) {
    if (q.value === undefined) return null;
    if (q.unit === 'g') return { grams: q.value, estimate: false };
    if (q.unit === 'kg') return { grams: q.value * 1000, estimate: false };
    if (q.unit === 'mg') return { grams: q.value / 1000, estimate: false };
    if (q.unit === 'item' && id && unitWeights[id]) return { grams: q.value * unitWeights[id]!, estimate: true };
    return null;
  },
};

const g = (value: number): Quantity => ({ kind: 'exact', value, unit: 'g', originalText: `${value}g` });
const line = (id: string, quantity: Quantity, profile?: NutrientProfile, extra: Partial<NutritionLine> = {}): NutritionLine =>
  ({ id, name: id, ingredientId: id, quantity, optional: false, profile, ...extra });

const full = (v: Record<string, number>, source = 'CoFID'): NutrientProfile => ({
  source,
  per100g: Object.fromEntries(Object.entries(v).map(([k, value]) => [k, { status: value === 0 ? 'zero' : 'known', value }])),
});

const rice = full({ energy_kcal: 350, protein: 7, carbohydrate: 78, sugars: 0, fat: 1, saturates: 0.3, fibre: 1.3, sodium: 2 });
const oil = full({ energy_kcal: 900, protein: 0, carbohydrate: 0, sugars: 0, fat: 100, saturates: 14, fibre: 0, sodium: 0 }, 'CoFID-oil');

describe('totals and per-serving', () => {
  it('scales per-100g by grams and divides by servings', () => {
    const r = calculateRecipeNutrition([line('rice', g(200), rice), line('oil', g(10), oil)], 2, conv, { now: NOW });
    expect(r.totals.energy_kcal.status).toBe('known');
    expect(r.totals.energy_kcal.value).toBeCloseTo(700 + 90);
    expect(r.perServing.energy_kcal.value).toBeCloseTo(395);
    expect(r.totals.fat.value).toBeCloseTo(2 + 10);
    expect(r.totals.energy_kcal.sources).toEqual(['CoFID', 'CoFID-oil']);
    expect(r.totals.energy_kcal.calculatedAt).toBe('2026-10-19T12:00:00.000Z');
    expect(r.ingredientCoveragePct).toBe(100);
  });

  it('changing servings re-divides without changing totals', () => {
    const r = calculateRecipeNutrition([line('rice', g(200), rice)], 2, conv, { now: NOW });
    const r4 = withServings(r, 4);
    expect(r4.totals.energy_kcal.value).toBeCloseTo(700);
    expect(r4.perServing.energy_kcal.value).toBeCloseTo(175);
    expect(r.perServing.energy_kcal.value).toBeCloseTo(350);
    expect(calculateRecipeNutrition([line('rice', g(200), rice)], 4, conv).perServing.energy_kcal.value).toBeCloseTo(175);
  });

  it('rejects non-positive servings', () => {
    expect(() => calculateRecipeNutrition([], 0, conv)).toThrow(RangeError);
    expect(() => withServings(calculateRecipeNutrition([], 1, conv), -1)).toThrow(RangeError);
  });

  it('empty recipe is unavailable, not zero', () => {
    const r = calculateRecipeNutrition([], 1, conv);
    expect(r.totals.protein.status).toBe('unavailable');
    expect(r.totals.protein.value).toBeUndefined();
  });
});

describe('unknown vs zero', () => {
  it('true zeros across all contributors stay zero', () => {
    const r = calculateRecipeNutrition([line('rice', g(100), rice), line('oil', g(10), oil)], 1, conv);
    expect(r.totals.sugars.status).toBe('zero'); // rice sugars 0, oil sugars 0
    expect(r.totals.sugars.value).toBe(0);
    expect(r.totals.protein.status).toBe('known'); // zero + non-zero => known
  });

  it('all-zero nutrient is status zero with value 0', () => {
    const r = calculateRecipeNutrition([line('oil', g(10), oil)], 1, conv);
    expect(r.totals.protein.status).toBe('zero');
    expect(r.totals.protein.value).toBe(0);
  });

  it('an unknown contributor makes the total unknown, withholds value, reports lower bound', () => {
    const unknownFibre: NutrientProfile = { per100g: { energy_kcal: { status: 'known', value: 100 }, fibre: { status: 'unknown' } } };
    const r = calculateRecipeNutrition([line('rice', g(100), rice), line('mystery', g(100), unknownFibre)], 1, conv);
    const f = r.totals.fibre;
    expect(f.status).toBe('unknown');
    expect(f.value).toBeUndefined();
    expect(f.incomplete).toBe(true);
    expect(f.lowerBound).toBeCloseTo(1.3);
    expect(f.missingIngredients).toEqual([{ id: 'mystery', name: 'mystery', reason: 'nutrient_unknown' }]);
    expect(f.coveragePct).toBe(50);
    expect(r.perServing.fibre.status).toBe('unknown');
    expect(r.perServing.fibre.value).toBeUndefined();
    // other nutrients with full data are unaffected
    expect(r.totals.energy_kcal.status).toBe('known');
  });

  it('unknown is never rendered as 0 when the only contributor is unknown', () => {
    const p: NutrientProfile = { per100g: { fibre: { status: 'unknown' } } };
    const r = calculateRecipeNutrition([line('x', g(50), p)], 1, conv);
    expect(r.totals.fibre.status).toBe('unknown');
    expect(r.totals.fibre.value).toBeUndefined();
    expect(r.totals.fibre.lowerBound).toBe(0); // lower bound only, labelled as such
    expect(r.totals.fibre.incomplete).toBe(true);
  });

  it('nutrient absent from every profile is unavailable', () => {
    const r = calculateRecipeNutrition([line('rice', g(100), full({ energy_kcal: 100 }))], 1, conv);
    expect(r.totals.fibre.status).toBe('unavailable');
    expect(r.totals.fibre.value).toBeUndefined();
  });

  it('a known value of 0 is normalised to zero', () => {
    const n = normaliseProfile({ per100g: { fat: { status: 'known', value: 0 } } });
    expect(n.fat.status).toBe('zero');
  });

  it('invalid known values (negative / NaN / missing) become unknown', () => {
    const n = normaliseProfile({ per100g: { fat: { status: 'known', value: -1 }, protein: { status: 'known', value: NaN }, fibre: { status: 'known' } } });
    expect(n.fat.status).toBe('unknown');
    expect(n.protein.status).toBe('unknown');
    expect(n.fibre.status).toBe('unknown');
  });
});

describe('unresolvable lines', () => {
  it('no profile -> every nutrient unknown, ingredient listed, coverage drops', () => {
    const r = calculateRecipeNutrition([line('rice', g(100), rice), line('ghost', g(100), undefined)], 1, conv);
    expect(r.missingIngredients).toEqual([{ id: 'ghost', name: 'ghost', reason: 'no_profile' }]);
    expect(r.totals.energy_kcal.status).toBe('unknown');
    expect(r.totals.energy_kcal.lowerBound).toBeCloseTo(350);
    expect(r.ingredientCoveragePct).toBe(50);
  });

  it('unconvertible quantity (no density) -> no_grams, unknown', () => {
    const cup: Quantity = { kind: 'exact', value: 1, unit: 'cup', originalText: '1 cup' };
    const r = calculateRecipeNutrition([line('rice', cup, rice)], 1, conv);
    expect(r.missingIngredients[0]?.reason).toBe('no_grams');
    expect(r.totals.energy_kcal.status).toBe('unknown');
  });

  it('to_taste / unparsed / valueless approximate are never converted', () => {
    const lines = [
      line('salt', { kind: 'to_taste', originalText: 'to taste' }, rice),
      line('u', { kind: 'unparsed', originalText: '?' }, rice),
      line('pinch', { kind: 'approximate', approxLabel: 'pinch', originalText: 'a pinch' }, rice),
    ];
    const r = calculateRecipeNutrition(lines, 1, conv);
    expect(r.missingIngredients.map(m => m.reason)).toEqual(['to_taste', 'unparsed', 'no_grams']);
    expect(r.totals.protein.status).toBe('unknown');
  });

  it('to-taste can be opted out as negligible (with warning)', () => {
    const r = calculateRecipeNutrition(
      [line('rice', g(100), rice), line('salt', { kind: 'to_taste', originalText: 'to taste' }, rice)], 1, conv,
      { treatToTasteAsNegligible: true });
    expect(r.totals.protein.status).toBe('known');
    expect(r.warnings.join()).toContain("'to taste'");
  });

  it('optional lines excluded by default, included on request', () => {
    const opt = line('oil', g(10), oil, { optional: true });
    expect(calculateRecipeNutrition([line('rice', g(100), rice), opt], 1, conv).totals.fat.value).toBeCloseTo(1);
    expect(calculateRecipeNutrition([line('rice', g(100), rice), opt], 1, conv, { includeOptional: true }).totals.fat.value).toBeCloseTo(11);
  });
});

describe('estimates and yield hook', () => {
  it('range and converter estimates flag the value as estimate', () => {
    const range: Quantity = { kind: 'range', min: 100, max: 200, unit: 'g', originalText: '100-200g' };
    const r = calculateRecipeNutrition([line('rice', range, rice)], 1, conv);
    expect(r.totals.energy_kcal.value).toBeCloseTo(525);
    expect(r.totals.energy_kcal.estimate).toBe(true);
    const items = calculateRecipeNutrition([line('onion', { kind: 'exact', value: 2, unit: 'item', originalText: '2' }, full({ energy_kcal: 40 }))], 1, conv);
    expect(items.totals.energy_kcal.value).toBeCloseTo(120);
    expect(items.totals.energy_kcal.estimate).toBe(true);
  });

  it('exact mass with exact data is not an estimate', () => {
    expect(calculateRecipeNutrition([line('rice', g(100), rice)], 1, conv).totals.energy_kcal.estimate).toBe(false);
  });

  it('gramsFactor only applies when provided and flags estimate', () => {
    const plain = calculateRecipeNutrition([line('rice', g(400), rice)], 1, conv);
    const drained = calculateRecipeNutrition([line('rice', g(400), rice, { gramsFactor: { factor: 0.6, reason: 'drained weight' } })], 1, conv);
    expect(plain.totals.energy_kcal.value).toBeCloseTo(1400);
    expect(plain.totals.energy_kcal.estimate).toBe(false);
    expect(drained.totals.energy_kcal.value).toBeCloseTo(840);
    expect(drained.totals.energy_kcal.estimate).toBe(true);
  });

  it('invalid gramsFactor makes the line unresolvable rather than guessing', () => {
    const r = calculateRecipeNutrition([line('rice', g(100), rice, { gramsFactor: { factor: 0, reason: 'bad' } })], 1, conv);
    expect(r.missingIngredients[0]?.reason).toBe('no_grams');
  });
});

describe('derivations', () => {
  it('derives kJ from kcal and flags it', () => {
    const r = calculateRecipeNutrition([line('rice', g(100), full({ energy_kcal: 100 }))], 1, conv);
    expect(r.totals.energy_kj.status).toBe('known');
    expect(r.totals.energy_kj.value).toBeCloseTo(418.4);
    expect(r.totals.energy_kj.derived).toBe(true);
    expect(r.totals.energy_kcal.derived).toBe(false);
  });

  it('derives kcal from kJ', () => {
    const r = calculateRecipeNutrition([line('x', g(100), full({ energy_kj: 418.4 }))], 1, conv);
    expect(r.totals.energy_kcal.value).toBeCloseTo(100);
    expect(r.totals.energy_kcal.derived).toBe(true);
  });

  it('salt = sodium x 2.5 (sodium in mg, salt in g) and reverse', () => {
    const a = calculateRecipeNutrition([line('x', g(100), full({ sodium: 400 }))], 1, conv);
    expect(a.totals.salt.value).toBeCloseTo(1.0);
    expect(a.totals.salt.derived).toBe(true);
    const b = calculateRecipeNutrition([line('x', g(100), full({ salt: 1 }))], 1, conv);
    expect(b.totals.sodium.value).toBeCloseTo(400);
    expect(b.totals.sodium.derived).toBe(true);
  });

  it('zero sodium derives zero salt; unknown does not derive', () => {
    const z = normaliseProfile({ per100g: { sodium: { status: 'zero' } } });
    expect(z.salt.status).toBe('zero');
    const u = normaliseProfile({ per100g: { sodium: { status: 'unknown' } } });
    expect(u.salt.status).toBe('unavailable');
  });

  it('warns on inconsistent energy pair but keeps supplied values', () => {
    const w: string[] = [];
    const n = normaliseProfile({ per100g: { energy_kcal: { status: 'known', value: 100 }, energy_kj: { status: 'known', value: 900 } } }, w, 'bad');
    expect(w[0]).toContain('inconsistent');
    expect(n.energy_kj.value).toBe(900);
    expect(n.energy_kj.derived).toBeUndefined();
  });
});

describe('weekly summary', () => {
  const day = (date: string, id: string, kcal: number, servings = 1): PlannedMealNutrition => {
    const r = calculateRecipeNutrition([line('x', g(100), full({ energy_kcal: kcal, fibre: 1 }))], 1, conv, { now: NOW });
    return { plannedMealId: id, recipeId: 'r-' + id, date, servings, perServing: r.perServing };
  };

  it('totals, per-day and per-serving averages', () => {
    const s = summariseWeek([day('2026-10-19', 'a', 500), day('2026-10-19', 'b', 300), day('2026-10-20', 'c', 400, 2)], { now: NOW });
    expect(s.totals.energy_kcal.value).toBeCloseTo(500 + 300 + 800);
    expect(s.dayCount).toBe(2);
    expect(s.perDayAverage.energy_kcal.value).toBeCloseTo(800);
    expect(s.totalServings).toBe(4);
    expect(s.perServingAverage.energy_kcal.value).toBeCloseTo(400);
    expect(s.dailyTotals.map(d => d.date)).toEqual(['2026-10-19', '2026-10-20']);
    expect(s.dailyTotals[0]!.totals.energy_kcal.value).toBeCloseTo(800);
    expect(s.disclaimer).toBe(NUTRITION_DISCLAIMER);
  });

  it('fixed dayCount override', () => {
    const s = summariseWeek([day('2026-10-19', 'a', 700)], { dayCount: 7 });
    expect(s.perDayAverage.energy_kcal.value).toBeCloseTo(100);
  });

  it('a meal without nutrition makes totals unknown (not undercounted as known)', () => {
    const s = summariseWeek([day('2026-10-19', 'a', 500), { plannedMealId: 'z', recipeId: 'r', date: '2026-10-20', servings: 1 }]);
    expect(s.totals.energy_kcal.status).toBe('unknown');
    expect(s.totals.energy_kcal.value).toBeUndefined();
    expect(s.totals.energy_kcal.lowerBound).toBeCloseTo(500);
    expect(s.perDayAverage.energy_kcal.value).toBeUndefined();
    expect(s.mealsWithoutNutrition).toEqual(['z']);
    expect(s.dailyTotals[0]!.totals.energy_kcal.status).toBe('known');
  });

  it('propagates unknown from an incomplete recipe and keeps lower bound scaled by servings', () => {
    const p: NutrientProfile = { per100g: { energy_kcal: { status: 'known', value: 100 }, fibre: { status: 'unknown' } } };
    const r = calculateRecipeNutrition([line('x', g(100), p)], 1, conv);
    const s = summariseWeek([{ plannedMealId: 'm', recipeId: 'r', date: '2026-10-19', servings: 2, perServing: r.perServing }]);
    expect(s.totals.fibre.status).toBe('unknown');
    expect(s.totals.fibre.incomplete).toBe(true);
    expect(s.totals.energy_kcal.value).toBeCloseTo(200);
  });

  it('empty plan is unavailable; invalid servings rejected', () => {
    expect(summariseWeek([]).totals.energy_kcal.status).toBe('unavailable');
    expect(() => summariseWeek([{ ...day('2026-10-19', 'a', 1), servings: 0 }])).toThrow(RangeError);
  });
});
