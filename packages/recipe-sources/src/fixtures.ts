/**
 * Offline fixtures in TheMealDB's raw v1 JSON shape (dev, the e2e suite and the unit tests; NO network).
 * The recipes are invented for testing, not copied from TheMealDB. Ingredient names deliberately use the
 * names in our refdata catalogue so the review screen matches them, except where a test needs an unmatched line.
 */
import type { RawMeal } from './themealdb/schema.js';

type Row = readonly [name: string, measure: string];

function meal(id: string, title: string, category: string, area: string, instructions: string, rows: Row[], tags = ''): RawMeal {
  const m: Record<string, unknown> = {
    idMeal: id, strMeal: title, strCategory: category, strArea: area, strInstructions: instructions,
    strMealThumb: `https://www.themealdb.com/images/media/meals/fixture-${id}.jpg`, strTags: tags || null, strYoutube: '',
    strSource: null, strCreativeCommonsConfirmed: null,
  };
  for (let i = 0; i < 20; i++) {
    m[`strIngredient${i + 1}`] = rows[i]?.[0] ?? '';
    m[`strMeasure${i + 1}`] = rows[i]?.[1] ?? ' ';
  }
  return m as RawMeal;
}

export const FIXTURE_MEALS: RawMeal[] = [
  meal('90001', 'Lemon Grilled Salmon', 'Seafood', 'British',
    'STEP 1\r\nHeat the grill to high.\r\nSTEP 2\r\nBrush the salmon with olive oil, season and grill for 8 minutes.\r\nSTEP 3\r\nServe with lemon wedges.',
    [['Salmon', '4 fillets'], ['Olive Oil', '2 tbsp'], ['Lemon', '1'], ['Salt', ''], ['Black Pepper', '']], 'Fish,Quick'),
  meal('90002', 'Cod and Pea Bake', 'Seafood', 'British',
    '1. Preheat the oven to 200C.\r\n2. Put the cod in a dish with the peas and olive oil.\r\n3. Bake for 15 minutes.',
    [['Cod', '500g'], ['Peas', '200g'], ['Olive Oil', '1 tbsp'], ['Fresh Parsley', '1 tbsp']], 'Fish'),
  meal('90003', 'Smoky Vegetable Chilli', 'Vegetarian', 'Mexican',
    'Fry the onion and pepper until soft.\r\nAdd the spices, tomatoes and beans.\r\nSimmer for 30 minutes and serve with rice.',
    [['Onion', '1 large'], ['Red Pepper', '2'], ['Kidney Beans', '400g'], ['Tinned Tomatoes', '400g'], ['Chilli Powder', '2 tsp'], ['Smoked Paprika', '1 tsp'], ['Basmati Rice', '300g']], 'Vegetarian,Spicy'),
  meal('90004', 'Peanut Satay Noodles', 'Vegetarian', 'Thai',
    'Cook the noodles. Stir the peanut butter with soy sauce and water, toss through the noodles and top with crushed peanuts.',
    [['Egg Noodles', '250g'], ['Peanut Butter', '4 tbsp'], ['Soy Sauce', '2 tbsp'], ['Peanuts', '30g'], ['Spring Onion', '3']], 'Vegetarian'),
  meal('90005', 'Red Lentil Dal', 'Vegan', 'Indian',
    'Rinse the lentils.\r\nSimmer with turmeric, cumin and water for 25 minutes.\r\nSeason and serve.',
    [['Red Lentils', '250g'], ['Turmeric', '1 tsp'], ['Ground Cumin', '1 tsp'], ['Onion', '1'], ['Garlic Clove', '3'], ['Water', '750ml'], ['Salt', 'To taste']], 'Vegan,Curry'),
  meal('90006', 'Fluffy Pancakes', 'Breakfast', 'American',
    'Whisk the flour, milk and eggs into a batter. Fry spoonfuls in butter until golden on both sides.',
    [['Plain Flour', '200g'], ['Milk', '300ml'], ['Egg', '2'], ['Butter', '20g'], ['Caster Sugar', '1 tbsp']], 'Breakfast,Sweet'),
  meal('90007', 'Gruyere Leek Tart', 'Vegetarian', 'French',
    'Roll out the pastry and line a tin.\r\nFry the leeks, mix with eggs, cream and Gruyere.\r\nBake for 35 minutes.',
    [['Shortcrust Pastry', '320g'], ['Leek', '3'], ['Gruyere', '150g'], ['Double Cream', '200ml'], ['Egg', '3']], 'Vegetarian'),
  meal('90008', 'Chicken and Leek Pie', 'Chicken', 'British',
    'Brown the chicken, add the leek and stock and top with pastry. Bake until golden.',
    [['Chicken Breast', '500g'], ['Leek', '2'], ['Chicken Stock', '300ml'], ['Puff Pastry', '320g'], ['Plain Flour', '2 tbsp']], 'Pie'),
  meal('90009', 'Quick Prawn Stir Fry', 'Seafood', 'Chinese',
    'Heat the oil in a wok. Stir fry the prawns and vegetables for 5 minutes and add the soy sauce.',
    [['Prawns', '300g'], ['Vegetable Oil', '1 tbsp'], ['Pak Choi', '2'], ['Soy Sauce', '2 tbsp'], ['Ginger', '1 tsp']], 'Seafood,Quick'),
  meal('90010', 'Mushroom Risotto', 'Vegetarian', 'Italian',
    'Soften the onion. Add the rice then stock a ladle at a time. Stir through the mushrooms and parmesan.',
    [['Arborio Rice', '300g'], ['Mushroom', '250g'], ['Onion', '1'], ['Vegetable Stock', '1 litre'], ['Parmesan', '40g']], 'Vegetarian'),
];

/** Category / area lists as TheMealDB's list.php returns them (subset). */
export const FIXTURE_CATEGORIES = ['Breakfast', 'Chicken', 'Seafood', 'Vegan', 'Vegetarian'];
export const FIXTURE_AREAS = ['American', 'British', 'Chinese', 'French', 'Indian', 'Italian', 'Mexican', 'Thai'];
