import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Quantity } from '@fr/domain';
import {
  FALLBACK_HOUSEHOLD_SERVINGS,
  loadServingsOverride,
  parseStoredServings,
  resolveInitialServings,
  saveServingsOverride,
  scaledAmount,
  servingsOverrideKey,
  validServings,
} from '@/lib/servings';

const exact = (value: number, unit: Quantity['unit'], originalText = ''): Quantity => ({ kind: 'exact', value, unit, originalText });

describe('household-default servings (same rules as the web)', () => {
  it('opens at the override, else the household default, else 4 - never the recipe servings', () => {
    expect(resolveInitialServings(6)).toBe(6);
    expect(resolveInitialServings(6, 2)).toBe(2);
    expect(resolveInitialServings(undefined)).toBe(FALLBACK_HOUSEHOLD_SERVINGS);
    expect(resolveInitialServings(0)).toBe(4);
    expect(resolveInitialServings(6, 1000)).toBe(6); // invalid override ignored
  });
  it('validates and parses stored values strictly', () => {
    expect(validServings(3)).toBe(true);
    expect(validServings(0)).toBe(false);
    expect(validServings(2.5)).toBe(false);
    expect(parseStoredServings('5')).toBe(5);
    expect(parseStoredServings('5.5')).toBeUndefined();
    expect(parseStoredServings('-1')).toBeUndefined();
    expect(parseStoredServings(null)).toBeUndefined();
    expect(parseStoredServings('101')).toBeUndefined();
  });
  it('keys the override per household, member and recipe (same key as the web)', () => {
    expect(servingsOverrideKey('h', 'u', 'r')).toBe('fr:servings:v1:h:u:r');
  });
});

describe('per-recipe override in AsyncStorage', () => {
  beforeEach(() => AsyncStorage.clear());
  it('round-trips and clears', async () => {
    const key = servingsOverrideKey('h', 'u', 'r');
    expect(await loadServingsOverride(key)).toBeUndefined();
    await saveServingsOverride(key, 7);
    expect(await loadServingsOverride(key)).toBe(7);
    await saveServingsOverride(key, null);
    expect(await loadServingsOverride(key)).toBeUndefined();
  });
  it('ignores a corrupted value', async () => {
    const key = servingsOverrideKey('h', 'u', 'r');
    await AsyncStorage.setItem(key, 'lots');
    expect(await loadServingsOverride(key)).toBeUndefined();
  });
});

describe('scaledAmount (engine scale rules)', () => {
  it('scales exact amounts and rounds for easy measuring', () => {
    expect(scaledAmount(exact(200, 'g'), 4, 2)).toBe('100g');
    expect(scaledAmount(exact(500, 'g'), 4, 8)).toBe('1kg');
    expect(scaledAmount(exact(1, 'tsp'), 4, 6)).toBe('1½ tsp');
    expect(scaledAmount(exact(2, 'clove'), 2, 3)).toBe('3 cloves');
  });
  it('scales ranges at both ends', () => {
    expect(scaledAmount({ kind: 'range', min: 2, max: 3, unit: 'tbsp', originalText: '2-3 tbsp' }, 2, 4)).toBe('4–6 tbsp');
  });
  it('leaves to-taste, pinch and unparsed amounts unchanged', () => {
    expect(scaledAmount({ kind: 'to_taste', originalText: 'to taste' }, 4, 8)).toBe('to taste');
    expect(scaledAmount({ kind: 'approximate', approxLabel: 'pinch', originalText: 'a pinch' }, 4, 8)).toBe('a pinch');
    expect(scaledAmount({ kind: 'unparsed', originalText: 'a glug' }, 4, 8)).toBe('a glug');
  });
  it('shows the stored amount unchanged when the servings match', () => {
    expect(scaledAmount(exact(250, 'g'), 4, 4)).toBe('250g');
  });
});
