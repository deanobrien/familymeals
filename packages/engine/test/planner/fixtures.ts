import type { PlanConstraintsInput, RecipeCandidateInput } from '../../src/planner/index';

export const MUSHROOM_IDS = ['ing-mushroom-button', 'ing-mushroom-chestnut'];

let n = 0;
export function recipe(partial: Partial<RecipeCandidateInput> & Pick<RecipeCandidateInput, 'id' | 'dietCategory'>): RecipeCandidateInput {
  n++;
  return {
    title: partial.id,
    tags: [],
    ingredientIds: [`ing-generic-${n % 5}`],
    totalMinutes: 40,
    estCostPerServingPence: 250,
    favouritedBy: [],
    ...partial,
  };
}

/** A realistic family library for the brief's example prompt. */
export function familyLibrary(): RecipeCandidateInput[] {
  return [
    recipe({ id: 'r01', title: 'Spaghetti bolognese', dietCategory: 'meat', totalMinutes: 45, estCostPerServingPence: 220, favouritedBy: ['lauren'] }),
    recipe({ id: 'r02', title: 'Chicken fajitas', dietCategory: 'meat', totalMinutes: 25, estCostPerServingPence: 300 }),
    recipe({ id: 'r03', title: 'Beef & mushroom pie', dietCategory: 'meat', totalMinutes: 90, estCostPerServingPence: 350, ingredientIds: ['ing-beef', 'ing-mushroom-chestnut'], favouritedBy: ['lauren'] }),
    recipe({ id: 'r04', title: 'Sausage traybake', dietCategory: 'meat', totalMinutes: 50, estCostPerServingPence: 210 }),
    recipe({ id: 'r05', title: 'Salmon teriyaki', dietCategory: 'fish', totalMinutes: 20, estCostPerServingPence: 420, favouritedBy: ['lauren'] }),
    recipe({ id: 'r06', title: 'Fish pie', dietCategory: 'fish', totalMinutes: 70, estCostPerServingPence: 380 }),
    recipe({ id: 'r07', title: 'Prawn stir fry', dietCategory: 'fish', totalMinutes: 15, estCostPerServingPence: 400, allergens: ['crustaceans'] }),
    recipe({ id: 'r08', title: 'Mushroom risotto', dietCategory: 'vegetarian', totalMinutes: 40, estCostPerServingPence: 180, ingredientIds: ['ing-rice', 'ing-mushroom-button'], favouritedBy: ['lauren'] }),
    recipe({ id: 'r09', title: 'Veggie chilli', dietCategory: 'vegan', totalMinutes: 30, estCostPerServingPence: 150, favouritedBy: ['lauren'] }),
    recipe({ id: 'r10', title: 'Halloumi wraps', dietCategory: 'vegetarian', totalMinutes: 20, estCostPerServingPence: 260 }),
    recipe({ id: 'r11', title: 'Spinach dhal', dietCategory: 'vegan', totalMinutes: 35, estCostPerServingPence: 120 }),
    recipe({ id: 'r12', title: 'Margherita pizza', dietCategory: 'vegetarian', totalMinutes: 25, estCostPerServingPence: 200, favouritedBy: ['sam'] }),
    recipe({ id: 'r13', title: 'Roast veg lasagne', dietCategory: 'vegetarian', totalMinutes: 75, estCostPerServingPence: 240, favouritedBy: ['lauren'] }),
    recipe({ id: 'r14', title: 'Lamb tagine', dietCategory: 'meat', totalMinutes: 120, estCostPerServingPence: 520 }),
    recipe({ id: 'r15', title: 'Bean burritos', dietCategory: 'vegan', totalMinutes: 20, estCostPerServingPence: null }),
  ];
}

/** "Plan seven dinners for four people. Make roughly half vegetarian, include two fish meals,
 * keep the shopping spend below £100, use Lauren's favourites where possible, avoid mushrooms
 * and include quick meals on busy evenings." -> structured constraints (what the LLM emits). */
export const briefConstraints: PlanConstraintsInput = {
  startDate: '2026-10-19', // a Monday
  days: 7,
  mealTypes: ['dinner'],
  servings: 4,
  budgetPence: 10_000,
  dietProportions: { vegetarian: { fraction: 0.5 }, fish: { count: 2 } },
  excludeIngredientIds: MUSHROOM_IDS,
  favouritesOf: ['lauren'],
  quickMeals: { weekdays: ['mon', 'tue', 'wed', 'thu'], maxTotalMinutes: 30 },
};
