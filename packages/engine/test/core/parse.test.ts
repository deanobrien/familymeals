import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { normaliseLineText, parseIngredientLine } from '../../src/parse';
import type { Quantity } from '../../src/contract';

type Expect = { q: Partial<Quantity>; name: string; prep?: string; optional?: boolean; notes?: string[] };

const CASES: Array<[string, Expect]> = [
  // counts & fractions
  ['2 onions', { q: { kind: 'exact', value: 2, unit: undefined }, name: 'onions' }],
  ['1 onion, finely chopped', { q: { kind: 'exact', value: 1 }, name: 'onion', prep: 'finely chopped' }],
  ['½ tsp salt', { q: { kind: 'exact', value: 0.5, unit: 'tsp' }, name: 'salt' }],
  ['1 ½ tbsp olive oil', { q: { kind: 'exact', value: 1.5, unit: 'tbsp' }, name: 'olive oil' }],
  ['1½ cups milk', { q: { kind: 'exact', value: 1.5, unit: 'cup' }, name: 'milk' }],
  ['1/2 cup sugar', { q: { kind: 'exact', value: 0.5, unit: 'cup' }, name: 'sugar' }],
  ['1 1/2 tsp baking powder', { q: { kind: 'exact', value: 1.5, unit: 'tsp' }, name: 'baking powder' }],
  ['¾ cup cream', { q: { kind: 'exact', value: 0.75, unit: 'cup' }, name: 'cream' }],
  ['1 ⁄ 2 tsp cumin', { q: { kind: 'exact', value: 0.5, unit: 'tsp' }, name: 'cumin' }],
  ['0.5 tsp salt', { q: { kind: 'exact', value: 0.5, unit: 'tsp' }, name: 'salt' }],
  ['.5 tsp salt', { q: { kind: 'exact', value: 0.5, unit: 'tsp' }, name: 'salt' }],
  ['half a lemon', { q: { kind: 'exact', value: 0.5 }, name: 'lemon' }],
  ['a dozen eggs', { q: { kind: 'exact', value: 12 }, name: 'eggs' }],
  ['2 dozen eggs', { q: { kind: 'exact', value: 24 }, name: 'eggs' }],
  ['one onion', { q: { kind: 'exact', value: 1 }, name: 'onion' }],
  ['an apple', { q: { kind: 'exact', value: 1 }, name: 'apple' }],
  ['three carrots', { q: { kind: 'exact', value: 3 }, name: 'carrots' }],
  ['1 large onion', { q: { kind: 'exact', value: 1 }, name: 'large onion' }],
  ['- 2 eggs', { q: { kind: 'exact', value: 2 }, name: 'eggs' }],
  ['• 100g butter, softened', { q: { kind: 'exact', value: 100, unit: 'g' }, name: 'butter', prep: 'softened' }],
  // ranges
  ['2-3 cloves garlic, crushed', { q: { kind: 'range', min: 2, max: 3, unit: 'clove' }, name: 'garlic', prep: 'crushed' }],
  ['2 to 3 carrots', { q: { kind: 'range', min: 2, max: 3 }, name: 'carrots' }],
  ['1 or 2 red chillies', { q: { kind: 'range', min: 1, max: 2 }, name: 'red chillies' }],
  ['1kg-1.2kg potatoes', { q: { kind: 'range', min: 1, max: 1.2, unit: 'kg' }, name: 'potatoes' }],
  ['1 kg - 1.2 kg potatoes', { q: { kind: 'range', min: 1, max: 1.2, unit: 'kg' }, name: 'potatoes' }],
  ['10–12 cherry tomatoes', { q: { kind: 'range', min: 10, max: 12 }, name: 'cherry tomatoes' }],
  ['1-2 tbsp honey', { q: { kind: 'range', min: 1, max: 2, unit: 'tbsp' }, name: 'honey' }],
  ['3-2 apples', { q: { kind: 'range', min: 2, max: 3 }, name: 'apples' }],
  ['2-2 apples', { q: { kind: 'exact', value: 2 }, name: 'apples' }],
  ['1 - chopped onion', { q: { kind: 'exact', value: 1 }, name: 'chopped onion' }],
  // approximate / to taste
  ['a pinch of salt', { q: { kind: 'approximate', approxLabel: 'pinch', value: undefined, unit: undefined }, name: 'salt' }],
  ['pinch of salt', { q: { kind: 'approximate', approxLabel: 'pinch' }, name: 'salt' }],
  ['salt, a pinch', { q: { kind: 'approximate', approxLabel: 'pinch' }, name: 'salt' }],
  ['2 pinches nutmeg', { q: { kind: 'approximate', approxLabel: 'pinch', value: 2 }, name: 'nutmeg' }],
  ['a small handful of spinach', { q: { kind: 'approximate', approxLabel: 'handful' }, name: 'spinach' }],
  ['a few sprigs of thyme', { q: { kind: 'approximate', approxLabel: 'few', unit: 'sprig' }, name: 'thyme' }],
  ['a couple of cloves garlic', { q: { kind: 'approximate', approxLabel: 'couple', unit: 'clove' }, name: 'garlic' }],
  ['a knob of butter', { q: { kind: 'approximate', approxLabel: 'knob' }, name: 'butter' }],
  ['salt to taste', { q: { kind: 'to_taste' }, name: 'salt' }],
  ['salt and pepper, to taste', { q: { kind: 'to_taste' }, name: 'salt and pepper' }],
  ['1 tsp salt, or to taste', { q: { kind: 'exact', value: 1, unit: 'tsp' }, name: 'salt', notes: ['to taste'] }],
  ['a pinch of salt, to taste', { q: { kind: 'approximate', approxLabel: 'pinch' }, name: 'salt', notes: ['to taste'] }],
  ['1 heaped tbsp sugar', { q: { kind: 'approximate', approxLabel: 'heaped', value: 1, unit: 'tbsp' }, name: 'sugar' }],
  ['1 rounded tsp mustard', { q: { kind: 'approximate', approxLabel: 'rounded', value: 1, unit: 'tsp' }, name: 'mustard' }],
  ['1 level tsp bicarbonate of soda', { q: { kind: 'exact', value: 1, unit: 'tsp' }, name: 'bicarbonate of soda' }],
  ['1-2 heaped tsp sugar', { q: { kind: 'approximate', approxLabel: 'heaped', min: 1, max: 2, unit: 'tsp' }, name: 'sugar' }],
  ['about 200g flour', { q: { kind: 'approximate', approxLabel: 'about', value: 200, unit: 'g' }, name: 'flour' }],
  ['approx. 1-2 kg potatoes', { q: { kind: 'approximate', approxLabel: 'about', min: 1, max: 2, unit: 'kg' }, name: 'potatoes' }],
  ['~ 3 onions', { q: { kind: 'approximate', approxLabel: 'about', value: 3 }, name: 'onions' }],
  ['2cm piece ginger, grated', { q: { kind: 'approximate', approxLabel: 'cm', value: 2 }, name: 'ginger', prep: 'grated' }],
  ['1 inch piece of ginger', { q: { kind: 'approximate', approxLabel: 'inch', value: 1 }, name: 'ginger' }],
  ['5mm slice lemon', { q: { kind: 'approximate', approxLabel: 'mm', value: 5 }, name: 'slice lemon' }],
  // packs: "x 400g can"
  ['2 x 400g cans chopped tomatoes', { q: { kind: 'exact', value: 2, unit: 'can' }, name: 'chopped tomatoes' }],
  ['1 x 400g tin chickpeas, drained', { q: { kind: 'exact', value: 1, unit: 'can' }, name: 'chickpeas', prep: 'drained' }],
  ['2 (400g) cans tomatoes', { q: { kind: 'exact', value: 2, unit: 'can' }, name: 'tomatoes' }],
  ['a 400g can coconut milk', { q: { kind: 'exact', value: 1, unit: 'can' }, name: 'coconut milk' }],
  ['400g can chopped tomatoes', { q: { kind: 'exact', value: 1, unit: 'can' }, name: 'chopped tomatoes' }],
  ['2 x 400g chopped tomatoes', { q: { kind: 'exact', value: 800, unit: 'g' }, name: 'chopped tomatoes' }],
  ['1 x 500g pack spaghetti', { q: { kind: 'exact', value: 1, unit: 'pack' }, name: 'spaghetti' }],
  ['3 x tomatoes', { q: { kind: 'exact', value: 3 }, name: 'x tomatoes' }],
  // metric / imperial
  ['250ml milk', { q: { kind: 'exact', value: 250, unit: 'ml' }, name: 'milk' }],
  ['1.5kg chicken thighs', { q: { kind: 'exact', value: 1.5, unit: 'kg' }, name: 'chicken thighs' }],
  ['200 gr pasta', { q: { kind: 'exact', value: 200, unit: 'g' }, name: 'pasta' }],
  ['500 grams beef', { q: { kind: 'exact', value: 500, unit: 'g' }, name: 'beef' }],
  ['10mg saffron', { q: { kind: 'exact', value: 10, unit: 'mg' }, name: 'saffron' }],
  ['1 litre stock', { q: { kind: 'exact', value: 1, unit: 'l' }, name: 'stock' }],
  ['5 cl rum', { q: { kind: 'exact', value: 50, unit: 'ml' }, name: 'rum' }],
  ['2 dl cream', { q: { kind: 'exact', value: 200, unit: 'ml' }, name: 'cream' }],
  ['8oz butter', { q: { kind: 'exact', value: 226.796185, unit: 'g' }, name: 'butter' }],
  ['1 lb beef mince', { q: { kind: 'exact', value: 453.59237, unit: 'g' }, name: 'beef mince' }],
  ['2 fl oz cream', { q: { kind: 'exact', value: 2, unit: 'floz' }, name: 'cream' }],
  ['1 pint milk', { q: { kind: 'exact', value: 1, unit: 'pint' }, name: 'milk' }],
  ['1 quart water', { q: { kind: 'exact', value: 2, unit: 'pint' }, name: 'water' }],
  ['1 gallon water', { q: { kind: 'exact', value: 8, unit: 'pint' }, name: 'water' }],
  ['2 tablespoons butter', { q: { kind: 'exact', value: 2, unit: 'tbsp' }, name: 'butter' }],
  ['2 tbsp. soy sauce', { q: { kind: 'exact', value: 2, unit: 'tbsp' }, name: 'soy sauce' }],
  ['3 teaspoons sugar', { q: { kind: 'exact', value: 3, unit: 'tsp' }, name: 'sugar' }],
  // count units
  ['3 garlic cloves', { q: { kind: 'exact', value: 3, unit: 'clove' }, name: 'garlic' }],
  ['1 head of garlic', { q: { kind: 'exact', value: 1, unit: 'item' }, name: 'garlic' }],
  ['3 tins of tuna', { q: { kind: 'exact', value: 3, unit: 'can' }, name: 'tuna' }],
  ['6 slices bacon', { q: { kind: 'exact', value: 6, unit: 'slice' }, name: 'bacon' }],
  ['1 bunch spring onions', { q: { kind: 'exact', value: 1, unit: 'bunch' }, name: 'spring onions' }],
  ['2 sticks celery', { q: { kind: 'exact', value: 2, unit: 'stick' }, name: 'celery' }],
  ['2 celery stalks', { q: { kind: 'exact', value: 2, unit: 'stick' }, name: 'celery' }],
  ['1 jar pesto', { q: { kind: 'exact', value: 1, unit: 'pack' }, name: 'pesto' }],
  ['1 whole chicken', { q: { kind: 'exact', value: 1, unit: 'item' }, name: 'chicken' }],
  ['4 chicken breasts', { q: { kind: 'exact', value: 4 }, name: 'chicken breasts' }],
  ['1 medium can tomatoes', { q: { kind: 'exact', value: 1, unit: 'can' }, name: 'tomatoes' }],
  // words that start like units must not be eaten
  ['2 garlic bulbs', { q: { kind: 'exact', value: 2 }, name: 'garlic bulbs' }],
  ['1 lemon', { q: { kind: 'exact', value: 1 }, name: 'lemon' }],
  ['1 tomato', { q: { kind: 'exact', value: 1 }, name: 'tomato' }],
  ['1 orange', { q: { kind: 'exact', value: 1 }, name: 'orange' }],
  ['2 tangerines', { q: { kind: 'exact', value: 2 }, name: 'tangerines' }],
  ['1 cupcake case', { q: { kind: 'exact', value: 1 }, name: 'cupcake case' }],
  // preparation & forms
  ['100 g ground coriander', { q: { kind: 'exact', value: 100, unit: 'g' }, name: 'ground coriander' }],
  ['1 tsp ground cumin', { q: { kind: 'exact', value: 1, unit: 'tsp' }, name: 'ground cumin' }],
  ['400g chopped tomatoes', { q: { kind: 'exact', value: 400, unit: 'g' }, name: 'chopped tomatoes' }],
  ['2 finely chopped onions', { q: { kind: 'exact', value: 2 }, name: 'onions', prep: 'finely chopped' }],
  ['2 finely chopped onions, peeled', { q: { kind: 'exact', value: 2 }, name: 'onions', prep: 'finely chopped, peeled' }],
  ['200g (7oz) plain flour', { q: { kind: 'exact', value: 200, unit: 'g' }, name: 'plain flour', notes: ['7oz'] }],
  ['1 onion (about 150g), diced', { q: { kind: 'exact', value: 1 }, name: 'onion', prep: 'diced', notes: ['about 150g'] }],
  // optional
  ['1 tbsp chilli flakes, optional', { q: { kind: 'exact', value: 1, unit: 'tbsp' }, name: 'chilli flakes', optional: true }],
  ['optional: 2 tbsp honey', { q: { kind: 'exact', value: 2, unit: 'tbsp' }, name: 'honey', optional: true }],
  ['50g walnuts (optional)', { q: { kind: 'exact', value: 50, unit: 'g' }, name: 'walnuts', optional: true }],
  ['1 tsp sugar (if desired)', { q: { kind: 'exact', value: 1, unit: 'tsp' }, name: 'sugar', optional: true }],
  ['fresh coriander, to serve (optional)', { q: { kind: 'unparsed' }, name: 'fresh coriander', prep: 'to serve', optional: true }],
  // unparsed — never invent an amount
  ['salt', { q: { kind: 'unparsed' }, name: 'salt' }],
  ['', { q: { kind: 'unparsed' }, name: '' }],
  ['   ', { q: { kind: 'unparsed' }, name: '' }],
  ['!!!', { q: { kind: 'unparsed' }, name: '!!!' }],
  ['2', { q: { kind: 'unparsed' }, name: '' }],
  ['200g', { q: { kind: 'unparsed' }, name: '' }],
  ['to taste', { q: { kind: 'unparsed' }, name: '' }],
  ['a pinch', { q: { kind: 'unparsed' }, name: '' }],
  ['1/0 cup flour', { q: { kind: 'unparsed' }, name: 'flour' }],
  ['2kg-3l nonsense', { q: { kind: 'unparsed' }, name: '2kg-3l nonsense' }],
  ['finely chopped parsley', { q: { kind: 'unparsed' }, name: 'parsley', prep: 'finely chopped' }],
];

describe('parseIngredientLine — table', () => {
  it.each(CASES)('%s', (text, e) => {
    const r = parseIngredientLine(text);
    for (const [k, v] of Object.entries(e.q)) expect(r.quantity[k as keyof Quantity], `quantity.${k}`).toEqual(v);
    expect(r.quantity.originalText).toBe(text);
    expect(r.name).toBe(e.name);
    expect(r.preparation).toBe(e.prep);
    expect(r.optional).toBe(e.optional ?? false);
    if (e.notes) expect(r.notes).toEqual(e.notes);
  });
});

describe('parseIngredientLine — packs', () => {
  it('records pack count and size for "2 x 400g cans"', () => {
    const r = parseIngredientLine('2 x 400g cans chopped tomatoes');
    expect(r.pack).toEqual({ count: 2, size: { kind: 'exact', value: 400, unit: 'g', originalText: '2 x 400g cans chopped tomatoes' } });
  });
  it('records pack for container-less multiplication', () => {
    expect(parseIngredientLine('2 x 400g chopped tomatoes').pack?.count).toBe(2);
  });
  it('converts imperial pack sizes', () => {
    const r = parseIngredientLine('1 x 14oz can beans');
    expect(r.pack?.size.unit).toBe('g');
    expect(r.pack?.size.value).toBeCloseTo(396.893, 3);
  });
  it('supports volume pack sizes', () => {
    expect(parseIngredientLine('1 x 500ml carton stock').pack?.size).toMatchObject({ value: 500, unit: 'ml' });
  });
  it('has no pack for plain lines', () => {
    expect(parseIngredientLine('2 onions').pack).toBeUndefined();
  });
});

describe('normaliseLineText', () => {
  it('maps unicode fractions, dashes and whitespace', () => {
    expect(normaliseLineText('1½  Cups')).toBe('1 1/2 cups');
    expect(normaliseLineText('2–3')).toBe('2-3');
    expect(normaliseLineText('1 / 2')).toBe('1/2');
    expect(normaliseLineText('• Eggs')).toBe('eggs');
  });
});

describe('parseIngredientLine — invariants (property)', () => {
  it('never throws and always preserves originalText', () => {
    fc.assert(fc.property(fc.string({ maxLength: 60 }), (s) => {
      const r = parseIngredientLine(s);
      expect(r.quantity.originalText).toBe(s);
    }), { numRuns: 2000 });
  });
  it('numeric results are finite, non-negative and ordered', () => {
    const alphabet = fc.constantFrom(...'0123456789 /-½¼x.gkmltspcuoz abcxyz,()'.split(''));
    fc.assert(fc.property(fc.array(alphabet, { maxLength: 30 }).map((a) => a.join('')), (s) => {
      const q = parseIngredientLine(s).quantity;
      for (const n of [q.value, q.min, q.max]) if (n !== undefined) expect(Number.isFinite(n) && n >= 0).toBe(true);
      if (q.kind === 'range') expect(q.min!).toBeLessThan(q.max!);
      if (q.kind === 'to_taste' || q.kind === 'unparsed') {
        expect(q.value).toBeUndefined();
        expect(q.unit).toBeUndefined();
      }
    }), { numRuns: 2000 });
  });
  it('round-trips "<n>g <name>" for any positive integer', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 100000 }), (n) => {
      const r = parseIngredientLine(`${n}g sugar`);
      expect(r.quantity).toMatchObject({ kind: 'exact', value: n, unit: 'g' });
      expect(r.name).toBe('sugar');
    }));
  });
  it('a pinch is never given a weight or unit', () => {
    for (const t of ['a pinch of salt', 'pinch salt', 'a large pinch of sea salt', 'salt, a pinch']) {
      const q = parseIngredientLine(t).quantity;
      expect(q.kind).toBe('approximate');
      expect(q.unit).toBeUndefined();
      expect(q.value).toBeUndefined();
    }
  });
});
