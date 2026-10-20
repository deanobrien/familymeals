import { describe, expect, it } from 'vitest';
import { parseStoredServings, resolveInitialServings, servingsOverrideKey } from './initial-servings';

describe('resolveInitialServings', () => {
  it('uses the household default, not the recipe', () => expect(resolveInitialServings(4)).toBe(4));
  it('a valid override wins', () => expect(resolveInitialServings(4, 6)).toBe(6));
  it('household default changes apply when there is no override', () => expect(resolveInitialServings(2)).toBe(2));
  it.each([0, -1, 2.5, 101, NaN, '4', null, undefined])('invalid household default %s falls back to 4', (v) =>
    expect(resolveInitialServings(v)).toBe(4));
  it.each([0, -3, 1.5, 1000, NaN, 'x', null])('invalid override %s is ignored', (v) =>
    expect(resolveInitialServings(3, v)).toBe(3));
});

describe('stored override', () => {
  it('parses integers in range only', () => {
    expect(parseStoredServings('6')).toBe(6);
    expect(parseStoredServings(null)).toBeUndefined();
    expect(parseStoredServings('0')).toBeUndefined();
    expect(parseStoredServings('6.5')).toBeUndefined();
    expect(parseStoredServings('abc')).toBeUndefined();
    expect(parseStoredServings('101')).toBeUndefined();
  });
  it('is keyed by household, member and recipe', () =>
    expect(servingsOverrideKey('h', 'u', 'r')).toBe('fr:servings:v1:h:u:r'));
});
