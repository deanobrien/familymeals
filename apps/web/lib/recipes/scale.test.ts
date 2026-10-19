import { describe, expect, it } from 'vitest';
import { formatAmount, roundForDisplay, scaleQuantityLabel, servingsFactor } from './scale';
import type { Quantity } from './types';

const exact = (value: number, unit?: Quantity['unit']): Quantity => ({
  kind: 'exact',
  value,
  ...(unit ? { unit } : {}),
  originalText: `${value}`,
});

describe('roundForDisplay', () => {
  it('rounds metric amounts >= 100 to the nearest 5', () => {
    expect(roundForDisplay(403, 'g')).toBe(405);
    expect(roundForDisplay(612, 'ml')).toBe(610);
  });
  it('rounds mid amounts to whole numbers and small ones to quarters', () => {
    expect(roundForDisplay(33.4, 'g')).toBe(33);
    expect(roundForDisplay(2.6)).toBe(2.5);
    expect(roundForDisplay(1.1, 'tsp')).toBe(1);
  });
  it('never rounds a positive amount to zero', () => {
    expect(roundForDisplay(0.01, 'tsp')).toBe(0.125);
  });
});

describe('formatAmount', () => {
  it('uses unicode fractions', () => {
    expect(formatAmount(1.5)).toBe('1½');
    expect(formatAmount(0.25)).toBe('¼');
    expect(formatAmount(2.75)).toBe('2¾');
    expect(formatAmount(3)).toBe('3');
  });
});

describe('scaleQuantityLabel', () => {
  it('returns the display-rounded value, not raw floating point', () => {
    expect(scaleQuantityLabel(exact(400, 'g'), 1.5)).toBe('600 g');
    expect(scaleQuantityLabel(exact(3, 'clove'), 1.5)).toBe('4½ cloves');
    expect(scaleQuantityLabel(exact(1, 'tsp'), 1 / 3)).toBe('⅜ tsp');
  });
  it('promotes large metric amounts to kg / l', () => {
    expect(scaleQuantityLabel(exact(400, 'g'), 3)).toBe('1.2 kg');
    expect(scaleQuantityLabel(exact(500, 'ml'), 2)).toBe('1 l');
  });
  it('omits the unit for countable items and pluralises other count units', () => {
    expect(scaleQuantityLabel(exact(1, 'item'), 2)).toBe('2');
    expect(scaleQuantityLabel(exact(2, 'can'), 1)).toBe('2 cans');
    expect(scaleQuantityLabel(exact(1, 'bunch'), 1)).toBe('1 bunch');
  });
  it('scales ranges', () => {
    const q: Quantity = { kind: 'range', min: 2, max: 3, unit: 'tbsp', originalText: '2-3 tbsp' };
    expect(scaleQuantityLabel(q, 2)).toBe('4–6 tbsp');
  });
  it('leaves approximate, to-taste and unparsed quantities unchanged at any factor', () => {
    const pinch: Quantity = { kind: 'approximate', approxLabel: 'a pinch', originalText: 'a pinch' };
    const taste: Quantity = { kind: 'to_taste', originalText: 'salt to taste' };
    const odd: Quantity = { kind: 'unparsed', originalText: 'some 3ish bits' };
    for (const f of [0.5, 1, 4]) {
      expect(scaleQuantityLabel(pinch, f)).toBe('a pinch');
      expect(scaleQuantityLabel(taste, f)).toBe('to taste');
      expect(scaleQuantityLabel(odd, f)).toBe('some 3ish bits');
    }
  });
});

describe('servingsFactor', () => {
  it('is wanted / base and falls back to 1 for bad input', () => {
    expect(servingsFactor(4, 6)).toBe(1.5);
    expect(servingsFactor(0, 6)).toBe(1);
  });
});
