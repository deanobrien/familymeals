import { describe, expect, it } from 'vitest';
import type { CanonicalIngredient, Quantity } from '../../src/contract';
import { createGramsConverter, createQuantityConverter } from '../../src/units';

const onion: CanonicalIngredient = {
  id: 'onion',
  name: 'onion',
  category: 'fruit_veg',
  aliases: [],
  unitWeightG: { value: 150, source: 't', estimate: true },
};
const milk: CanonicalIngredient = {
  id: 'milk',
  name: 'milk',
  category: 'dairy_eggs',
  aliases: [],
  densityGPerMl: { value: 1.03, source: 't' },
};
const lookup = (id: string): CanonicalIngredient | undefined => (id === 'onion' ? onion : id === 'milk' ? milk : undefined);
const ex = (value: number, unit?: Quantity['unit']): Quantity => ({
  kind: 'exact',
  value,
  ...(unit ? { unit } : {}),
  originalText: '',
});

describe('createQuantityConverter', () => {
  const c = createQuantityConverter(lookup);
  it('converts within a dimension, using 568.26125 for the pint', () => {
    expect(c.convert(ex(1, 'kg'), 'g')?.value).toBe(1000);
    expect(c.convert(ex(1, 'pint'), 'ml')?.value).toBeCloseTo(568.26125, 8);
  });
  it('resolves ingredient ids for density and unit weight', () => {
    expect(c.convert(ex(100, 'ml'), 'g', 'milk')?.value).toBeCloseTo(103, 6);
    expect(c.convert(ex(2), 'g', 'onion')?.value).toBe(300);
    expect(c.convert(ex(2), 'g', onion)?.value).toBe(300);
  });
  it('returns null when unsafe', () => {
    expect(c.convert(ex(100, 'ml'), 'g')).toBeNull();
    expect(c.convert(ex(1, 'can'), 'g', 'onion')).toBeNull();
    expect(c.convert({ kind: 'approximate', approxLabel: 'pinch', originalText: '' }, 'g')).toBeNull();
    expect(c.convert(ex(1, 'g'), 'ml', 'unknown-id')).toBeNull();
  });
});

describe('createGramsConverter', () => {
  const c = createGramsConverter(lookup);
  it('flags estimate only when via unit weight', () => {
    expect(c.toGrams(undefined, ex(250, 'g'))).toEqual({ grams: 250, estimate: false });
    expect(c.toGrams('milk', ex(100, 'ml'))?.estimate).toBe(false);
    expect(c.toGrams('onion', ex(2))).toMatchObject({ grams: 300, estimate: true });
  });
  it('returns null for ranges, missing density and unknown ingredients', () => {
    expect(c.toGrams(undefined, { kind: 'range', min: 1, max: 2, unit: 'g', originalText: '' })).toBeNull();
    expect(c.toGrams(undefined, ex(100, 'ml'))).toBeNull();
    expect(c.toGrams('nope', ex(1))).toBeNull();
  });
});
