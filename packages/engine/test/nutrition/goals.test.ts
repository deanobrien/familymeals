import { describe, expect, it } from 'vitest';
import type { Quantity } from '../../src/contract';
import {
  GOAL_DEFS, GOAL_IDS, GOALS_CONSENT, GOALS_DISCLAIMER, calculateRecipeNutrition, classifyForGoals, goalHints, recipeGoalFit, recipeGoalProfile,
  summariseGoals, suggestSwap, type GoalCandidate, type GoalMeal, type NutrientProfile, type NutritionLine, type RecipeVarietyProfile, type UnitConverter,
} from '../../src/nutrition';

const conv: UnitConverter = { toGrams: (_id, q) => (q.value !== undefined && q.unit === 'g' ? { grams: q.value, estimate: false } : null) };
const g = (value: number): Quantity => ({ kind: 'exact', value, unit: 'g', originalText: `${value}g` });
const prof = (v: Record<string, number>): NutrientProfile => ({
  source: 'CoFID',
  per100g: Object.fromEntries(Object.entries(v).map(([k, value]) => [k, { status: value === 0 ? 'zero' : 'known', value }])),
});
const line = (id: string, grams: number, p?: NutrientProfile): NutritionLine => ({ id, name: id, ingredientId: id, quantity: g(grams), optional: false, ...(p ? { profile: p } : {}) });
/** per-serving nutrition for a recipe of `servings` servings made of 100 g-per-100 g style profiles. */
const nutrition = (lines: NutritionLine[], servings = 1) => calculateRecipeNutrition(lines, servings, conv).perServing;

const ALL = { energy_kcal: 100, protein: 5, carbohydrate: 10, sugars: 4, fat: 2, saturates: 1, fibre: 6, sodium: 100 };
const variety = (fv: number, extra: Partial<RecipeVarietyProfile> = {}): RecipeVarietyProfile => ({ fv, pulses: 0, plants: [], proteinSources: [], proteins: [], unweighed: 0, ...extra });

const meal = (id: string, date: string, over: Partial<GoalMeal> = {}): GoalMeal => ({ id, recipeId: `r-${id}`, date, mealType: 'dinner', title: `Meal ${id}`, ...over });
const days = ['2026-10-19', '2026-10-20', '2026-10-21'];

describe('reference data', () => {
  it('has a cited NHS source, review date and plain wording for every goal; no calorie or weight goals', () => {
    expect(GOAL_IDS).toHaveLength(6);
    for (const id of GOAL_IDS) {
      const d = GOAL_DEFS[id];
      expect(d.source.url).toMatch(/^https:\/\/www\.nhs\.uk\//);
      expect(d.source.reviewed).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(d.referenceText).toContain('NHS');
    }
    expect(GOAL_IDS.join(' ')).not.toMatch(/weight|calorie|kcal|energy/);
    expect([GOAL_DEFS.more_fibre.reference, GOAL_DEFS.less_salt.reference, GOAL_DEFS.less_sugar.reference, GOAL_DEFS.more_fruit_veg.reference]).toEqual([30, 6, 30, 5]);
  });
  it('disclaimer and consent make no medical claims and say it is private and withdrawable', () => {
    expect(GOALS_DISCLAIMER).toMatch(/not medical or dietary advice/);
    const all = GOALS_CONSENT.paragraphs.join(' ');
    expect(all).toMatch(/Only you can see/);
    expect(all).toMatch(/never sent to our AI provider/);
    expect(all).toMatch(/Withdrawing deletes/);
    expect(all).not.toMatch(/bcure|prevent|diagnos|treatment/i);
  });
});

describe('summariseGoals: portion share', () => {
  const meals = days.map((d, i) => meal(`m${i}`, d, { perServing: nutrition([line('x', 100, prof(ALL))]) })); // 6 g fibre per serving
  it('scales a serving by the portion share (usual, small, large)', () => {
    const usual = summariseGoals(['more_fibre'], meals).progress[0]!;
    const small = summariseGoals(['more_fibre'], meals, { portionShare: 0.5 }).progress[0]!;
    const large = summariseGoals(['more_fibre'], meals, { portionShare: 1.5 }).progress[0]!;
    expect(usual.amount).toBeCloseTo(6);
    expect(small.amount).toBeCloseTo(3);
    expect(large.amount).toBeCloseTo(9);
    expect(usual.atLeast).toBe(false);
  });
  it('ignores an invalid portion share (falls back to one serving)', () => {
    expect(summariseGoals(['more_fibre'], meals, { portionShare: -3 }).portionShare).toBe(1);
  });
  it('scales the daily guidance to the meals planned (dinner is about a third of a day)', () => {
    const p = summariseGoals(['more_fibre'], meals).progress[0]!;
    expect(p.fullReference).toBe(30);
    expect(p.reference).toBeCloseTo(10.5); // 30 g x 0.35
    expect(p.status).toBe('off'); // 6 / 10.5 = 0.57
    const withLunch = days.flatMap((d, i) => [meal(`d${i}`, d, { perServing: meals[0]!.perServing }), meal(`l${i}`, d, { mealType: 'lunch', perServing: meals[0]!.perServing })]);
    const q = summariseGoals(['more_fibre'], withLunch).progress[0]!;
    expect(q.reference).toBeCloseTo(30 * 0.65);
    expect(q.amount).toBeCloseTo(12);
  });
  it('statuses for an at-least goal: met, close, off', () => {
    const at = (fibre: number) => summariseGoals(['more_fibre'], [meal('a', days[0]!, { perServing: nutrition([line('x', 100, prof({ ...ALL, fibre }))]) })]).progress[0]!.status;
    expect(at(11)).toBe('met');
    expect(at(9)).toBe('close');
    expect(at(5)).toBe('off');
  });
  it('statuses for a limit: within, a little over, over', () => {
    const at = (sodium: number) => summariseGoals(['less_salt'], [meal('a', days[0]!, { perServing: nutrition([line('x', 100, prof({ ...ALL, sodium }))]) })]).progress[0]!.status;
    // salt per serving = sodium(mg) * 2.5 / 1000 g; reference 6 g x 0.35 = 2.1 g
    expect(at(600)).toBe('met'); // 1.5 g
    expect(at(900)).toBe('close'); // 2.25 g
    expect(at(1500)).toBe('off'); // 3.75 g
  });
});

describe('summariseGoals: coverage and partial weeks (never fabricate)', () => {
  const known = nutrition([line('x', 100, prof(ALL))]);
  const unknownFibre = nutrition([line('x', 100, prof(ALL)), line('mystery', 50)]); // a line with no profile: fibre becomes a lower bound
  it('a meal with no nutrition at all makes the figure "at least" and an at-least goal "unclear" below the line', () => {
    const p = summariseGoals(['more_fibre'], [meal('a', days[0]!, { perServing: known }), meal('b', days[1]!)]).progress[0]!;
    expect(p.atLeast).toBe(true);
    expect(p.mealsMissingData).toBe(1);
    expect(p.mealsCounted).toBe(1);
    expect(p.amount).toBeCloseTo(3); // (6 + 0) / 2 days, the unknown meal adds nothing
    expect(p.status).toBe('unclear');
    expect(p.headline).toContain('at least');
    expect(p.detail).toMatch(/cannot tell/);
  });
  it('a lower bound that already reaches the line is still "met"', () => {
    const rich = nutrition([line('x', 100, prof({ ...ALL, fibre: 30 }))]);
    const p = summariseGoals(['more_fibre'], [meal('a', days[0]!, { perServing: rich }), meal('b', days[1]!)]).progress[0]!;
    expect(p.atLeast).toBe(true);
    expect(p.status).toBe('met');
  });
  it('a lower bound for a limit can only prove it is exceeded', () => {
    const salty = nutrition([line('x', 100, prof({ ...ALL, sodium: 4000 }))]);
    const a = summariseGoals(['less_salt'], [meal('a', days[0]!, { perServing: salty }), meal('b', days[1]!)]).progress[0]!;
    expect(a.status).toBe('off');
    const mild = nutrition([line('x', 100, prof({ ...ALL, sodium: 100 }))]);
    const b = summariseGoals(['less_salt'], [meal('a', days[0]!, { perServing: mild }), meal('b', days[1]!)]).progress[0]!;
    expect(b.status).toBe('unclear');
    expect(b.headline).toContain('at least');
  });
  it('a nutrient with an incomplete line contributes only its known part', () => {
    const p = summariseGoals(['more_fibre'], [meal('a', days[0]!, { perServing: unknownFibre })]).progress[0]!;
    expect(p.atLeast).toBe(true);
    expect(p.amount).toBeCloseTo(6);
  });
  it('no meals: status none, no numbers invented', () => {
    const s = summariseGoals(['more_fibre', 'less_salt'], []);
    expect(s.progress.map((p) => p.status)).toEqual(['none', 'none']);
    expect(s.progress.every((p) => p.amount === 0 && p.reference === 0)).toBe(true);
  });
  it('only the chosen goals are reported, in a fixed order', () => {
    const s = summariseGoals(['less_sugar', 'more_fibre'], [meal('a', days[0]!, { perServing: known })]);
    expect(s.progress.map((p) => p.goal)).toEqual(['more_fibre', 'less_sugar']);
  });
  it('no goals chosen: nothing reported', () => {
    expect(summariseGoals([], [meal('a', days[0]!, { perServing: known })]).progress).toEqual([]);
  });
});

describe('fruit and veg, oily fish and red meat', () => {
  it('fruit and veg: per-day portions scaled by share, pulses at most one a day, missing data is a lower bound', () => {
    const m = (id: string, d: string, v: RecipeVarietyProfile | null) => meal(id, d, { variety: v, mealType: 'dinner' });
    const full = summariseGoals(['more_fruit_veg'], [m('a', days[0]!, variety(2, { pulses: 3 })), m('b', days[1]!, variety(4))]).progress[0]!;
    expect(full.amount).toBeCloseTo((2 + 1 + 4) / 2);
    expect(full.atLeast).toBe(false);
    const partial = summariseGoals(['more_fruit_veg'], [m('a', days[0]!, variety(2)), m('b', days[1]!, null)]).progress[0]!;
    expect(partial.atLeast).toBe(true);
    const unweighed = summariseGoals(['more_fruit_veg'], [m('a', days[0]!, variety(2, { unweighed: 1 }))]).progress[0]!;
    expect(unweighed.atLeast).toBe(true);
    const half = summariseGoals(['more_fruit_veg'], [m('a', days[0]!, variety(4))], { portionShare: 0.5 }).progress[0]!;
    expect(half.amount).toBeCloseTo(2);
  });
  it('oily fish is a weekly count; fewer than five planned days is "unclear" rather than "off"', () => {
    const none = summariseGoals(['more_oily_fish'], [meal('a', days[0]!, { goals: { oilyFishPortions: 0, oilyUnweighed: 0, redProcessedMeatG: 0, redUnweighed: 0 } })]).progress[0]!;
    expect(none.status).toBe('unclear');
    const some = summariseGoals(['more_oily_fish'], [meal('a', days[0]!, { goals: { oilyFishPortions: 1.2, oilyUnweighed: 0, redProcessedMeatG: 0, redUnweighed: 0 } })]).progress[0]!;
    expect(some.status).toBe('met');
    expect(some.amount).toBeCloseTo(1.2);
    const week = ['19', '20', '21', '22', '23', '24', '25'].map((d) => `2026-10-${d}`);
    const off = summariseGoals(['more_oily_fish'], week.map((d, i) => meal(`m${i}`, d, { goals: { oilyFishPortions: 0, oilyUnweighed: 0, redProcessedMeatG: 0, redUnweighed: 0 } }))).progress[0]!;
    expect(off.status).toBe('off');
  });
  it('red and processed meat: grams per planned day against the 70 g guidance share', () => {
    const p = summariseGoals(['less_red_processed_meat'], [meal('a', days[0]!, { goals: { oilyFishPortions: 0, oilyUnweighed: 0, redProcessedMeatG: 150, redUnweighed: 0 } })]).progress[0]!;
    expect(p.amount).toBe(150);
    expect(p.reference).toBeCloseTo(24.5);
    expect(p.status).toBe('off');
    expect(p.caveat).toMatch(/cooked weight/);
  });
});

describe('classification', () => {
  it('oily fish: fresh and tinned salmon, mackerel, sardines; not tinned tuna, fish sauce or white fish', () => {
    expect(classifyForGoals('salmon fillet', 'fish_seafood').oilyFish).toBe(true);
    expect(classifyForGoals('tinned sardines', 'tinned_jarred').oilyFish).toBe(true);
    expect(classifyForGoals('smoked mackerel', 'fish_seafood').oilyFish).toBe(true);
    expect(classifyForGoals('tuna', 'tinned_jarred').oilyFish).toBe(false);
    expect(classifyForGoals('fresh tuna steak', 'fish_seafood').oilyFish).toBe(true);
    expect(classifyForGoals('cod fillet', 'fish_seafood').oilyFish).toBe(false);
    expect(classifyForGoals('fish sauce', 'sauces').oilyFish).toBe(false);
    expect(classifyForGoals('salmon flavoured stock', 'tinned_jarred').oilyFish).toBe(false);
  });
  it('red and processed meat: beef, pork, lamb, bacon, sausages; not chicken, turkey or vegetarian substitutes', () => {
    for (const n of ['beef mince', 'pork shoulder', 'lamb chops', 'smoked bacon', 'pork sausages', 'chorizo', 'ham']) expect(classifyForGoals(n, 'meat_poultry').redMeat, n).toBe(true);
    for (const n of ['chicken breast', 'turkey mince', 'chicken sausages']) expect(classifyForGoals(n, 'meat_poultry').redMeat, n).toBe(false);
    expect(classifyForGoals('vegetarian sausages', 'meat_alternatives').redMeat).toBe(false);
    expect(classifyForGoals('beef stock cube', 'tinned_jarred').redMeat).toBe(false);
  });
  it('recipeGoalProfile counts per serving and flags unweighed lines (never treats them as zero)', () => {
    const lines = [
      { ingredientId: '1', name: 'salmon fillet', category: 'fish_seafood', grams: 560 },
      { ingredientId: '2', name: 'beef mince', category: 'meat_poultry', grams: 500 },
      { ingredientId: '3', name: 'smoked bacon', category: 'meat_poultry', grams: null },
      { ingredientId: '4', name: 'mackerel', category: 'fish_seafood', grams: null },
      { ingredientId: '5', name: 'pork', category: 'meat_poultry', grams: 100, optional: true },
      { name: 'unmatched salmon', category: 'fish_seafood', grams: 100 },
    ];
    const p = recipeGoalProfile(lines, 4);
    expect(p.oilyFishPortions).toBeCloseTo(1); // 560 / 4 / 140
    expect(p.oilyUnweighed).toBe(1);
    expect(p.redProcessedMeatG).toBe(125);
    expect(p.redUnweighed).toBe(1);
  });
});

describe('hints and swaps (gentle, only on known data)', () => {
  const lowFibre = nutrition([line('x', 100, prof({ ...ALL, fibre: 1 }))]);
  const highFibre = nutrition([line('x', 100, prof({ ...ALL, fibre: 9 }))]);
  const meals = [meal('a', days[0]!, { perServing: lowFibre, title: 'White pasta' }), meal('b', days[1]!, { perServing: lowFibre, title: 'Plain rice' })];
  const cands: GoalCandidate[] = [
    { recipeId: 'c1', title: 'Lentil stew', perServing: highFibre, mealTypes: ['dinner'] },
    { recipeId: 'c2', title: 'Breakfast bar', perServing: highFibre, mealTypes: ['snack'] },
    { recipeId: 'r-a', title: 'White pasta', perServing: highFibre }, // already planned
    { recipeId: 'c3', title: 'Unknown', perServing: undefined },
  ];
  it('suggests a swap from a saved recipe that suits the slot, never one already planned or without data', () => {
    const s = suggestSwap('more_fibre', meals, cands)!;
    expect(s.toTitle).toBe('Lentil stew');
    expect(['White pasta', 'Plain rice']).toContain(s.fromTitle);
  });
  it('returns nothing when nothing is clearly better', () => {
    expect(suggestSwap('more_fibre', meals, [{ recipeId: 'c9', title: 'Same', perServing: lowFibre }])).toBeNull();
  });
  it('a limit goal swaps the saltiest meal for a milder one', () => {
    const salty = nutrition([line('x', 100, prof({ ...ALL, sodium: 2000 }))]);
    const mild = nutrition([line('x', 100, prof({ ...ALL, sodium: 100 }))]);
    const s = suggestSwap('less_salt', [meal('a', days[0]!, { perServing: salty, title: 'Salty pie' })], [{ recipeId: 'c', title: 'Gentle soup', perServing: mild }]);
    expect(s).toMatchObject({ fromTitle: 'Salty pie', toTitle: 'Gentle soup' });
  });
  it('hints appear only for "off" on known data, are worded softly and capped', () => {
    const s = summariseGoals(['more_fibre'], meals);
    const h = goalHints(s.progress, meals, cands);
    expect(h).toHaveLength(1);
    expect(h[0]!.text).toMatch(/on the low side for fibre/);
    expect(h[0]!.text).toMatch(/you could try Lentil stew/);
    expect(h[0]!.text).not.toMatch(/must|should|need to|deficien|unhealthy|healthy/i);
    // partial data: no hint at all
    const partial = summariseGoals(['more_fibre'], [...meals, meal('c', days[2]!)]);
    expect(goalHints(partial.progress, meals, cands)).toEqual([]);
    expect(goalHints(s.progress, meals, cands, 0)).toEqual([]);
  });
});

describe('recipeGoalFit (planner nudge)', () => {
  const high = nutrition([line('x', 100, prof({ ...ALL, fibre: 12, sodium: 100 }))]);
  const low = nutrition([line('x', 100, prof({ ...ALL, fibre: 1, sodium: 100 }))]);
  it('rewards more of an at-least goal and less of a limit; unknown scores 0', () => {
    expect(recipeGoalFit(['more_fibre'], { perServing: high })).toBe(1);
    expect(recipeGoalFit(['more_fibre'], { perServing: low })).toBeLessThan(0.2);
    expect(recipeGoalFit(['more_fibre'], { perServing: undefined })).toBe(0);
    expect(recipeGoalFit(['less_salt'], { perServing: high })).toBeGreaterThan(0.8);
    expect(recipeGoalFit([], { perServing: high })).toBe(0);
  });
  it('averages over several goals', () => {
    const f = recipeGoalFit(['more_fibre', 'less_salt'], { perServing: high });
    expect(f).toBeGreaterThan(0.85);
    expect(f).toBeLessThanOrEqual(1);
  });
});
