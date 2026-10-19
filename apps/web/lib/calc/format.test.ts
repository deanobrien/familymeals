import { describe, expect, it } from 'vitest';
import { nutrientCell, printedKey, printedNutritionOf } from './format';

describe('nutrientCell', () => {
  it('shows numbers only for known/zero and never renders unknown as 0', () => {
    expect(nutrientCell({ status: 'known', value: 12.34, unit: 'g', estimate: true })).toMatchObject({ text: '12.3 g', unknown: false, estimate: true });
    expect(nutrientCell({ status: 'known', value: 12.34, unit: 'g', estimate: false }, 4).text).toBe('49.4 g');
    expect(nutrientCell({ status: 'zero', value: 0, unit: 'g', estimate: false }).text).toBe('0 g');
    expect(nutrientCell({ status: 'unknown', unit: 'g', estimate: false })).toMatchObject({ text: 'Unknown', unknown: true });
    expect(nutrientCell({ status: 'unavailable', unit: 'g', estimate: false }).text).toBe('—');
    expect(nutrientCell(undefined).text).toBe('Unknown');
  });
  it('gives the known-so-far lower bound as a note, not as the value', () => {
    const c = nutrientCell({ status: 'unknown', unit: 'kcal', estimate: false, incomplete: true, lowerBound: 400 }, 2);
    expect(c.text).toBe('Unknown');
    expect(c.note).toBe('at least 800 kcal from the known ingredients');
  });
});

describe('printed nutrition (field from the import lane, feature-detected)', () => {
  it('is null when the field is absent or malformed', () => {
    expect(printedNutritionOf({ title: 'x' })).toBeNull();
    expect(printedNutritionOf({ printedNutrition: { basis: 'per person', values: [] } })).toBeNull();
    expect(printedNutritionOf({ printedNutrition: 'nope' })).toBeNull();
  });
  it('is returned as printed when present', () => {
    const p = { basis: 'per person', values: [{ nutrient: 'Calories', amount: 822, unit: 'kcal' }], note: 'supplied ingredients only' };
    expect(printedNutritionOf({ printedNutrition: p })).toEqual(p);
  });
  it('maps printed names to nutrient keys and ignores kJ', () => {
    expect(printedKey('Calories', 'kcal')).toBe('energy_kcal');
    expect(printedKey('Energy', 'kJ')).toBeNull();
    expect(printedKey('Sat fat', 'g')).toBe('saturates');
    expect(printedKey('Fat', 'g')).toBe('fat');
    expect(printedKey('Carbs', 'g')).toBe('carbohydrate');
    expect(printedKey('Sugar', 'g')).toBe('sugars');
    expect(printedKey('Mystery', 'g')).toBeNull();
  });
});
