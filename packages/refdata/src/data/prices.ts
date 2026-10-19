/**
 * GENERIC UK PRICE ESTIMATES (kind 'generic_estimate', lowest priority in the price hierarchy).
 *
 * These are NOT live prices and NOT scraped from any retailer. They are rounded, author-estimated
 * "typical UK supermarket own-brand / basic range" shelf prices per standard pack, intended only so
 * the app can show a labelled "estimated cost" before the household has entered receipts or
 * confirmed prices. Expect individual prices to be off by +/-30% and to age; refresh by re-dating
 * (observedOn) after review. The UI must display them as estimates (BRIEF section 10).
 */
export const PRICE_OBSERVED_ON = '2026-10-19';
export const PRICE_SOURCE =
  'Generic UK estimate: author-assessed typical own-brand supermarket shelf price, rounded; not live, not scraped';

export type PackUnit = 'g' | 'kg' | 'ml' | 'l' | 'item' | 'pack' | 'clove' | 'bunch' | 'can';
/** [ingredient name, pence per pack, pack size value, pack unit] */
export type PriceEntry = readonly [name: string, pence: number, packValue: number, packUnit: PackUnit];

export const PRICES: readonly PriceEntry[] = [
  // fruit & veg
  ['onion', 120, 1, 'kg'], ['red onion', 110, 500, 'g'], ['spring onion', 85, 1, 'bunch'], ['shallot', 130, 250, 'g'],
  ['leek', 130, 500, 'g'], ['garlic clove', 45, 10, 'clove'], ['ginger', 70, 100, 'g'],
  ['potato', 280, 2.5, 'kg'], ['new potato', 150, 1, 'kg'], ['sweet potato', 140, 1, 'kg'],
  ['carrot', 80, 1, 'kg'], ['parsnip', 95, 500, 'g'], ['swede', 95, 1, 'item'], ['beetroot', 100, 500, 'g'],
  ['celery', 90, 1, 'item'], ['broccoli', 95, 350, 'g'], ['cauliflower', 110, 1, 'item'],
  ['cabbage', 90, 1, 'item'], ['red cabbage', 95, 1, 'item'], ['kale', 130, 200, 'g'], ['spinach', 130, 200, 'g'],
  ['lettuce', 80, 1, 'item'], ['cucumber', 85, 1, 'item'], ['tomato', 150, 6, 'item'], ['cherry tomato', 150, 250, 'g'],
  ['red pepper', 190, 3, 'item'], ['green pepper', 100, 1, 'item'], ['chilli', 60, 1, 'pack'],
  ['courgette', 140, 3, 'item'], ['aubergine', 90, 1, 'item'], ['mushroom', 110, 250, 'g'],
  ['butternut squash', 130, 1, 'item'], ['green beans', 150, 200, 'g'], ['asparagus', 250, 250, 'g'],
  ['avocado', 80, 1, 'item'], ['apple', 190, 6, 'item'], ['pear', 180, 4, 'item'], ['banana', 90, 5, 'item'],
  ['orange', 120, 3, 'item'], ['lemon', 130, 4, 'item'], ['lime', 120, 4, 'item'], ['grapes', 200, 500, 'g'],
  ['strawberries', 250, 400, 'g'], ['raspberries', 300, 150, 'g'], ['blueberries', 275, 150, 'g'],
  ['fresh coriander', 80, 1, 'pack'], ['fresh parsley', 80, 1, 'pack'], ['fresh basil', 100, 1, 'pack'],
  ['fresh mint', 80, 1, 'pack'], ['fresh thyme', 90, 1, 'pack'], ['fresh rosemary', 90, 1, 'pack'],
  // meat & fish
  ['chicken breast', 550, 650, 'g'], ['chicken thigh', 400, 1, 'kg'], ['whole chicken', 450, 1.5, 'kg'],
  ['minced beef', 400, 500, 'g'], ['stewing beef', 600, 500, 'g'], ['beef steak', 450, 2, 'item'],
  ['minced lamb', 450, 500, 'g'], ['lamb chops', 500, 4, 'item'], ['pork chops', 350, 4, 'item'],
  ['pork mince', 300, 500, 'g'], ['pork sausages', 250, 8, 'item'], ['bacon', 250, 8, 'item'],
  ['ham', 200, 100, 'g'], ['chorizo', 225, 1, 'pack'], ['turkey breast', 450, 500, 'g'],
  ['salmon', 425, 2, 'item'], ['cod', 450, 2, 'item'], ['haddock', 450, 2, 'item'],
  ['tuna chunks', 120, 1, 'can'], ['sardines', 100, 1, 'can'], ['prawns', 350, 150, 'g'], ['fish fingers', 275, 10, 'item'],
  // dairy & eggs
  ['egg', 270, 12, 'item'], ['milk', 150, 2.272, 'l'], ['semi-skimmed milk', 150, 2.272, 'l'], ['skimmed milk', 150, 2.272, 'l'],
  ['butter', 220, 250, 'g'], ['margarine', 180, 500, 'g'], ['single cream', 100, 300, 'ml'], ['double cream', 130, 300, 'ml'],
  ['soured cream', 100, 300, 'ml'], ['natural yoghurt', 100, 500, 'g'], ['greek yoghurt', 150, 500, 'g'],
  ['cheddar', 250, 350, 'g'], ['mozzarella', 100, 125, 'g'], ['parmesan', 220, 100, 'g'], ['feta', 180, 200, 'g'],
  ['cream cheese', 150, 200, 'g'], ['halloumi', 250, 225, 'g'],
  // bakery, baking
  ['bread', 120, 800, 'g'], ['wholemeal bread', 125, 800, 'g'], ['wrap', 130, 8, 'item'], ['pitta bread', 100, 6, 'item'],
  ['naan bread', 120, 2, 'item'], ['bread roll', 120, 6, 'item'],
  ['plain flour', 90, 1.5, 'kg'], ['self-raising flour', 90, 1.5, 'kg'], ['strong bread flour', 140, 1.5, 'kg'],
  ['cornflour', 110, 250, 'g'], ['baking powder', 110, 170, 'g'], ['bicarbonate of soda', 100, 200, 'g'],
  ['dried yeast', 130, 6, 'item'], ['caster sugar', 125, 1, 'kg'], ['granulated sugar', 115, 1, 'kg'],
  ['icing sugar', 110, 500, 'g'], ['light brown sugar', 130, 500, 'g'], ['golden syrup', 200, 454, 'g'],
  ['honey', 275, 340, 'g'], ['cocoa powder', 200, 250, 'g'], ['dark chocolate', 130, 100, 'g'],
  ['vanilla extract', 250, 38, 'ml'], ['ground almonds', 300, 200, 'g'], ['rolled oats', 100, 1, 'kg'],
  // dry goods, tins
  ['pasta', 85, 500, 'g'], ['egg noodles', 120, 250, 'g'], ['white rice', 120, 1, 'kg'], ['basmati rice', 200, 1, 'kg'],
  ['brown rice', 190, 1, 'kg'], ['couscous', 100, 500, 'g'], ['red lentils', 140, 500, 'g'], ['quinoa', 250, 300, 'g'],
  ['chickpeas', 65, 1, 'can'], ['kidney beans', 65, 1, 'can'], ['cannellini beans', 65, 1, 'can'], ['baked beans', 70, 1, 'can'],
  ['tinned tomatoes', 65, 1, 'can'], ['tomato puree', 90, 200, 'g'], ['passata', 85, 500, 'g'],
  ['sweetcorn tinned', 75, 1, 'can'], ['coconut milk', 120, 1, 'can'],
  // oils, sauces, spices
  ['olive oil', 600, 500, 'ml'], ['vegetable oil', 250, 1, 'l'], ['soy sauce', 150, 150, 'ml'], ['worcestershire sauce', 175, 150, 'ml'],
  ['tomato ketchup', 150, 460, 'g'], ['mayonnaise', 160, 400, 'g'], ['stock cube', 100, 12, 'item'],
  ['salt', 70, 750, 'g'], ['black pepper', 150, 50, 'g'], ['paprika', 130, 40, 'g'], ['ground cumin', 130, 40, 'g'],
  ['ground coriander', 130, 40, 'g'], ['turmeric', 130, 40, 'g'], ['curry powder', 130, 40, 'g'],
  ['ground cinnamon', 130, 40, 'g'], ['mixed herbs', 130, 14, 'g'], ['dried oregano', 130, 14, 'g'],
  ['white wine vinegar', 100, 500, 'ml'], ['curry paste', 200, 280, 'g'],
  // misc
  ['peanut butter', 175, 340, 'g'], ['jam', 140, 340, 'g'], ['frozen peas', 180, 1, 'kg'], ['orange juice', 160, 1, 'l'],
  ['hummus', 130, 200, 'g'], ['tofu', 180, 280, 'g'], ['almonds', 250, 200, 'g'],
];
