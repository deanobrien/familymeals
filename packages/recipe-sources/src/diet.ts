import type { SourceRecipe } from './types.js';

export type InferredDiet = 'meat' | 'fish' | 'vegetarian' | 'vegan';

/**
 * Diet label derived from the ingredient lines. The publisher's own category (e.g. "Vegetarian") is NEVER trusted
 * and nothing is assumed: the result is always UNVERIFIED and the conservative label wins.
 *  - any meat / animal-derived word (title or lines)            -> 'meat'
 *  - fish / shellfish words (and no meat)                       -> 'fish'
 *  - every line matched to the catalogue, no animal product     -> 'vegetarian' (or 'vegan' with no dairy/egg/honey)
 *  - anything we cannot verify (an unmatched line, a hedged word such as parmesan or stock) -> 'meat'
 */
const MEAT = [
  'chicken', 'beef', 'pork', 'lamb', 'mutton', 'turkey', 'duck', 'goose', 'bacon', 'ham\\b', 'gammon', 'chorizo', 'sausage', 'salami',
  'pancetta', 'prosciutto', 'mince', 'steak', 'veal', 'venison', 'rabbit', 'liver', 'kidneys?\\b(?!\\s*bean)', 'oxtail', 'brisket', 'ribs?\\b',
  'lard', 'suet', 'gelatin', 'bone', 'meat', 'burger', 'hot dog', 'pepperoni', 'nduja', 'black pudding', 'bouillon', 'broth',
  'stock', 'parmesan', 'pecorino', 'grana', 'rennet', 'dripping', 'tallow',
];
const FISH = [
  'fish', 'salmon', 'cod\\b', 'haddock', 'tuna', 'mackerel', 'sardine', 'anchov', 'trout', 'pollock', 'plaice', 'sea bass', 'herring', 'prawn',
  'shrimp', 'crab', 'lobster', 'mussel', 'oyster', 'squid', 'calamari', 'clam', 'scallop', 'seafood', 'octopus', 'kipper', 'swordfish',
  'tilapia', 'monkfish', 'hake', 'halibut', 'bream', 'worcestershire', 'crayfish', 'whitebait', 'roe\\b',
];
const DAIRY_EGG_HONEY = [
  'milk', 'cream', 'butter', 'cheese', 'yogh?urt', 'egg', 'honey', 'ghee', 'mayonnaise', 'custard', 'paneer', 'halloumi', 'feta', 'mozzarella',
  'cheddar', 'ricotta', 'brie', 'whey', 'casein', 'mascarpone', 'cr[eè]me', 'ice cream', 'buttermilk', 'kefir',
];

const rx = (words: string[]): RegExp => new RegExp(`\\b(?:${words.join('|')})`, 'i');
const MEAT_RX = rx(MEAT);
/** Plainly vegetable stocks are not a meat signal (every other stock / broth / bouillon is). */
const VEG_STOCK = /\b(?:vegetable|veg|mushroom|vegan)\s+(?:stock|broth|bouillon)/gi;
const forMeat = (t: string): string => t.replace(VEG_STOCK, '');
const FISH_RX = rx(FISH);
const DAIRY_RX = rx(DAIRY_EGG_HONEY);

/** Resolve an ingredient name to its catalogue category (undefined = not matched). */
export type CategoryResolver = (ingredientName: string) => string | undefined;

export interface DietInference {
  diet: InferredDiet;
  /** Always false: a derived label is a hint for the reviewer, never a certification. */
  verified: false;
  reason: string;
}

export function inferDiet(r: Pick<SourceRecipe, 'title' | 'ingredients'>, categoryOf: CategoryResolver): DietInference {
  const names = r.ingredients.map((i) => i.name);
  const texts = [r.title, ...names];
  const cats = names.map((n) => categoryOf(n));
  const meatHit = texts.find((t) => MEAT_RX.test(forMeat(t))) ?? (cats.some((c) => c === 'meat_poultry') ? 'a meat ingredient' : undefined);
  if (meatHit) return { diet: 'meat', verified: false, reason: `contains or may contain meat or an animal-derived ingredient ("${meatHit}")` };
  const fishHit = texts.find((t) => FISH_RX.test(t)) ?? (cats.some((c) => c === 'fish_seafood') ? 'a fish ingredient' : undefined);
  if (fishHit) return { diet: 'fish', verified: false, reason: `contains fish or shellfish ("${fishHit}")` };
  const unmatched = names.filter((_, i) => cats[i] === undefined);
  if (unmatched.length > 0) {
    return { diet: 'meat', verified: false, reason: `could not check every ingredient against our list (e.g. "${unmatched[0]}"), so no vegetarian label is given` };
  }
  const animal = texts.find((t) => DAIRY_RX.test(t)) ?? (cats.some((c) => c === 'dairy_eggs') ? 'a dairy or egg ingredient' : undefined);
  if (animal) return { diet: 'vegetarian', verified: false, reason: `no meat or fish found, but it has ("${animal}"), so not vegan` };
  return { diet: 'vegan', verified: false, reason: 'no animal ingredients found in the listed ingredients' };
}

/** Tags that carry the inferred diet into the library (the sink reads vegan / vegetarian / fish; none = meat). */
export function dietTags(d: DietInference): string[] {
  return [...(d.diet === 'meat' ? [] : [d.diet]), 'diet-unverified'];
}
