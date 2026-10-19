import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { formatNumber, formatQuantity, roundForDisplay, scaleQuantity, scaleToServings, ScaleError, servingsFactor } from '../../src/scale';
import type { Quantity } from '../../src/contract';
import { approx, exact, range, toTaste, unparsed } from './fixtures';

describe('scaleQuantity', () => {
  it('scales exact values', () => {
    expect(scaleQuantity(exact(200, 'g'), 2)).toMatchObject({ kind: 'exact', value: 400, unit: 'g' });
    expect(scaleQuantity(exact(3), 0.5)).toMatchObject({ value: 1.5 });
  });
  it('scales both ends of a range', () => {
    expect(scaleQuantity(range(2, 3, 'clove'), 2)).toMatchObject({ kind: 'range', min: 4, max: 6, unit: 'clove' });
  });
  it('leaves to_taste and unparsed unchanged (but returns a copy)', () => {
    const t = toTaste('salt to taste');
    const s = scaleQuantity(t, 3);
    expect(s).toEqual(t);
    expect(s).not.toBe(t);
    expect(scaleQuantity(unparsed('some stuff'), 4)).toEqual(unparsed('some stuff'));
  });
  it('approximate: scales explicit counts, never invents one for "a pinch"', () => {
    expect(scaleQuantity(approx('pinch'), 2)).toEqual(approx('pinch'));
    const two: Quantity = { kind: 'approximate', approxLabel: 'pinch', value: 2, originalText: '2 pinches' };
    expect(scaleQuantity(two, 2)).toMatchObject({ value: 4, approxLabel: 'pinch' });
    const about: Quantity = { kind: 'approximate', approxLabel: 'about', min: 1, max: 2, unit: 'kg', originalText: 'about 1-2kg' };
    expect(scaleQuantity(about, 1.5)).toMatchObject({ min: 1.5, max: 3, unit: 'kg' });
  });
  it('keeps originalText and does not mutate input', () => {
    const q = exact(100, 'g', '100g butter');
    const s = scaleQuantity(q, 3);
    expect(s.originalText).toBe('100g butter');
    expect(q.value).toBe(100);
  });
  it('exact without a value is returned as-is', () => {
    const q: Quantity = { kind: 'exact', originalText: '?' };
    expect(scaleQuantity(q, 2)).toEqual(q);
  });
  it('stored values are not display-rounded', () => {
    expect(scaleQuantity(exact(1), 1 / 3).value).toBeCloseTo(0.333333333333, 10);
    expect(scaleQuantity(exact(0.1), 3).value).toBe(0.3);
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects factor %s', (f) => {
    expect(() => scaleQuantity(exact(1), f)).toThrow(ScaleError);
  });
  it('scaling is multiplicative: scale(scale(q,a),b) == scale(q,a*b)', () => {
    fc.assert(fc.property(fc.double({ min: 0.01, max: 1000, noNaN: true }), fc.double({ min: 0.05, max: 20, noNaN: true }), fc.double({ min: 0.05, max: 20, noNaN: true }), (v, a, b) => {
      const two = scaleQuantity(scaleQuantity(exact(v, 'g'), a), b).value!;
      const one = scaleQuantity(exact(v, 'g'), a * b).value!;
      expect(two / one).toBeCloseTo(1, 9);
    }));
  });
  it('scaling a range preserves min <= max', () => {
    fc.assert(fc.property(fc.double({ min: 0, max: 100, noNaN: true }), fc.double({ min: 0, max: 100, noNaN: true }), fc.double({ min: 0.01, max: 50, noNaN: true }), (a, b, f) => {
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      const s = scaleQuantity(range(lo, hi, 'g'), f);
      expect(s.min!).toBeLessThanOrEqual(s.max!);
    }));
  });
});

describe('servings', () => {
  it('servingsFactor / scaleToServings', () => {
    expect(servingsFactor(4, 6)).toBe(1.5);
    expect(scaleToServings(exact(2), 4, 2)).toMatchObject({ value: 1 });
    expect(scaleToServings(range(2, 3), 2, 4)).toMatchObject({ min: 4, max: 6 });
    expect(scaleToServings(toTaste(), 2, 8)).toEqual(toTaste());
  });
  it.each([[0, 4], [4, 0], [-2, 4], [Number.NaN, 2], [2, Number.POSITIVE_INFINITY]])('rejects %s -> %s', (a, b) => {
    expect(() => servingsFactor(a, b)).toThrow(ScaleError);
  });
});

describe('roundForDisplay (presentation only)', () => {
  it.each([
    [1234, 'g', 1.25, 'kg'],
    [1000, 'g', 1, 'kg'],
    [999.9, 'g', 1000, 'g'],
    [333.33, 'g', 335, 'g'],
    [12.4, 'g', 12, 'g'],
    [2.3, 'g', 2.5, 'g'],
    [0.04, 'g', 0.1, 'g'],
    [0.26, 'g', 0.3, 'g'],
    [1500, 'ml', 1.5, 'l'],
    [1500, 'mg', 1.5, 'g'],
    [2500000, 'mg', 2.5, 'kg'],
    [1.333, 'tbsp', 1.25, 'tbsp'],
    [0.1, 'tsp', 0.25, 'tsp'],
    [1.4, undefined, 1.5, undefined],
    [2.2, 'clove', 2.25, 'clove'],
    [1.37, 'pint', 1.4, 'pint'],
    [1.234, 'kg', 1.25, 'kg'],
  ] as const)('%s %s -> %s %s', (v, u, ev, eu) => {
    expect(roundForDisplay(v, u)).toEqual({ value: ev, unit: eu });
  });
  it('zero and non-finite pass through', () => {
    expect(roundForDisplay(0, 'g')).toEqual({ value: 0, unit: 'g' });
    expect(roundForDisplay(Number.NaN, 'g').value).toBeNaN();
  });
  it('never rounds a positive amount to zero', () => {
    fc.assert(fc.property(fc.double({ min: 1e-6, max: 1e7, noNaN: true }), fc.constantFrom('g', 'ml', 'tsp', 'kg', 'item', 'floz', undefined), (v, u) => {
      expect(roundForDisplay(v, u as never).value).toBeGreaterThan(0);
    }));
  });
});

describe('formatNumber / formatQuantity', () => {
  it('uses fraction glyphs for spoons and counts only', () => {
    expect(formatNumber(1.5, 'tbsp')).toBe('1½');
    expect(formatNumber(0.25, 'tsp')).toBe('¼');
    expect(formatNumber(2.75, undefined)).toBe('2¾');
    expect(formatNumber(1.5, 'kg')).toBe('1.5');
    expect(formatNumber(2, 'tsp')).toBe('2');
  });
  it.each([
    [exact(750, 'ml'), '750ml'],
    [exact(1500, 'g'), '1.5kg'],
    [exact(3), '3'],
    [exact(1.5, 'tbsp'), '1½ tbsp'],
    [exact(2, 'cup'), '2 cups'],
    [exact(1, 'cup'), '1 cup'],
    [exact(2, 'clove'), '2 cloves'],
    [exact(1, 'item'), '1'],
    [exact(1, 'bunch'), '1 bunch'],
    [exact(2, 'floz'), '2 fl oz'],
    [range(2, 3, 'clove'), '2–3 cloves'],
    [range(900, 1100, 'g'), '900g–1.1kg'],
    [range(2.1, 2.2, 'g'), '2g'],
    [range(10, 12), '10–12'],
    [toTaste('salt to taste'), 'to taste'],
    [unparsed('a splodge of jam'), 'a splodge of jam'],
    [approx('pinch'), 'a pinch'],
    [approx('handful'), 'a handful'],
    [{ kind: 'approximate', approxLabel: 'egg', originalText: 'x' }, 'an egg'],
    [{ kind: 'approximate', originalText: 'some' }, 'a some'],
    [{ kind: 'approximate', approxLabel: 'pinch', value: 2, originalText: '2 pinches' }, '2 pinches'],
    [{ kind: 'approximate', approxLabel: 'pinch', value: 1, originalText: '1 pinch' }, 'a pinch'],
    [{ kind: 'approximate', approxLabel: 'handful', value: 3, originalText: '' }, '3 handfuls'],
    [{ kind: 'approximate', approxLabel: 'handful', min: 1, max: 2, originalText: '' }, '1–2 handfuls'],
    [{ kind: 'approximate', approxLabel: 'cm', value: 2, originalText: '' }, '2 cm'],
    [{ kind: 'approximate', approxLabel: 'inch', value: 2, originalText: '' }, '2 inches'],
    [{ kind: 'approximate', approxLabel: 'about', value: 200, unit: 'g', originalText: '' }, 'about 200g'],
    [{ kind: 'approximate', approxLabel: 'about', min: 1, max: 2, unit: 'kg', originalText: '' }, 'about 1–2kg'],
    [{ kind: 'approximate', approxLabel: 'heaped', value: 1, unit: 'tbsp', originalText: '' }, '1 tbsp (heaped)'],
    [{ kind: 'exact', originalText: 'raw' }, 'raw'],
    [{ kind: 'range', min: 1, originalText: 'raw range' }, 'raw range'],
  ] as Array<[Quantity, string]>)('%o -> %s', (q, s) => expect(formatQuantity(q)).toBe(s));
});
