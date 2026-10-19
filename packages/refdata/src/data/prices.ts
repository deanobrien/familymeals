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
  ['red pepper', 190, 3, 'item'], ['green pepper', 100, 1, 'item'], ['chilli', 60, 40, 'g'],
  ['courgette', 140, 3, 'item'], ['aubergine', 90, 1, 'item'], ['mushroom', 110, 250, 'g'],
  ['butternut squash', 130, 1, 'item'], ['green beans', 150, 200, 'g'], ['asparagus', 250, 250, 'g'],
  ['avocado', 80, 1, 'item'], ['apple', 190, 6, 'item'], ['pear', 180, 4, 'item'], ['banana', 90, 5, 'item'],
  ['orange', 120, 3, 'item'], ['lemon', 130, 4, 'item'], ['lime', 120, 4, 'item'], ['grapes', 200, 500, 'g'],
  ['strawberries', 250, 400, 'g'], ['raspberries', 300, 150, 'g'], ['blueberries', 275, 150, 'g'],
  ['fresh coriander', 80, 30, 'g'], ['fresh parsley', 80, 30, 'g'], ['fresh basil', 100, 30, 'g'],
  ['fresh mint', 80, 30, 'g'], ['fresh thyme', 90, 25, 'g'], ['fresh rosemary', 90, 25, 'g'],
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
  // D90 additions (2026-10-19): generic_estimate only, author-assessed typical own-brand shelf prices; not scraped.
  // Fresh herbs and chilli are priced per gram pack so bunch/sprig/item lines convert via countUnitWeightsG.
  // Stock (l) is priced as made from cubes/powder, not ready-made.
  ['turnip', 80, 500, 'g'], ['celeriac', 150, 1, 'item'], ['fennel', 110, 1, 'item'], ['savoy cabbage', 100, 1, 'item'],
  ['brussels sprouts', 100, 500, 'g'], ['spring greens', 100, 300, 'g'], ['pak choi', 120, 2, 'item'], ['rocket', 110, 60, 'g'],
  ['watercress', 100, 85, 'g'], ['yellow pepper', 100, 1, 'item'], ['green chilli', 60, 40, 'g'], ['pumpkin', 140, 1, 'kg'],
  ['sweetcorn', 140, 2, 'item'], ['peas', 180, 1, 'kg'], ['mangetout', 130, 200, 'g'], ['runner beans', 130, 250, 'g'],
  ['broad beans', 150, 500, 'g'], ['radish', 80, 150, 'g'], ['lemon juice', 100, 200, 'ml'], ['lime juice', 100, 250, 'ml'],
  ['blackberries', 275, 150, 'g'], ['rhubarb', 200, 500, 'g'], ['mango', 120, 1, 'item'], ['pineapple', 130, 1, 'item'],
  ['peach', 200, 4, 'item'], ['plum', 190, 6, 'item'], ['melon', 180, 1, 'item'], ['desiccated coconut', 120, 200, 'g'],
  ['raisins', 150, 500, 'g'], ['dried apricots', 190, 250, 'g'], ['dates', 220, 250, 'g'], ['prunes', 200, 250, 'g'],
  ['little gem lettuce', 120, 2, 'item'], ['beansprouts', 80, 300, 'g'], ['mixed salad leaves', 100, 120, 'g'], ['chicken drumstick', 350, 1000, 'g'],
  ['chicken wings', 300, 1000, 'g'], ['beef joint', 1000, 1000, 'g'], ['diced lamb', 750, 500, 'g'], ['pork shoulder', 500, 1000, 'g'],
  ['pork belly', 500, 1000, 'g'], ['gammon', 500, 1000, 'g'], ['duck breast', 550, 340, 'g'], ['smoked haddock', 480, 240, 'g'],
  ['mackerel', 300, 300, 'g'], ['smoked mackerel', 250, 240, 'g'], ['anchovies', 100, 50, 'g'], ['white fish', 450, 500, 'g'],
  ['creme fraiche', 130, 300, 'ml'], ['cottage cheese', 120, 300, 'g'], ['ricotta', 130, 250, 'g'], ['brie', 200, 200, 'g'],
  ['goats cheese', 190, 150, 'g'], ['paneer', 250, 225, 'g'], ['wholemeal flour', 130, 1.5, 'kg'], ['dark brown sugar', 150, 500, 'g'],
  ['demerara sugar', 160, 500, 'g'], ['maple syrup', 400, 250, 'ml'], ['treacle', 200, 454, 'g'], ['milk chocolate', 130, 100, 'g'],
  ['breadcrumbs', 100, 175, 'g'], ['crumpet', 100, 6, 'item'], ['tortilla chips', 150, 200, 'g'], ['wholewheat pasta', 100, 500, 'g'],
  ['rice noodles', 120, 250, 'g'], ['lasagne sheets', 120, 250, 'g'], ['arborio rice', 200, 500, 'g'], ['pearl barley', 100, 500, 'g'],
  ['bulgur wheat', 160, 500, 'g'], ['polenta', 140, 500, 'g'], ['semolina', 110, 500, 'g'], ['green lentils', 150, 500, 'g'],
  ['dried chickpeas', 120, 500, 'g'], ['black beans', 70, 1, 'can'], ['tinned peas', 55, 1, 'can'], ['pizza base', 150, 2, 'item'],
  ['ciabatta', 120, 2, 'item'], ['baguette', 90, 1, 'item'], ['sesame oil', 300, 150, 'ml'], ['coconut oil', 450, 500, 'ml'],
  ['red wine vinegar', 100, 500, 'ml'], ['balsamic vinegar', 200, 500, 'ml'], ['malt vinegar', 80, 568, 'ml'], ['cider vinegar', 130, 500, 'ml'],
  ['english mustard', 110, 180, 'g'], ['dijon mustard', 130, 185, 'g'], ['brown sauce', 170, 255, 'g'], ['sweet chilli sauce', 140, 300, 'ml'],
  ['hot sauce', 200, 150, 'ml'], ['fish sauce', 180, 200, 'ml'], ['oyster sauce', 200, 255, 'g'], ['hoisin sauce', 200, 260, 'g'],
  ['pesto', 180, 190, 'g'], ['gravy granules', 200, 200, 'g'], ['chicken stock', 20, 1, 'l'], ['vegetable stock', 20, 1, 'l'],
  ['beef stock', 20, 1, 'l'], ['chicken stock powder', 130, 80, 'g'], ['mango chutney', 150, 350, 'g'], ['harissa paste', 150, 90, 'g'],
  ['garlic puree', 100, 90, 'g'], ['white pepper', 150, 35, 'g'], ['smoked paprika', 130, 40, 'g'], ['cayenne pepper', 130, 40, 'g'],
  ['chilli powder', 130, 40, 'g'], ['chilli flakes', 130, 40, 'g'], ['cumin seeds', 130, 40, 'g'], ['coriander seeds', 130, 30, 'g'],
  ['garam masala', 130, 40, 'g'], ['ground ginger', 130, 40, 'g'], ['cinnamon stick', 150, 20, 'g'], ['ground nutmeg', 150, 35, 'g'],
  ['ground cloves', 130, 30, 'g'], ['allspice', 130, 35, 'g'], ['cardamom pods', 150, 25, 'g'], ['bay leaf', 120, 10, 'g'],
  ['dried thyme', 130, 14, 'g'], ['dried rosemary', 130, 14, 'g'], ['dried basil', 130, 14, 'g'], ['dried sage', 130, 14, 'g'],
  ['dried parsley', 130, 14, 'g'], ['garlic powder', 130, 40, 'g'], ['onion powder', 130, 40, 'g'], ['fresh sage', 90, 25, 'g'],
  ['fresh dill', 90, 25, 'g'], ['chives', 90, 20, 'g'], ['lemongrass', 100, 3, 'item'], ['curry leaves', 90, 15, 'g'],
  ['nigella seeds', 150, 40, 'g'], ['ras el hanout', 130, 40, 'g'], ['cajun seasoning', 130, 40, 'g'], ['fajita seasoning', 130, 30, 'g'],
  ['jerk seasoning', 130, 40, 'g'], ['chinese five spice', 130, 40, 'g'], ['sesame seeds', 150, 100, 'g'], ['sunflower seeds', 120, 200, 'g'],
  ['pumpkin seeds', 180, 150, 'g'], ['flaxseed', 250, 400, 'g'], ['chia seeds', 300, 300, 'g'], ['walnuts', 300, 200, 'g'],
  ['cashew nuts', 300, 200, 'g'], ['peanuts', 150, 250, 'g'], ['hazelnuts', 300, 200, 'g'], ['pecans', 350, 150, 'g'],
  ['pine nuts', 350, 100, 'g'], ['pistachios', 350, 100, 'g'], ['tahini', 300, 270, 'g'], ['marmalade', 140, 340, 'g'],
  ['chocolate spread', 200, 400, 'g'], ['mixed nuts', 300, 400, 'g'], ['quorn mince', 250, 300, 'g'], ['vegetarian sausages', 250, 300, 'g'],
  ['olives', 130, 150, 'g'], ['capers', 120, 100, 'g'], ['gherkins', 120, 360, 'g'], ['sun-dried tomatoes', 200, 280, 'g'],
  ['coconut cream', 150, 200, 'ml'], ['tinned pineapple', 90, 1, 'can'], ['tinned peaches', 90, 1, 'can'], ['frozen sweetcorn', 170, 1, 'kg'],
  ['frozen spinach', 180, 900, 'g'], ['frozen mixed vegetables', 170, 1, 'kg'], ['frozen berries', 350, 500, 'g'], ['oven chips', 200, 1, 'kg'],
  ['frozen pizza', 200, 1, 'item'], ['ice cream', 250, 2, 'l'], ['puff pastry', 160, 320, 'g'], ['shortcrust pastry', 150, 320, 'g'],
  ['filo pastry', 200, 270, 'g'], ['gelatine', 150, 36, 'g'], ['cornflakes', 150, 500, 'g'], ['muesli', 250, 750, 'g'],
  ['weetabix', 200, 24, 'item'], ['digestive biscuits', 100, 400, 'g'], ['oatcakes', 150, 280, 'g'], ['crackers', 100, 300, 'g'],
  ['crisps', 180, 150, 'g'], ['popcorn', 120, 100, 'g'], ['tea', 150, 80, 'item'], ['coffee', 300, 200, 'g'],
  ['apple juice', 130, 1, 'l'], ['oat milk', 150, 1, 'l'], ['soya milk', 150, 1, 'l'], ['almond milk', 160, 1, 'l'],
  ['dairy-free spread', 250, 500, 'g'], ['red wine', 500, 750, 'ml'], ['white wine', 500, 750, 'ml'], ['beer', 250, 440, 'ml'],
  ['cider', 200, 500, 'ml'], ['water', 1, 1, 'l'], ['double concentrated tomato puree', 100, 200, 'g'], ['suet', 220, 240, 'g'],
  ['mincemeat', 150, 411, 'g'], ['custard powder', 130, 300, 'g'], ['tinned custard', 70, 400, 'g'], ['condensed milk', 150, 397, 'g'],
  ['evaporated milk', 100, 410, 'g'], ['skimmed milk powder', 350, 340, 'g'], ['dried mushrooms', 300, 30, 'g'], ['mixed peel', 100, 200, 'g'],
  ['glace cherries', 150, 200, 'g'], ['tinned salmon', 200, 1, 'can'], ['tinned mackerel', 130, 1, 'can'], ['tinned tomato soup', 70, 1, 'can'],
  ['tinned mushrooms', 90, 1, 'can'], ['jacket potato', 120, 4, 'item'], ['sauerkraut', 150, 350, 'g'], ['kimchi', 300, 300, 'g'],
  ['miso paste', 300, 200, 'g'], ['coconut sugar', 400, 300, 'g'], ['rice vinegar', 200, 150, 'ml'], ['mirin', 250, 150, 'ml'],
  ['nori', 300, 28, 'g'], ['wasabi', 250, 43, 'g'], ['horseradish sauce', 140, 190, 'g'], ['mint sauce', 100, 165, 'g'],
  ['cranberry sauce', 140, 260, 'g'], ['apple sauce', 120, 290, 'g'], ['tartare sauce', 150, 190, 'g'], ['salad cream', 150, 425, 'g'],
  ['bbq sauce', 150, 480, 'g'], ['pickled onions', 150, 360, 'g'], ['yeast extract', 200, 250, 'g'], ['lard', 150, 250, 'g'],
  ['ghee', 350, 300, 'g'],
];
