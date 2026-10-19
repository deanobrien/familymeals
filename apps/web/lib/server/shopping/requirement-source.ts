import type { Contribution, Quantity, Requirement } from '../../shopping/engine';
import type { PlanRequirements } from '../../shopping/types';

/**
 * Where "generate from plan" gets its aggregated requirements.
 * TODO: real implementation = load the meal plan (planned meals -> recipes, servings) and run
 * @fr/engine/aggregate to combine ingredient lines into Requirements with provenance.
 */
export interface RequirementSource {
  forPlan(planId: string): Promise<PlanRequirements | null>;
}

const RECIPES = {
  curry: { id: 'recipe-tikka', title: 'Chicken tikka masala' },
  bolognese: { id: 'recipe-bolognese', title: 'Spaghetti bolognese' },
  soup: { id: 'recipe-tomato-soup', title: 'Roasted tomato soup' },
} as const;

const exact = (value: number, unit: Quantity['unit'], text: string): Quantity => ({
  kind: 'exact', value, ...(unit ? { unit } : {}), originalText: text,
});

function contrib(recipeId: string, line: string, quantity: Quantity): Contribution {
  return { recipeId, recipeIngredientId: `${recipeId}:${line}`, quantity };
}

function req(
  ingredientId: string, displayName: string, quantity: Quantity, contributions: Contribution[],
): Requirement {
  return { ingredientId, displayName, quantity, contributions };
}

/** Fixture for the stub source. Category/aisle are chosen by the fixture source (see categoryFor). */
function fixture(planId: string): PlanRequirements {
  const { curry, bolognese, soup } = RECIPES;
  const requirements: Requirement[] = [
    req('ing-onion', 'Onions', exact(4, 'item', '4 onions'), [
      contrib(curry.id, 'onion', exact(2, 'item', '2 onions')),
      contrib(bolognese.id, 'onion', exact(1, 'item', '1 onion')),
      contrib(soup.id, 'onion', exact(1, 'item', '1 onion')),
    ]),
    req('ing-garlic', 'Garlic', exact(4, 'clove', '4 cloves garlic'), [
      contrib(curry.id, 'garlic', exact(2, 'clove', '2 cloves')),
      contrib(bolognese.id, 'garlic', exact(2, 'clove', '2 cloves')),
    ]),
    req('ing-chicken-breast', 'Chicken breast', exact(500, 'g', '500g chicken breast'), [
      contrib(curry.id, 'chicken', exact(500, 'g', '500g')),
    ]),
    req('ing-beef-mince', 'Beef mince', exact(500, 'g', '500g beef mince'), [
      contrib(bolognese.id, 'mince', exact(500, 'g', '500g')),
    ]),
    req('ing-double-cream', 'Double cream', exact(150, 'ml', '150ml double cream'), [
      contrib(curry.id, 'cream', exact(150, 'ml', '150ml')),
    ]),
    req('ing-cheddar', 'Cheddar', { kind: 'range', min: 50, max: 75, unit: 'g', originalText: '50-75g cheddar' }, [
      contrib(soup.id, 'cheddar', { kind: 'range', min: 50, max: 75, unit: 'g', originalText: '50-75g' }),
    ]),
    req('ing-chopped-tomatoes', 'Chopped tomatoes', exact(3, 'can', '3 cans chopped tomatoes'), [
      contrib(curry.id, 'tomatoes', exact(1, 'can', '1 can')),
      contrib(bolognese.id, 'tomatoes', exact(1, 'can', '1 can')),
      contrib(soup.id, 'tomatoes', exact(1, 'can', '1 can')),
    ]),
    req('ing-spaghetti', 'Spaghetti', exact(300, 'g', '300g spaghetti'), [
      contrib(bolognese.id, 'spaghetti', exact(300, 'g', '300g')),
    ]),
    req('ing-basmati', 'Basmati rice', exact(300, 'g', '300g basmati rice'), [
      contrib(curry.id, 'rice', exact(300, 'g', '300g')),
    ]),
    req('ing-garam-masala', 'Garam masala', exact(2, 'tsp', '2 tsp garam masala'), [
      contrib(curry.id, 'garam-masala', exact(2, 'tsp', '2 tsp')),
    ]),
    {
      ingredientId: 'ing-salt', displayName: 'Salt',
      quantity: { kind: 'to_taste', originalText: 'salt, to taste' },
      contributions: [
        contrib(curry.id, 'salt', { kind: 'to_taste', originalText: 'to taste' }),
        contrib(soup.id, 'salt', { kind: 'to_taste', originalText: 'to taste' }),
      ],
    },
  ];
  return {
    planId,
    planName: 'This week',
    requirements,
    recipeTitles: Object.fromEntries(Object.values(RECIPES).map((r) => [r.id, r.title])),
  };
}

const CATEGORY: Record<string, string> = {
  'ing-onion': 'Fruit & veg', 'ing-garlic': 'Fruit & veg',
  'ing-chicken-breast': 'Meat & fish', 'ing-beef-mince': 'Meat & fish',
  'ing-double-cream': 'Dairy & eggs', 'ing-cheddar': 'Dairy & eggs',
  'ing-chopped-tomatoes': 'Tins & jars',
  'ing-spaghetti': 'Dry goods', 'ing-basmati': 'Dry goods',
  'ing-garam-masala': 'Herbs & spices', 'ing-salt': 'Herbs & spices',
};

/** Category for a requirement. TODO: use CanonicalIngredient.category once @fr/refdata is wired. */
export const categoryFor = (r: Requirement): string => (r.ingredientId && CATEGORY[r.ingredientId]) || 'Other';

/** In-memory stub: any plan id returns the fixture requirements (id 'empty' returns none). */
export class StubRequirementSource implements RequirementSource {
  async forPlan(planId: string): Promise<PlanRequirements | null> {
    if (!/^[\w-]{1,64}$/.test(planId)) return null;
    if (planId === 'missing') return null;
    if (planId === 'empty') return { planId, planName: 'Empty plan', requirements: [], recipeTitles: {} };
    return fixture(planId);
  }
}

export function getRequirementSource(): RequirementSource {
  return new StubRequirementSource();
}
