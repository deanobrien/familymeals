/** refdata category -> shopping aisle (walk-round-the-shop order lives in AISLES). Client-safe: plain data. */
const AISLE_BY_CATEGORY: Record<string, string> = {
  fruit_veg: 'Fruit & veg',
  meat_poultry: 'Meat & fish',
  fish_seafood: 'Meat & fish',
  meat_alternatives: 'Meat & fish',
  dairy_eggs: 'Dairy & eggs',
  dairy_alternatives: 'Dairy & eggs',
  bakery: 'Bakery',
  tinned_jarred: 'Tins & jars',
  sauces_condiments: 'Tins & jars',
  oils_vinegars: 'Tins & jars',
  sweeteners_spreads: 'Tins & jars',
  world_foods: 'Tins & jars',
  pasta_rice_grains: 'Dry goods',
  baking: 'Dry goods',
  cereals: 'Dry goods',
  nuts_seeds: 'Dry goods',
  snacks: 'Dry goods',
  herbs_spices: 'Herbs & spices',
  frozen: 'Frozen',
  drinks: 'Drinks',
};

export const aisleForCategory = (category: string | undefined): string =>
  (category && AISLE_BY_CATEGORY[category]) || 'Other';
