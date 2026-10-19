import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  baseUnitOf,
  conversionFactor,
  convertQuantity,
  COUNT_UNITS,
  dimensionOf,
  isNumericQuantity,
  isUnit,
  MASS_UNITS,
  roundStored,
  toBaseAmount,
  UNIT_INFO,
  VOLUME_UNITS,
} from '../../src/units';
import type { Unit } from '../../src/contract';
import { approx, exact, FLOUR_NO_DENSITY, FLOUR_WITH_DENSITY, MILK, ONION, range, toTaste, unparsed, GARLIC } from './fixtures';

describe('unit metadata', () => {
  it('every contract unit has metadata and the right dimension', () => {
    for (const u of MASS_UNITS) expect(UNIT_INFO[u].dimension).toBe('mass');
    for (const u of VOLUME_UNITS) expect(UNIT_INFO[u].dimension).toBe('volume');
    for (const u of COUNT_UNITS) expect(UNIT_INFO[u].dimension).toBe('count');
    expect(Object.keys(UNIT_INFO)).toHaveLength(MASS_UNITS.length + VOLUME_UNITS.length + COUNT_UNITS.length);
  });
  it('isUnit', () => {
    expect(isUnit('g')).toBe(true);
    expect(isUnit('clove')).toBe(true);
    expect(isUnit('oz')).toBe(false);
    expect(isUnit('toString')).toBe(false);
    expect(isUnit(3)).toBe(false);
  });
  it('dimensionOf / baseUnitOf treat an absent unit as a unitless count', () => {
    expect(dimensionOf(undefined)).toBe('count');
    expect(baseUnitOf(undefined)).toBe('item');
    expect(baseUnitOf('kg')).toBe('g');
    expect(baseUnitOf('tbsp')).toBe('ml');
    expect(baseUnitOf('clove')).toBe('clove');
  });
  it('roundStored removes float noise only', () => {
    expect(roundStored(0.1 + 0.2)).toBe(0.3);
    expect(roundStored(0)).toBe(0);
    expect(roundStored(226.796185)).toBe(226.796185);
  });
});

describe('isNumericQuantity', () => {
  it.each([
    [exact(1, 'g'), true],
    [exact(0, 'g'), true],
    [range(1, 2, 'g'), true],
    [range(2, 1, 'g'), false],
    [{ kind: 'exact', originalText: 'x' } as const, false],
    [exact(-1, 'g'), false],
    [exact(Number.NaN, 'g'), false],
    [exact(Number.POSITIVE_INFINITY, 'g'), false],
    [{ kind: 'range', min: 1, originalText: 'x' } as const, false],
    [approx('pinch'), false],
    [toTaste(), false],
    [unparsed('??'), false],
  ])('%o -> %s', (q, ok) => expect(isNumericQuantity(q)).toBe(ok));
});

describe('convertQuantity — within a dimension', () => {
  it('kg -> g, g -> kg, mg -> g', () => {
    expect(convertQuantity(exact(1.5, 'kg'), 'g')).toMatchObject({ ok: true, quantity: { kind: 'exact', value: 1500, unit: 'g' }, estimate: false });
    expect(convertQuantity(exact(250, 'g'), 'kg')).toMatchObject({ ok: true, quantity: { value: 0.25, unit: 'kg' } });
    expect(convertQuantity(exact(500, 'mg'), 'g')).toMatchObject({ ok: true, quantity: { value: 0.5 } });
  });
  it('tbsp/tsp/cup/l/pint/floz -> ml', () => {
    expect(convertQuantity(exact(1, 'tbsp'), 'ml')).toMatchObject({ ok: true, quantity: { value: 15 } });
    expect(convertQuantity(exact(3, 'tsp'), 'tbsp')).toMatchObject({ ok: true, quantity: { value: 1 } });
    expect(convertQuantity(exact(1, 'cup'), 'ml')).toMatchObject({ ok: true, quantity: { value: 250 } });
    expect(convertQuantity(exact(1, 'l'), 'ml')).toMatchObject({ ok: true, quantity: { value: 1000 } });
    expect(convertQuantity(exact(1, 'pint'), 'floz')).toMatchObject({ ok: true, quantity: { value: 20 } });
    expect(convertQuantity(exact(1, 'pint'), 'ml')).toMatchObject({ ok: true, quantity: { value: 568.26125 } });
  });
  it('ranges convert both ends and keep originalText', () => {
    const r = convertQuantity(range(1, 2, 'kg', '1-2kg'), 'g');
    expect(r).toEqual({ ok: true, estimate: false, quantity: { kind: 'range', min: 1000, max: 2000, unit: 'g', originalText: '1-2kg' } });
  });
  it('same count unit converts 1:1; unitless == item', () => {
    expect(convertQuantity(exact(2, 'clove'), 'clove')).toMatchObject({ ok: true, quantity: { value: 2 } });
    expect(convertQuantity(exact(2), 'item')).toMatchObject({ ok: true, quantity: { value: 2, unit: 'item' } });
  });
  it('different count units never convert', () => {
    expect(convertQuantity(exact(2, 'clove'), 'item')).toEqual({ ok: false, reason: 'incompatible_count_unit' });
    expect(convertQuantity(exact(1, 'can'), 'pack')).toEqual({ ok: false, reason: 'incompatible_count_unit' });
  });
});

describe('convertQuantity — across dimensions', () => {
  it('volume -> mass only with density', () => {
    expect(convertQuantity(exact(200, 'ml'), 'g', FLOUR_NO_DENSITY)).toEqual({ ok: false, reason: 'missing_density' });
    expect(convertQuantity(exact(200, 'ml'), 'g')).toEqual({ ok: false, reason: 'missing_density' });
    expect(convertQuantity(exact(200, 'ml'), 'g', FLOUR_WITH_DENSITY)).toMatchObject({ ok: true, quantity: { value: 106, unit: 'g' }, estimate: false });
    expect(convertQuantity(exact(1, 'cup'), 'kg', FLOUR_WITH_DENSITY)).toMatchObject({ ok: true, quantity: { value: 0.1325 } });
  });
  it('mass -> volume only with density', () => {
    expect(convertQuantity(exact(103, 'g'), 'ml', MILK)).toMatchObject({ ok: true, quantity: { value: 100, unit: 'ml' } });
    expect(convertQuantity(exact(1.03, 'kg'), 'l', MILK)).toMatchObject({ ok: true, quantity: { value: 1 } });
    expect(convertQuantity(exact(100, 'g'), 'ml', FLOUR_NO_DENSITY)).toEqual({ ok: false, reason: 'missing_density' });
  });
  it('rejects zero / negative / non-finite density', () => {
    for (const value of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(convertQuantity(exact(1, 'ml'), 'g', { densityGPerMl: { value, source: 'bad' } })).toEqual({ ok: false, reason: 'missing_density' });
    }
  });
  it('count (item/unitless) <-> mass via unitWeightG, flagged estimate', () => {
    expect(convertQuantity(exact(2), 'g', ONION)).toMatchObject({ ok: true, quantity: { value: 300, unit: 'g' }, estimate: true });
    expect(convertQuantity(exact(2, 'item'), 'kg', ONION)).toMatchObject({ ok: true, quantity: { value: 0.3 }, estimate: true });
    expect(convertQuantity(exact(450, 'g'), 'item', ONION)).toMatchObject({ ok: true, quantity: { value: 3 }, estimate: true });
  });
  it('count -> mass refused without unitWeightG, when estimates disallowed, or for non-item counts', () => {
    expect(convertQuantity(exact(2), 'g', MILK)).toEqual({ ok: false, reason: 'missing_unit_weight' });
    expect(convertQuantity(exact(2), 'g', ONION, { allowEstimate: false })).toEqual({ ok: false, reason: 'missing_unit_weight' });
    expect(convertQuantity(exact(2, 'clove'), 'g', GARLIC)).toEqual({ ok: false, reason: 'incompatible_count_unit' });
    expect(convertQuantity(exact(100, 'g'), 'clove', GARLIC)).toEqual({ ok: false, reason: 'incompatible_count_unit' });
  });
  it('count <-> volume is never allowed', () => {
    expect(convertQuantity(exact(2), 'ml', { ...ONION, densityGPerMl: { value: 1, source: 'x' } })).toEqual({ ok: false, reason: 'incompatible_dimension' });
    expect(convertQuantity(exact(2, 'tbsp'), 'item', ONION)).toEqual({ ok: false, reason: 'incompatible_dimension' });
  });
});

describe('convertQuantity — never converts non-numeric kinds', () => {
  it.each([approx('pinch'), toTaste(), unparsed('a bit'), { kind: 'approximate', approxLabel: 'about', value: 200, unit: 'g', originalText: 'about 200g' } as const])(
    '%o',
    (q) => expect(convertQuantity(q, 'g', FLOUR_WITH_DENSITY)).toEqual({ ok: false, reason: 'not_convertible_kind' }),
  );
  it('a pinch of salt never gets a weight, even with density and unit weight available', () => {
    const salt = { densityGPerMl: { value: 1.2, source: 'x' }, unitWeightG: { value: 0.3, source: 'x', estimate: true as const } };
    expect(convertQuantity(approx('pinch', 'a pinch of salt'), 'g', salt).ok).toBe(false);
  });
  it('rejects malformed numeric quantities', () => {
    expect(convertQuantity(exact(-5, 'g'), 'kg')).toEqual({ ok: false, reason: 'invalid_quantity' });
    expect(convertQuantity(range(3, 1, 'g'), 'kg')).toEqual({ ok: false, reason: 'invalid_quantity' });
  });
});

describe('conversionFactor', () => {
  it('returns factors directly', () => {
    expect(conversionFactor('tbsp', 'tsp')).toEqual({ ok: true, factor: 3, estimate: false });
    expect(conversionFactor(undefined, 'item')).toEqual({ ok: true, factor: 1, estimate: false });
  });
});

describe('toBaseAmount', () => {
  it('expresses quantities in base units', () => {
    expect(toBaseAmount(exact(2, 'tbsp'))).toEqual({ dimension: 'volume', baseUnit: 'ml', min: 30, max: 30 });
    expect(toBaseAmount(range(1, 2, 'kg'))).toEqual({ dimension: 'mass', baseUnit: 'g', min: 1000, max: 2000 });
    expect(toBaseAmount(exact(3))).toEqual({ dimension: 'count', baseUnit: 'item', min: 3, max: 3 });
    expect(toBaseAmount(approx('pinch'))).toBeUndefined();
  });
});

describe('conversion properties', () => {
  const massU = fc.constantFrom<Unit>(...MASS_UNITS);
  const volU = fc.constantFrom<Unit>(...VOLUME_UNITS);
  const amount = fc.double({ min: 0.001, max: 1e6, noNaN: true });

  it('round-trips within a dimension (mass, volume)', () => {
    for (const unitArb of [massU, volU]) {
      fc.assert(fc.property(amount, unitArb, unitArb, (v, a, b) => {
        const there = convertQuantity(exact(v, a), b);
        expect(there.ok).toBe(true);
        if (!there.ok) return;
        const back = convertQuantity(there.quantity, a);
        expect(back.ok && back.quantity.value! / v).toBeCloseTo(1, 9);
      }));
    }
  });
  it('round-trips volume <-> mass with density', () => {
    fc.assert(fc.property(amount, volU, massU, fc.double({ min: 0.05, max: 20, noNaN: true }), (v, vu, mu, d) => {
      const ing = { densityGPerMl: { value: d, source: 'p' } };
      const m = convertQuantity(exact(v, vu), mu, ing);
      expect(m.ok).toBe(true);
      if (!m.ok) return;
      const back = convertQuantity(m.quantity, vu, ing);
      expect(back.ok && back.quantity.value! / v).toBeCloseTo(1, 6);
    }));
  });
  it('conversion is linear: convert(a+b) = convert(a)+convert(b)', () => {
    fc.assert(fc.property(amount, amount, volU, volU, (a, b, from, to) => {
      const sum = convertQuantity(exact(a + b, from), to);
      const ca = convertQuantity(exact(a, from), to);
      const cb = convertQuantity(exact(b, from), to);
      if (!sum.ok || !ca.ok || !cb.ok) throw new Error('unexpected');
      expect(sum.quantity.value! / (ca.quantity.value! + cb.quantity.value!)).toBeCloseTo(1, 9);
    }));
  });
});
