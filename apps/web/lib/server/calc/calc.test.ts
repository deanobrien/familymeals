import { describe, expect, it } from 'vitest';
import { loadSeed } from '@fr/refdata';
import pricesJson from '@fr/refdata/prices.json';
import type { PriceObservation } from '@fr/engine/cost';
import { withCanonicalIngredients } from '../../recipes/factory';
import { loadSeedRecipes } from '../../recipes/seed';
import type { IngredientLine, Quantity, RecipeView } from '../../recipes/types';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { StaticPriceSource, costRecipe, createRecipeCalculator, nutritionForRecipe, type CalcDeps, type CalcRecipe } from './index';
import { loadCofidProfiles, loadGenericPrices } from './refdata';

const cat = getIngredientCatalogue();
const deps: CalcDeps = { catalogue: cat, prices: loadGenericPrices(), cofid: loadCofidProfiles(), now: () => new Date('2026-10-19T12:00:00Z') };
const exact = (value: number, unit: Quantity['unit'], text = `${value} ${unit}`): Quantity => ({ kind: 'exact', value, unit, originalText: text });
const line = (name: string, quantity: Quantity, optional = false): IngredientLine => ({ id: `l-${name}-${quantity.originalText}`, name, quantity, optional, order: 0 });
const recipe = (servings: number, ingredients: IngredientLine[], id = 'r1', updatedAt = '2026-10-19T00:00:00Z'): CalcRecipe => ({
  id, servings, updatedAt, ingredients: ingredients.map((l, i) => ({ ...l, id: `${l.id}-${i}`, order: i })),
});

const seed = withCanonicalIngredients(loadSeedRecipes());
const byTitle = (t: string): RecipeView => seed.find((r) => r.title === t)!;

describe('refdata wiring', () => {
  it('bundled prices.json matches @fr/refdata loadSeed()', () => {
    const seedPrices = loadSeed().prices;
    expect((pricesJson as { ingredientId: string; pricePence: number }[]).map((p) => [p.ingredientId, p.pricePence]))
      .toEqual(seedPrices.map((p) => [p.ingredientId, p.pricePence]));
  });
  it('builds CoFID profiles for mapped ingredients only', () => {
    const onion = cat.all.find((i) => i.name === 'onion')!;
    const p = deps.cofid.profile(onion.id);
    expect(p?.per100g.energy_kcal?.status).toBe('known');
    expect(deps.cofid.profile('00000000-0000-4000-8000-000000000000')).toBeUndefined();
    expect(deps.cofid.attribution).toMatch(/UK CoFID/);
  });
});

describe('costRecipe', () => {
  it('prices known lines from generic estimates and labels them', () => {
    // onion: 1 kg = 120p, so 500 g = 60p; milk 2.272 l = 150p
    const r = costRecipe(recipe(2, [line('onion', exact(500, 'g'))]), deps);
    expect(r.totalPence).toBe(60);
    expect(r.perServingPence).toBe(30);
    expect(r.kind).toBe('generic_estimate');
    expect(r.includesEstimates).toBe(true);
    expect(r.isPartial).toBe(false);
    expect(r.coveragePct).toBe(100);
    expect(r.sources[0]?.source).toMatch(/Generic UK estimate/);
  });

  it('lists uncosted lines with reasons and never counts them as zero', () => {
    const r = costRecipe(recipe(2, [
      line('onion', exact(500, 'g')),
      line('quantum goo', exact(1, 'g')),
      line('salt', { kind: 'to_taste', originalText: 'to taste' }),
    ]), deps);
    expect(r.isPartial).toBe(true);
    expect(r.totalPence).toBe(60);
    const reasons = Object.fromEntries(r.uncosted.map((u) => [u.name, u.reason]));
    expect(reasons['quantum goo']).toBe('unmatched_ingredient');
    expect(['unmatched_ingredient', 'to_taste']).toContain(reasons['salt']);
    expect(r.coveragePct).toBeLessThan(100);
  });

  it('is unknown (null, not 0) when nothing can be priced', () => {
    const r = costRecipe(recipe(4, [line('quantum goo', exact(1, 'g'))]), deps);
    expect(r.totalPence).toBeNull();
    expect(r.perServingPence).toBeNull();
    expect(r.kind).toBeNull();
    expect(r.uncosted[0]?.reasonLabel).toMatch(/not recognised/);
  });

  it('scales with the servings factor', () => {
    const base = costRecipe(recipe(2, [line('onion', exact(500, 'g'))]), deps);
    const x2 = costRecipe(recipe(2, [line('onion', exact(500, 'g'))]), deps, { scale: 2 });
    expect(x2.totalPence).toBe((base.totalPence ?? 0) * 2);
  });

  it('prefers household observations (user_confirmed) over generic prices and labels them', () => {
    const onion = cat.all.find((i) => i.name === 'onion')!;
    const mine: PriceObservation = {
      ingredientId: onion.id, pricePence: 200, packQuantity: exact(1, 'kg'), kind: 'user_confirmed', observedOn: '2026-10-19', source: 'Household entry',
    };
    const src = new StaticPriceSource([mine]);
    const calc = createRecipeCalculator({ priceSource: src, now: deps.now });
    const r = recipe(2, [line('onion', exact(500, 'g'))]);
    const out = calc.forRecipe(r).cost;
    expect(out.totalPence).toBe(100);
    expect(out.kind).toBe('user_confirmed');
    expect(out.includesEstimates).toBe(false);
    // price change invalidates the cache
    src.set([{ ...mine, pricePence: 300 }]);
    expect(calc.forRecipe(r).cost.totalPence).toBe(150);
  });

  it('matches lines without a stored ingredient id by name (edited / imported recipes)', () => {
    const r = costRecipe(recipe(1, [line('onions', exact(1, 'kg'))]), deps);
    expect(r.totalPence).toBe(120);
  });
});

describe('nutritionForRecipe', () => {
  it('computes per-serving energy from CoFID, servings-aware, with estimate flags and attribution', () => {
    const rec = recipe(2, [line('plain flour', exact(200, 'g')), line('caster sugar', exact(100, 'g'))]);
    const n = nutritionForRecipe(rec, deps);
    const kcal = n.perServing.energy_kcal;
    expect(kcal.status).toBe('known');
    // flour ~340 kcal/100g, sugar ~390: (200*3.4 + 100*3.9)/2 ~ 535
    expect(kcal.value).toBeGreaterThan(450);
    expect(kcal.value).toBeLessThan(650);
    expect(n.totals.energy_kcal.value).toBeCloseTo((kcal.value ?? 0) * 2, 5);
    expect(n.coveragePct).toBe(100);
    expect(n.attribution).toMatch(/Estimated from UK CoFID data/);
    expect(n.disclaimer).toMatch(/not medical or dietary advice/);
    const four = nutritionForRecipe({ ...rec, servings: 4 }, deps);
    expect(four.perServing.energy_kcal.value).toBeCloseTo((kcal.value ?? 0) / 2, 5);
  });

  it('propagates unknown instead of treating missing data as zero', () => {
    const n = nutritionForRecipe(recipe(2, [line('plain flour', exact(200, 'g')), line('quantum goo', exact(50, 'g'))]), deps);
    expect(n.perServing.energy_kcal.status).toBe('unknown');
    expect(n.perServing.energy_kcal.value).toBeUndefined();
    expect(n.perServing.energy_kcal.incomplete).toBe(true);
    expect(n.perServing.energy_kcal.lowerBound).toBeGreaterThan(0);
    expect(n.missing.map((m) => m.name)).toContain('quantum goo');
    expect(n.coveragePct).toBe(50);
  });

  it('flags estimates for unit weights, ranges and notes to-taste handling', () => {
    const n = nutritionForRecipe(recipe(2, [
      line('onion', exact(2, 'item')),
      line('plain flour', { kind: 'range', min: 100, max: 200, unit: 'g', originalText: '100-200 g' }),
      line('salt', { kind: 'to_taste', originalText: 'to taste' }),
    ]), deps);
    expect(n.hasEstimates).toBe(true);
    expect(n.perServing.energy_kcal.estimate).toBe(true);
    expect(n.warnings.join(' ')).toMatch(/to taste/);
  });
});

describe('seed recipes (real refdata)', () => {
  const calc = createRecipeCalculator({ now: deps.now });

  it('Sunday Tomato Pasta costs a plausible amount per serving', () => {
    const c = calc.forRecipe(byTitle('Sunday Tomato Pasta')).cost;
    expect(c.perServingPence).toBeGreaterThan(30);
    expect(c.perServingPence).toBeLessThan(200);
  });

  it('every seed recipe has a cost result with consistent coverage and no zero totals', () => {
    for (const r of seed) {
      const { cost, nutrition } = calc.forRecipe(r);
      expect(cost.totalPence === null || cost.totalPence > 0).toBe(true);
      expect(cost.coveragePct).toBeGreaterThanOrEqual(0);
      expect(cost.isPartial).toBe(cost.uncosted.length > 0);
      expect(nutrition.coveragePct).toBeLessThanOrEqual(100);
      for (const n of Object.values(nutrition.perServing)) {
        if (n.status === 'unknown') expect(n.value).toBeUndefined();
      }
    }
  });

  it('a fully matched recipe yields known per-serving energy in a sane range', () => {
    const n = calc.forRecipe(byTitle('Lemon Drizzle Loaf')).nutrition;
    expect(n.perServing.energy_kcal.status).toBe('known');
    expect(n.perServing.energy_kcal.value).toBeGreaterThan(150);
    expect(n.perServing.energy_kcal.value).toBeLessThan(700);
  });

  it('caches per recipe version and recomputes on edit (updatedAt)', () => {
    const r = byTitle('Sunday Tomato Pasta');
    expect(calc.forRecipe(r)).toBe(calc.forRecipe(r));
    expect(calc.forRecipe({ ...r, updatedAt: '2030-01-01T00:00:00Z' })).not.toBe(calc.forRecipe(r));
  });

  it('summary stored on RecipeView is derived from the same result', () => {
    const r = byTitle('Sunday Tomato Pasta');
    const s = calc.summarise(r);
    expect(s.cost.totalPence).toBe(calc.forRecipe(r).cost.totalPence);
    expect(s.nutritionPerServing).toHaveLength(10);
  });
});
