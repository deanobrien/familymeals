// Seed data for two isolated households. Deterministic ids: <6hex><kind2>-0000-4000-8000-<n12>.
// Test accounts use the reserved .test TLD; the shared password is a throwaway test-only value.
import type { z } from 'zod';
import type { HouseholdSeed, Quantity } from './contract.js';

type Seed = z.infer<typeof HouseholdSeed>;
type Q = z.infer<typeof Quantity>;
export const TEST_PASSWORD = 'Test-Only-Passw0rd!';

const mk = (p: string) => (kind: string, n: number) => `${p}${kind}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ex = (value: number, unit: Q['unit'], originalText: string): Q => ({ kind: 'exact', value, unit, originalText });

function build(
  p: string, name: string, owner: [string, string], member: [string, string],
  titles: [string, Seed['recipes'][0]['diet'], number][], ings: [number, string, Q][], extras: string[],
): Seed {
  const id = mk(p);
  const hh = id('01', 1), u1 = id('02', 1), u2 = id('02', 2);
  const recipes = titles.map(([title, diet, servings], n) => ({ id: id('03', n + 1), householdId: hh, title, diet, servings, createdBy: u1 }));
  const planId = id('05', 1);
  const meals = recipes.map((r, n) => ({ id: id('06', n + 1), recipeId: r.id, date: `2026-10-${19 + n}`, mealType: 'dinner' as const, servings: r.servings }));
  return {
    household: { id: hh, name },
    members: [
      { userId: u1, email: owner[0], displayName: owner[1], role: 'owner' },
      { userId: u2, email: member[0], displayName: member[1], role: 'member' },
    ],
    recipes,
    recipeIngredients: ings.map(([rn, ingName, quantity], n) => ({
      id: id('04', n + 1), recipeId: recipes[rn]!.id, quantity, optional: false, order: n, name: ingName,
    })),
    mealPlan: { id: planId, householdId: hh, weekStart: '2026-10-19', approved: true, meals },
    shoppingList: {
      id: id('07', 1), householdId: hh, planId,
      items: [
        ...ings.map(([, ingName, quantity], n) => ({ id: id('08', n + 1), displayName: ingName, quantity, aisle: 'Groceries', manual: false })),
        ...extras.map((e, n) => ({ id: id('08', 100 + n), displayName: e, quantity: ex(1, 'pack', '1 pack'), aisle: 'Household', manual: true })),
      ],
    },
  };
}

export const HOUSEHOLD_A = build('a1a1a1', 'The Smiths (A)', ['alice.smith@fr-test.test', 'Alice Smith'], ['bob.smith@fr-test.test', 'Bob Smith'],
  [['Smith Sunday Roast', 'meat', 4], ['Smith Veg Lasagne', 'vegetarian', 4], ['Smith Pea Soup', 'vegan', 2]],
  [[0, 'chicken', ex(1.5, 'kg', '1.5 kg')], [0, 'potatoes', ex(1, 'kg', '1 kg')], [1, 'lasagne sheets', ex(250, 'g', '250 g')], [2, 'frozen peas', ex(500, 'g', '500 g')]],
  ['bin bags']);
export const HOUSEHOLD_B = build('b2b2b2', 'The Patels (B)', ['priya.patel@fr-test.test', 'Priya Patel'], ['raj.patel@fr-test.test', 'Raj Patel'],
  [['Patel Dal Tadka', 'vegan', 4], ['Patel Fish Curry', 'fish', 4], ['Patel Paneer Wrap', 'vegetarian', 2]],
  [[0, 'red lentils', ex(300, 'g', '300 g')], [1, 'white fish fillets', ex(600, 'g', '600 g')], [1, 'coconut milk', ex(400, 'ml', '400 ml')], [2, 'paneer', ex(225, 'g', '225 g')]],
  ['kitchen roll']);
