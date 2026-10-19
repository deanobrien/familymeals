import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { Candidate, CandidateFilter, MealType, RecipeRepo } from '@fr/plan-orchestrator';
import { violatesExclusions } from '@fr/plan-orchestrator';

export interface PlanRecipe extends Candidate {
  baseServings: number;
  /** Per-serving cost estimate in pence; null = unknown (never 0). */
  costPerServingPence: number | null;
  ingredientLines: { name: string; quantityText: string }[];
}

/** Where plannable recipes come from. TODO(Supabase): back with the recipes table (household-scoped, RLS). */
export interface PlanRecipeSource {
  list(householdId: string): Promise<PlanRecipe[]>;
  get(householdId: string, ids: string[]): Promise<PlanRecipe[]>;
}

// Placeholder demo estimates standing in for @fr/engine cost + refdata prices (TODO). Two recipes stay
// deliberately uncosted so the UI's "uncosted" honesty path is exercised.
const DEMO_COST_PER_SERVING_PENCE: Record<string, number> = {
  '01-tomato-pasta': 95,
  '03-beef-stew-two-page': 310,
  '05-blurry-curry': 140,
  '06-fish-pie': 285,
};
const QUICK = new Set(['01-tomato-pasta', '05-blurry-curry', '07-porridge']);
const MEAL_TYPES: Record<string, MealType[]> = {
  '02-lemon-loaf': ['snack'],
  '07-porridge': ['breakfast'],
};

interface FixtureRecipe {
  diet?: 'meat' | 'fish' | 'vegetarian' | 'vegan';
  expected: {
    title: string;
    servings: number;
    ingredients: { name: string; quantity?: { originalText?: string } }[];
  };
}

function fixturesDir(): string {
  const candidates = [
    path.resolve(process.cwd(), '../../e2e/fixtures/recipes'),
    path.resolve(process.cwd(), 'e2e/fixtures/recipes'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`Recipe fixtures not found (looked in ${candidates.join(', ')})`);
  return found;
}

export function loadFixtureRecipes(dir = fixturesDir()): PlanRecipe[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.expected.json'))
    .sort()
    .map((f) => {
      const id = f.replace('.expected.json', '');
      const fx = JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as FixtureRecipe;
      const tags = [fx.diet, QUICK.has(id) ? 'quick' : undefined].filter((t): t is string => !!t);
      return {
        id,
        title: fx.expected.title,
        ingredientNames: fx.expected.ingredients.map((i) => i.name),
        ingredientLines: fx.expected.ingredients.map((i) => ({ name: i.name, quantityText: i.quantity?.originalText ?? '' })),
        tags,
        mealTypes: MEAL_TYPES[id] ?? ['lunch', 'dinner'],
        dietCategory: fx.diet,
        totalMinutes: QUICK.has(id) ? 25 : undefined,
        baseServings: fx.expected.servings,
        costPerServingPence: DEMO_COST_PER_SERVING_PENCE[id] ?? null,
      } satisfies PlanRecipe;
    });
}

export class InMemoryPlanRecipeSource implements PlanRecipeSource {
  constructor(private readonly recipes: PlanRecipe[] = loadFixtureRecipes()) {}
  async list() {
    return structuredClone(this.recipes);
  }
  async get(_h: string, ids: string[]) {
    return structuredClone(this.recipes.filter((r) => ids.includes(r.id)));
  }
}

/** Adapts a PlanRecipeSource to the orchestrator's RecipeRepo (applies the hard exclusion filter). */
export function toRecipeRepo(source: PlanRecipeSource): RecipeRepo {
  const strip = (r: PlanRecipe): Candidate => {
    const { id, title, ingredientNames, tags, mealTypes, dietCategory, totalMinutes } = r;
    return { id, title, ingredientNames, tags, mealTypes, dietCategory, totalMinutes };
  };
  return {
    tagVocabulary: async (h) => [...new Set((await source.list(h)).flatMap((r) => r.tags))].sort(),
    searchCandidates: async (h, f: CandidateFilter) =>
      (await source.list(h))
        .filter((r) => violatesExclusions(r.ingredientNames, f.excludeIngredients).length === 0)
        .filter((r) => f.mealTypes.length === 0 || r.mealTypes.some((m) => f.mealTypes.includes(m)))
        .map(strip),
    getRecipes: async (h, ids) => (await source.get(h, ids)).map(strip),
  };
}
