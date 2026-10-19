import type { OffProduct } from './off/schema';

/**
 * UK-style product fixtures in the Open Food Facts payload shape (fictional brands and barcodes with valid GS1 check
 * digits; nutrition roughly typical). Used by the mock provider, tests and e2e: no network, ever.
 */

function ean13(prefix12: string): string {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(prefix12[i]) * (i % 2 === 0 ? 1 : 3);
  return prefix12 + String((10 - (sum % 10)) % 10);
}

export const FIXTURE_CODES = {
  bakedBeans: ean13('500900000001'),
  choppedTomatoes: ean13('500900000002'),
  semiSkimmedMilk: ean13('500900000003'),
  wholewheatFusilli: ean13('500900000004'),
  mysterySauce: ean13('500900000005'),
  springWater: ean13('500900000006'),
  yogurtMultipack: ean13('500900000007'),
  badPerServing: ean13('500900000008'),
  noName: ean13('500900000009'),
} as const;

export const OFF_FIXTURES: Record<string, OffProduct> = {
  [FIXTURE_CODES.bakedBeans]: {
    code: FIXTURE_CODES.bakedBeans,
    product_name: 'Hearth & Field Baked Beans in Tomato Sauce',
    generic_name: 'Baked beans',
    brands: 'Hearth & Field',
    quantity: '415 g',
    categories_tags: ['en:plant-based-foods-and-beverages', 'en:legumes', 'en:canned-foods', 'en:baked-beans'],
    allergens_tags: [],
    ingredients_text: 'Beans (51%), Tomatoes (34%), Water, Sugar, Salt',
    nutriments: {
      'energy-kcal_100g': 78, 'energy-kj_100g': 331, proteins_100g: 4.7, carbohydrates_100g: 12.8, sugars_100g: 4.8,
      fat_100g: 0.2, 'saturated-fat_100g': 0.1, fiber_100g: 3.7, salt_100g: 0.55, sodium_100g: 0.22,
    },
    image_front_url: 'https://images.openfoodfacts.org/images/products/500/900/000/0013/front_en.4.400.jpg',
  },
  [FIXTURE_CODES.choppedTomatoes]: {
    code: FIXTURE_CODES.choppedTomatoes,
    product_name: 'Hearth & Field Chopped Tomatoes in Tomato Juice',
    generic_name: 'Chopped tomatoes',
    brands: 'Hearth & Field',
    quantity: '400 g (drained 240 g)',
    categories_tags: ['en:plant-based-foods-and-beverages', 'en:canned-foods', 'en:canned-vegetables', 'en:chopped-tomatoes'],
    allergens_tags: [],
    ingredients_text: 'Tomatoes (69%), Tomato Juice, Acidity Regulator: Citric Acid',
    nutriments: {
      'energy-kcal_100g': 19, 'energy-kj_100g': 81, proteins_100g: 1, carbohydrates_100g: 3.1, sugars_100g: 3,
      fat_100g: 0.1, 'saturated-fat_100g': 0, fiber_100g: 0.9, salt_100g: 0.03,
    },
  },
  [FIXTURE_CODES.semiSkimmedMilk]: {
    code: FIXTURE_CODES.semiSkimmedMilk,
    product_name: 'Hearth & Field Semi Skimmed Milk',
    brands: 'Hearth & Field',
    quantity: '2 L',
    categories_tags: ['en:beverages', 'en:dairies', 'en:milks', 'en:semi-skimmed-milks'],
    allergens_tags: ['en:milk'],
    ingredients_text: 'Semi skimmed milk',
    nutriments: {
      // Salt is not given, only sodium (in grams, as Open Food Facts stores it): salt must be derived, flagged.
      energy_100g: 200, 'energy-kcal_100g': 47, proteins_100g: 3.6, carbohydrates_100g: 4.7, sugars_100g: 4.7,
      fat_100g: 1.8, 'saturated-fat_100g': 1.1, sodium_100g: 0.04,
    },
  },
  [FIXTURE_CODES.wholewheatFusilli]: {
    code: FIXTURE_CODES.wholewheatFusilli,
    product_name: 'Hearth & Field Wholewheat Fusilli',
    brands: 'Hearth & Field, Other Brand',
    quantity: '500g',
    categories_tags: ['en:plant-based-foods-and-beverages', 'en:cereals-and-potatoes', 'en:pastas', 'en:dried-pastas'],
    allergens_tags: ['en:gluten'],
    traces_tags: ['en:eggs', 'en:gluten', 'en:something-odd'],
    ingredients_text: 'Wholewheat durum wheat semolina',
    nutriments: {
      'energy-kcal_100g': '348', 'energy-kj_100g': '1480', proteins_100g: '13', carbohydrates_100g: '62', sugars_100g: '3',
      fat_100g: '2.5', 'saturated-fat_100g': '0.5', fiber_100g: '8', salt_100g: '0.01',
    },
  },
  [FIXTURE_CODES.mysterySauce]: {
    code: FIXTURE_CODES.mysterySauce,
    product_name: 'Hearth & Field Mystery Sauce',
    quantity: '290 ml',
    categories_tags: ['en:sauces'],
    // Incomplete label data: only energy and fat. Everything else must stay unknown, never 0. No allergen data at all.
    nutriments: { 'energy-kj_100g': 520, fat_100g: 4 },
  },
  [FIXTURE_CODES.springWater]: {
    code: FIXTURE_CODES.springWater,
    product_name: 'Still Spring Water',
    brands: 'Hearth & Field',
    quantity: '1.5 L',
    categories_tags: ['en:beverages', 'en:waters'],
    allergens_tags: [],
    ingredients_text: 'Natural spring water',
    nutriments: { 'energy-kcal_100g': 0, proteins_100g: 0, carbohydrates_100g: 0, fat_100g: 0, salt_100g: 0 },
  },
  [FIXTURE_CODES.yogurtMultipack]: {
    code: FIXTURE_CODES.yogurtMultipack,
    product_name: 'Hearth & Field Natural Yogurt',
    brands: 'Hearth & Field',
    quantity: '6 x 125 g',
    categories_tags: ['en:dairies', 'en:fermented-foods', 'en:yogurts'],
    allergens_tags: ['en:milk'],
    ingredients_text: 'Yogurt (milk)',
    nutriments: { 'energy-kcal_100g': 61, proteins_100g: 4.5, carbohydrates_100g: 4.7, sugars_100g: 4.7, fat_100g: 3, 'saturated-fat_100g': 2, salt_100g: 0.14 },
  },
  [FIXTURE_CODES.badPerServing]: {
    code: FIXTURE_CODES.badPerServing,
    product_name: 'Hearth & Field Mistyped Crackers',
    quantity: '200 g',
    categories_tags: ['en:crackers'],
    // Someone typed whole-pack figures into the per-100 g boxes: macros add to well over 100 g.
    nutriments: { 'energy-kcal_100g': 1400, proteins_100g: 30, carbohydrates_100g: 120, fat_100g: 40 },
  },
  [FIXTURE_CODES.noName]: {
    code: FIXTURE_CODES.noName,
    quantity: '100 g',
    nutriments: { 'energy-kcal_100g': 100 },
  },
};
