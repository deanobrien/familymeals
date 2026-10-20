import {
  UNCHECKED,
  blankForm,
  blankIngredient,
  buildInput,
  composeOriginal,
  formFromRecipe,
  linkSummary,
  move,
  toQuantity,
} from '@/lib/recipeForm';
import type { RecipeFull } from '@/lib/recipesApi';

const recipe: RecipeFull = {
  id: 'r1',
  title: 'Soup',
  description: 'Warm',
  imageUrl: 'hh/cover/id/cover.jpg',
  sourceAttribution: 'Nan',
  sourceUrl: '',
  originalText: '2 onions\nBoil.',
  prepMinutes: 10,
  cookMinutes: null,
  servings: 4,
  cuisine: 'British',
  mealType: 'lunch',
  diet: 'vegan',
  tags: ['quick', 'cheap'],
  ingredients: [
    { id: 'b', name: 'Stock', quantity: { kind: 'range', min: 1, max: 2, unit: 'l', originalText: '1-2 l' }, optional: true, order: 2 },
    { id: 'a', name: 'Onion', ingredientId: 'ing-onion', quantity: { kind: 'exact', value: 2, unit: 'item', originalText: '2 onions' }, preparation: 'diced', optional: false, order: 1 },
    { id: 'c', name: 'Salt', ingredientId: undefined, quantity: { kind: 'to_taste', originalText: 'to taste' }, optional: false, order: 3 },
  ],
  steps: [
    { id: 's2', order: 2, text: 'Serve.' },
    { id: 's1', order: 1, text: 'Boil.' },
  ],
  favourite: false,
  rating: null,
  updatedAt: 'x',
};

describe('toQuantity / composeOriginal', () => {
  it('builds each quantity kind and keeps the original text', () => {
    const d = { ...blankIngredient(), name: 'Flour', kind: 'exact' as const, value: '200', unit: 'g' as const };
    expect(toQuantity(d)).toEqual({ kind: 'exact', value: 200, unit: 'g', originalText: '200 g' });
    expect(toQuantity({ ...d, originalText: '200g plain' })).toMatchObject({ originalText: '200g plain' });
    expect(toQuantity({ ...d, kind: 'range', min: '1', max: '2', unit: 'tsp' })).toEqual({ kind: 'range', min: 1, max: 2, unit: 'tsp', originalText: '1-2 tsp' });
    expect(toQuantity({ ...d, kind: 'approximate', approxLabel: ' pinch ' })).toEqual({ kind: 'approximate', approxLabel: 'pinch', originalText: 'pinch' });
    expect(toQuantity({ ...d, kind: 'to_taste' })).toEqual({ kind: 'to_taste', originalText: 'to taste' });
    expect(toQuantity({ ...d, kind: 'unparsed', name: 'a glug of oil' })).toEqual({ kind: 'unparsed', originalText: 'a glug of oil' });
    expect(composeOriginal({ ...d, unit: 'item' })).toBe('200');
  });
});

describe('formFromRecipe', () => {
  it('orders lines and steps, and carries link names for linked lines only', () => {
    const f = formFromRecipe(recipe, { 'ing-onion': 'Onion (brown)' });
    expect(f.ingredients.map((i) => i.name)).toEqual(['Onion', 'Stock', 'Salt']);
    expect(f.steps.map((s) => s.text)).toEqual(['Boil.', 'Serve.']);
    expect(f.ingredients[0]!.link).toMatchObject({ ingredientId: 'ing-onion', linkedName: 'Onion (brown)', checked: true });
    // a saved unlinked line is not re-matched until asked (it may be a deliberate "not in list")
    expect(f.ingredients[2]!.link).toMatchObject({ ingredientId: undefined, checked: true });
    expect(f.tags).toBe('quick, cheap');
    expect(f.imageUrl).toBe('hh/cover/id/cover.jpg');
  });
  it('a copy gets a marked title and drops the cover and the verbatim original text', () => {
    const f = formFromRecipe(recipe, {}, true);
    expect(f.title).toBe('Soup (copy)');
    expect(f.imageUrl).toBeNull();
    expect(f.originalText).toBe('');
  });
});

describe('buildInput', () => {
  it('sends links as chosen: id, explicit null ("not in list") or absent (match automatically)', () => {
    const f = formFromRecipe(recipe, {});
    f.ingredients[1]!.link = { ingredientId: null, ambiguous: false, candidates: [], checked: true };
    const input = buildInput(f);
    expect(input.ingredients[0]).toMatchObject({ name: 'Onion', ingredientId: 'ing-onion', preparation: 'diced', optional: false });
    expect(input.ingredients[1]).toMatchObject({ name: 'Stock', ingredientId: null, optional: true });
    expect('ingredientId' in input.ingredients[2]!).toBe(false);
    expect(input.steps).toEqual(['Boil.', 'Serve.']);
    expect(input.tags).toEqual(['quick', 'cheap']);
    expect(input.prepMinutes).toBe(10);
    expect(input.cookMinutes).toBeNull();
    expect(input.imageUrl).toBe('hh/cover/id/cover.jpg');
    expect(input.originalText).toBe('2 onions\nBoil.');
  });
  it('trims and turns an empty servings box into 0 so the server can say "At least 1 serving"', () => {
    const f = blankForm();
    f.title = '  Tea ';
    f.servings = '';
    expect(buildInput(f)).toMatchObject({ title: 'Tea', servings: 0 });
  });
});

describe('helpers', () => {
  it('moves items and ignores out-of-range moves', () => {
    expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(move(['a', 'b', 'c'], 2, 3)).toEqual(['a', 'b', 'c']);
  });
  it('summarises the link state for the control', () => {
    expect(linkSummary(UNCHECKED, false)).toBe('Matched to: (enter a name)');
    expect(linkSummary(UNCHECKED, true)).toBe('Matching...');
    expect(linkSummary({ ...UNCHECKED, checked: true }, true)).toBe('Not matched yet');
    expect(linkSummary({ ...UNCHECKED, checked: true, candidates: [{ id: '1', name: 'A' }] }, true)).toBe('Pick a match (1 suggested)');
    expect(linkSummary({ ...UNCHECKED, checked: true, ambiguous: true, candidates: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }] }, true)).toBe('Pick a match (2 possible)');
    expect(linkSummary({ ...UNCHECKED, ingredientId: 'x', linkedName: 'Onion' }, true)).toBe('Matched to: Onion');
    expect(linkSummary({ ...UNCHECKED, ingredientId: null }, true)).toBe('Not in the ingredient list');
  });
});
