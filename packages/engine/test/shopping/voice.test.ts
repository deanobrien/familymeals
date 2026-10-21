import { describe, expect, it } from 'vitest';
import { MAX_SPOKEN_ITEMS, SPOKEN_UNITS, parseSpokenList, splitSpokenList } from '../../src/shopping/voice';

const brief = (t: string) => parseSpokenList(t).map((i) => ({ n: i.name, v: i.value, u: i.unit }));

describe('splitSpokenList', () => {
  it('splits on commas and "and", and drops the lead-in', () => {
    expect(splitSpokenList('add milk, two tins of tomatoes and eggs')).toEqual(['milk', 'two tins of tomatoes', 'eggs']);
  });
  it('handles polite and chatty lead-ins and trailing "to the list"', () => {
    expect(splitSpokenList('Can you please add bread and butter to the shopping list')).toEqual(['bread and butter']);
    expect(splitSpokenList("we need bananas and some milk please")).toEqual(['bananas', 'milk']);
    expect(splitSpokenList('okay, put cheese on my list.')).toEqual(['cheese']);
  });
  it('keeps "fish and chips" style phrases together', () => {
    expect(splitSpokenList('salt and pepper, fish and chips and peas')).toEqual(['salt and pepper', 'fish and chips', 'peas']);
  });
  it('splits on "then", "also", "plus" and newlines', () => {
    expect(splitSpokenList('rice then pasta also oats plus tea\ncoffee')).toEqual(['rice', 'pasta', 'oats', 'tea', 'coffee']);
  });
  it('returns nothing for silence or filler', () => {
    expect(splitSpokenList('')).toEqual([]);
    expect(splitSpokenList('   ')).toEqual([]);
    expect(splitSpokenList('please')).toEqual([]);
  });
});

describe('parseSpokenList', () => {
  it('reads the brief example with quantities and units', () => {
    expect(brief('add milk, two tins of tomatoes and eggs')).toEqual([
      { n: 'Milk', v: undefined, u: undefined },
      { n: 'Tomatoes', v: 2, u: 'can' },
      { n: 'Eggs', v: undefined, u: undefined },
    ]);
  });
  it('understands digits, number words, dozens and fractions', () => {
    expect(brief('3 bananas and a dozen eggs')).toEqual([
      { n: 'Bananas', v: 3, u: 'item' },
      { n: 'Eggs', v: 12, u: 'item' },
    ]);
    expect(brief('half a kilo of carrots, 500 grams of mince, two pints of milk')).toEqual([
      { n: 'Carrots', v: 0.5, u: 'kg' },
      { n: 'Mince', v: 500, u: 'g' },
      { n: 'Milk', v: 2, u: 'pint' },
    ]);
  });
  it('gives each item a stable key and the words it came from', () => {
    const items = parseSpokenList('two apples and pears');
    expect(items.map((i) => i.key)).toEqual(['v1', 'v2']);
    expect(items[0]!.text).toBe('two apples');
  });
  it('only emits units the shopping list accepts', () => {
    for (const i of parseSpokenList('a cup of rice, a bag of flour, 2 cloves of garlic, 3 slices of ham, 1 fl oz of cream')) {
      if (i.unit) expect(SPOKEN_UNITS).toContain(i.unit);
    }
    const rice = parseSpokenList('a cup of rice')[0]!;
    expect(rice.name).toBe('Rice');
    expect(rice.notes).toContain('cup');
  });
  it('uses the larger number of a range and says so', () => {
    const [r] = parseSpokenList('2-3 avocados');
    expect(r).toMatchObject({ name: 'Avocados', value: 3 });
    expect(r!.notes).toMatch(/2 to 3/);
  });
  it('records pack sizes as a note', () => {
    const [t] = parseSpokenList('2 x 400g tins of tomatoes');
    expect(t).toMatchObject({ name: 'Tomatoes', value: 2, unit: 'can' });
    expect(t!.notes).toMatch(/400 g each/);
  });
  it('treats an approximate amount as a note, not a number', () => {
    const [t] = parseSpokenList('a handful of spinach');
    expect(t!.value).toBeUndefined();
    expect(t!.notes).toBe('handful');
  });
  it('caps the number of items', () => {
    const many = Array.from({ length: 50 }, (_, i) => `item${String.fromCharCode(97 + (i % 26))}${i}`).join(', ');
    expect(parseSpokenList(many)).toHaveLength(MAX_SPOKEN_ITEMS);
  });
  it('never invents an item from numbers alone or empty text', () => {
    expect(parseSpokenList('')).toEqual([]);
    expect(parseSpokenList('12')).toEqual([]);
  });
});
