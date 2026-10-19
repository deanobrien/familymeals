import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadCofid, loadSeed, PACKAGE_ROOT } from '../src/load.js';
import { DENSITIES } from '../src/data/densities.js';
import { UNIT_WEIGHTS } from '../src/data/unit-weights.js';
import { PRICES } from '../src/data/prices.js';
import { CanonicalIngredientSchema, PriceObservationSeedSchema } from '../src/schemas.js';

const { ingredients, prices } = loadSeed();
const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim();

describe('canonical ingredient seed', () => {
  it('has roughly 300+ ingredients, all schema-valid', () => {
    expect(ingredients.length).toBeGreaterThanOrEqual(300);
    for (const i of ingredients) expect(CanonicalIngredientSchema.safeParse(i).success).toBe(true);
  });
  it('has unique ids, slugs and names', () => {
    expect(new Set(ingredients.map((i) => i.id)).size).toBe(ingredients.length);
    expect(new Set(ingredients.map((i) => i.slug)).size).toBe(ingredients.length);
    expect(new Set(ingredients.map((i) => norm(i.name))).size).toBe(ingredients.length);
  });
  it('has no duplicate names or aliases across ingredients', () => {
    const owner = new Map<string, string>();
    const clashes: string[] = [];
    for (const i of ingredients) {
      for (const label of [i.name, ...i.aliases]) {
        const k = norm(label);
        const prev = owner.get(k);
        if (prev !== undefined && prev !== i.name) clashes.push(`"${label}" in ${i.name} and ${prev}`);
        else if (prev === i.name && label !== i.name) clashes.push(`"${label}" repeated within ${i.name}`);
        owner.set(k, i.name);
      }
    }
    expect(clashes).toEqual([]);
  });
  it('keeps UK/US synonyms resolvable', () => {
    const all = new Map<string, string>();
    for (const i of ingredients) for (const l of [i.name, ...i.aliases]) all.set(norm(l), i.name);
    expect(all.get('zucchini')).toBe('courgette');
    expect(all.get('eggplant')).toBe('aubergine');
    expect(all.get('cilantro')).toBe('fresh coriander');
  });
  it('keeps fresh and ground coriander as separate ingredients', () => {
    const fresh = ingredients.find((i) => i.name === 'fresh coriander')!;
    const ground = ingredients.find((i) => i.name === 'ground coriander')!;
    expect(fresh.form).toBe('fresh');
    expect(ground.form).toBe('ground');
    expect(fresh.id).not.toBe(ground.id);
  });
  it('uses deterministic ids (stable across rebuilds)', () => {
    expect(loadSeed().ingredients.map((i) => i.id)).toEqual(ingredients.map((i) => i.id));
  });
});

describe('densities and unit weights', () => {
  const names = new Set(ingredients.map((i) => i.name));
  it('all densities are positive, plausible (0.1-1.6 g/ml), sourced and reference real ingredients', () => {
    for (const [n, v, s] of DENSITIES) {
      expect(names.has(n), `unknown ingredient ${n}`).toBe(true);
      expect(v).toBeGreaterThan(0.1);
      expect(v).toBeLessThan(1.6);
      expect(s.length).toBeGreaterThan(5);
    }
    expect(new Set(DENSITIES.map((d) => d[0])).size).toBe(DENSITIES.length);
  });
  it('all unit weights are positive, sourced, flagged estimate, and reference real ingredients', () => {
    for (const [n, g, s] of UNIT_WEIGHTS) expect(names.has(n) && g > 0 && s.length > 5, n).toBe(true);
    expect(new Set(UNIT_WEIGHTS.map((d) => d[0])).size).toBe(UNIT_WEIGHTS.length);
    for (const i of ingredients) if (i.unitWeightG) expect(i.unitWeightG.estimate).toBe(true);
  });
  it('merged ingredient records carry the density/unit-weight', () => {
    expect(ingredients.find((i) => i.name === 'plain flour')!.densityGPerMl!.value).toBeGreaterThan(0);
    expect(ingredients.find((i) => i.name === 'onion')!.unitWeightG!.value).toBeGreaterThan(0);
    expect(ingredients.filter((i) => i.densityGPerMl).length).toBe(DENSITIES.length);
    expect(ingredients.filter((i) => i.unitWeightG).length).toBe(UNIT_WEIGHTS.length);
  });
});

describe('generic price estimates', () => {
  it('every price has date, source, kind generic_estimate, integer pence > 0 and a positive pack', () => {
    expect(prices.length).toBe(PRICES.length);
    for (const p of prices) {
      expect(PriceObservationSeedSchema.safeParse(p).success).toBe(true);
      expect(Number.isInteger(p.pricePence)).toBe(true);
      expect(p.observedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(p.source.length).toBeGreaterThan(10);
      expect(p.kind).toBe('generic_estimate');
      expect(p.packQuantity.value).toBeGreaterThan(0);
    }
  });
  it('is honest: source text labels them as estimates, not retailer data', () => {
    for (const p of prices) expect(p.source.toLowerCase()).toContain('estimate');
  });
  it('has at most one price per ingredient', () => {
    expect(new Set(prices.map((p) => p.ingredientId)).size).toBe(prices.length);
  });
  it('prices are in a sane range (< GBP 15 per pack)', () => {
    for (const p of prices) expect(p.pricePence).toBeLessThan(1500);
  });
});

describe('CoFID mapping', () => {
  const real = resolve(PACKAGE_ROOT, 'data/out/cofid.json');
  it('maps a substantial share of ingredients and is unique-coded where exact', () => {
    expect(ingredients.filter((i) => i.cofid).length).toBeGreaterThan(250);
  });
  it.skipIf(!existsSync(real))('every mapped code exists in the imported CoFID dataset', () => {
    const codes = new Set(loadCofid().foods.map((f) => f.code));
    const dup = new Set(loadCofid().foods.filter((f) => f.duplicateCode).map((f) => f.code));
    expect([...dup].filter((c) => ingredients.some((i) => i.cofid?.code === c))).toEqual([]);
    const missing = ingredients.filter((i) => i.cofid && !codes.has(i.cofid.code)).map((i) => `${i.name}:${i.cofid!.code}`);
    expect(missing).toEqual([]);
  });
});
