// Original synthetic recipes. Image pages are rendered from this same data, so image and
// expected JSON cannot drift. Content is original (no copyrighted recipes).
import type { z } from 'zod';
import type { Unit, Quantity, ExtractedIngredient } from './contract.js';

type Q = z.infer<typeof Quantity>;
type U = z.infer<typeof Unit>;
type Ing = z.input<typeof ExtractedIngredient>;

const ex = (value: number, unit: U | undefined, originalText: string): Q => ({ kind: 'exact', value, ...(unit ? { unit } : {}), originalText });
const rg = (min: number, max: number, unit: U | undefined, originalText: string): Q => ({ kind: 'range', min, max, ...(unit ? { unit } : {}), originalText });
const ap = (approxLabel: string, originalText: string): Q => ({ kind: 'approximate', approxLabel, originalText });
const tt = (originalText: string): Q => ({ kind: 'to_taste', originalText });
const i = (name: string, quantity: Q, preparation?: string, optional = false): Ing => ({ name, quantity, ...(preparation ? { preparation } : {}), optional });

export interface RecipeDef {
  slug: string; title: string; servings?: number; scenario: string;
  diet: 'meat' | 'fish' | 'vegetarian' | 'vegan';
  style: 'clean' | 'blurry';
  /** Lines of text per page; ingredient/step text is what is printed. */
  pages: { heading: string; lines: string[] }[];
  ingredients: Ing[]; steps: string[];
}

const line = (x: Ing) => x.quantity.originalText + ' ' + x.name + (x.preparation ? ', ' + x.preparation : '') + (x.optional ? ' (optional)' : '');
const stepLines = (ss: string[]) => ss.map((s, n) => `${n + 1}. ${s}`);

function def(r: Omit<RecipeDef, 'pages'> & { split?: number }): RecipeDef {
  const il = r.ingredients.map(line), sl = stepLines(r.steps);
  const pages = r.split !== undefined
    ? [{ heading: r.title, lines: ['Serves ' + r.servings, '', 'INGREDIENTS', ...il.slice(0, r.split), '(continued overleaf)'] },
       { heading: r.title + ' (page 2)', lines: [...il.slice(r.split), '', 'METHOD', ...sl] }]
    : [{ heading: r.title, lines: [r.servings ? 'Serves ' + r.servings : '', '', 'INGREDIENTS', ...il, '', 'METHOD', ...sl] }];
  const { split, ...rest } = r;
  void split;
  return { ...rest, pages };
}

export const RECIPES: RecipeDef[] = [
  def({ slug: '01-tomato-pasta', title: 'Sunday Tomato Pasta', servings: 4, diet: 'vegan', style: 'clean',
    scenario: 'Clean typed single page, metric units, preparation notes',
    ingredients: [
      i('spaghetti', ex(400, 'g', '400 g')), i('tinned chopped tomatoes', ex(2, 'can', '2 x 400 g tins')),
      i('garlic', ex(3, 'clove', '3 cloves'), 'finely sliced'), i('olive oil', ex(2, 'tbsp', '2 tbsp')),
      i('onion', ex(1, 'item', '1 large'), 'diced'), i('dried oregano', ex(1, 'tsp', '1 tsp')), i('fresh basil', ex(1, 'bunch', '1 small bunch'), undefined, true),
    ],
    steps: ['Soften the onion in oil for 8 minutes.', 'Add garlic, oregano and tomatoes; simmer 20 minutes.', 'Boil the spaghetti, drain and toss through the sauce.'] }),
  def({ slug: '02-lemon-loaf', title: 'Lemon Drizzle Loaf', servings: 8, diet: 'vegetarian', style: 'clean',
    scenario: 'Imperial units (oz, floz) that must convert to canonical g/ml on extraction',
    ingredients: [
      i('self-raising flour', ex(227, 'g', '8 oz')), i('caster sugar', ex(170, 'g', '6 oz')), i('butter', ex(113, 'g', '4 oz'), 'softened'),
      i('eggs', ex(2, 'item', '2')), i('lemons', ex(2, 'item', '2'), 'zest and juice'), i('milk', ex(60, 'ml', '2 floz')), i('icing sugar', ex(100, 'g', '3.5 oz')),
    ],
    steps: ['Cream the butter and caster sugar until pale.', 'Beat in eggs, zest, flour and milk.', 'Bake at 180C for 45 minutes.', 'Mix lemon juice with icing sugar and pour over the warm loaf.'] }),
  def({ slug: '03-beef-stew-two-page', title: 'Slow Winter Beef Stew', servings: 6, diet: 'meat', style: 'clean', split: 5,
    scenario: 'TWO-PAGE recipe: ingredients continue on page 2; merge into one recipe',
    ingredients: [
      i('braising beef', ex(900, 'g', '900 g'), 'cut into chunks'), i('carrots', ex(4, 'item', '4'), 'sliced'), i('onions', ex(2, 'item', '2'), 'quartered'),
      i('beef stock', ex(750, 'ml', '750 ml')), i('plain flour', ex(2, 'tbsp', '2 tbsp')), i('potatoes', ex(500, 'g', '500 g'), 'peeled and chunked'),
      i('bay leaves', ex(2, 'item', '2')), i('thyme', ex(4, 'sprig', '4 sprigs')), i('tomato puree', ex(1, 'tbsp', '1 tbsp')), i('vegetable oil', ex(1, 'tbsp', '1 tbsp')),
    ],
    steps: ['Toss beef in flour and brown in oil.', 'Add vegetables, stock, puree and herbs.', 'Cook covered at 150C for 3 hours.', 'Season and serve with greens.'] }),
  def({ slug: '04-fractions-ranges', title: 'Gran’s Fiddly Flapjacks & Soup', servings: 6, diet: 'vegetarian', style: 'clean',
    scenario: 'Unicode fractions, ranges, "a pinch", "to taste", unitless counts, approximate vs to_taste',
    ingredients: [
      i('rolled oats', ex(1.5, 'cup', '1½ cups')), i('butter', ex(0.75, 'cup', '¾ cup'), 'melted'), i('garlic', rg(2, 3, 'clove', '2-3 cloves'), 'crushed'),
      i('golden syrup', ex(0.5, 'tsp', '½ tsp')), i('flaked sea salt', ap('pinch', 'a pinch')), i('chilli flakes', ap('dash', 'a dash'), undefined, true),
      i('black pepper', tt('to taste')), i('onions', rg(1, 2, 'item', '1 to 2')), i('vegetable stock', rg(500, 750, 'ml', '500-750 ml')), i('parsley', ap('handful', 'a handful')),
    ],
    steps: ['Melt butter and syrup together.', 'Stir in oats and salt, press into a tin.', 'Bake until golden.', 'For the soup, soften onions and garlic then add stock and season to taste.'] }),
  def({ slug: '05-blurry-curry', title: 'Quick Veg Curry', servings: 4, diet: 'vegan', style: 'blurry',
    scenario: 'DELIBERATELY blurry + low-contrast: extraction must flag low confidence and force review, never silently save',
    ingredients: [
      i('chickpeas', ex(1, 'can', '1 tin')), i('coconut milk', ex(400, 'ml', '400 ml')), i('curry paste', ex(2, 'tbsp', '2 tbsp')), i('spinach', ex(200, 'g', '200 g')),
    ],
    steps: ['Fry the paste for 1 minute.', 'Add everything else and simmer 15 minutes.'] }),
  def({ slug: '06-fish-pie', title: 'Family Fish Pie', servings: 4, diet: 'fish', style: 'clean',
    scenario: 'Fish category, mixed units, optional garnish',
    ingredients: [
      i('white fish fillets', ex(500, 'g', '500 g'), 'skinned'), i('smoked haddock', ex(250, 'g', '250 g')), i('milk', ex(500, 'ml', '500 ml')), i('floury potatoes', ex(1, 'kg', '1 kg'), 'peeled'),
      i('butter', ex(50, 'g', '50 g')), i('plain flour', ex(2, 'tbsp', '2 tbsp')), i('frozen peas', ex(100, 'g', '100 g')), i('chives', ex(1, 'bunch', '1 bunch'), 'chopped', true),
    ],
    steps: ['Poach fish in milk for 5 minutes; reserve milk.', 'Make a white sauce with butter, flour and the milk.', 'Fold in fish and peas, top with mash and bake 25 minutes.'] }),
  def({ slug: '07-porridge', title: 'Overnight Berry Porridge', servings: 2, diet: 'vegetarian', style: 'clean',
    scenario: 'Short breakfast card; mixed cups/ml; "to taste" honey',
    ingredients: [
      i('porridge oats', ex(1, 'cup', '1 cup')), i('milk', ex(300, 'ml', '300 ml')), i('mixed berries', ex(150, 'g', '150 g')), i('honey', tt('to taste')),
    ],
    steps: ['Combine oats and milk; chill overnight.', 'Top with berries and honey.'] }),
  def({ slug: '08-chickpea-stew', title: 'Smoky Chickpea Stew', servings: 4, diet: 'vegan', style: 'clean',
    scenario: 'Vegan; ground vs fresh form stay separate (ground coriander vs fresh coriander); unparsed line',
    ingredients: [
      i('chickpeas', ex(2, 'can', '2 tins')), i('ground coriander', ex(1, 'tsp', '1 tsp')), i('fresh coriander', ex(1, 'bunch', '1 bunch'), 'chopped'), i('smoked paprika', ex(2, 'tsp', '2 tsp')),
      i('tinned tomatoes', ex(1, 'can', '1 tin')), i('red peppers', ex(2, 'item', '2'), 'sliced'), i('whatever greens need using up', { kind: 'unparsed', originalText: 'whatever greens need using up' }),
    ],
    steps: ['Soften peppers with the spices.', 'Add tomatoes and chickpeas; simmer 25 minutes.', 'Finish with coriander and greens.'] }),
];
