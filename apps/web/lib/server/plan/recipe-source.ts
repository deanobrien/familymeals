import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { NutrientMap } from '@fr/engine/nutrition';
import type { Candidate, CandidateFilter, MealType, RecipeRepo } from '@fr/plan-orchestrator';
import { violatesExclusions } from '@fr/plan-orchestrator';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { allergensForIngredients } from './exclusions';
import type { RecipeRepository } from '../../recipes/repository';
import { costPerServing, totalMinutes, type RecipeView } from '../../recipes/types';

export interface PlanRecipe extends Candidate {
  baseServings: number;
  /** Per-serving cost estimate in pence; null = unknown (never 0). */
  costPerServingPence: number | null;
  /** true when some ingredients are unpriced, so the cost is a lower bound. */
  costPartial?: boolean;
  /** Calculated per-serving nutrition (D61); null/undefined = not calculated. */
  nutritionPerServing?: NutrientMap | null;
  ingredientLines: { name: string; quantityText: string }[];
  /** Canonical ingredient ids of matched lines (unmatched lines are absent). */
  ingredientIds?: string[];
  /** Household favourite (demo: stands in for per-member favourites). */
  favourite?: boolean;
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
const DEMO_FAVOURITES = new Set(['06-fish-pie', '08-chickpea-stew']);
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
        favourite: DEMO_FAVOURITES.has(id),
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

/** Lunch and dinner recipes are interchangeable main meals; breakfast / snack recipes stay in their slot. */
const mealTypesFor = (m: MealType): MealType[] => (m === 'lunch' || m === 'dinner' ? ['lunch', 'dinner'] : [m]);
export const QUICK_MINUTES = 30;

/** Library RecipeView -> PlanRecipe (cost per serving stays null when unknown, never 0). */
export function toPlanRecipe(r: RecipeView, nutritionOf?: (r: RecipeView) => NutrientMap | null): PlanRecipe {
  const minutes = totalMinutes(r);
  const ids = r.ingredients.flatMap((i) => (i.ingredientId ? [i.ingredientId] : []));
  const cat = getIngredientCatalogue();
  // Names + aliases of matched canonical ingredients; lines without a match are kept as text (never silently trusted).
  const canonicalNames = [...new Set(ids.flatMap((id) => { const c = cat.get(id); return c ? [c.name, ...c.aliases] : []; }))];
  const unmatchedLines = r.ingredients.filter((i) => !i.ingredientId).map((i) => (i.quantity.originalText.toLowerCase().includes(i.name.toLowerCase()) ? i.quantity.originalText : [i.quantity.originalText, i.name].filter(Boolean).join(' ')).trim());
  const tags = [...new Set([...r.tags, r.diet, ...(minutes != null && minutes <= QUICK_MINUTES ? ['quick'] : [])])];
  return {
    id: r.id,
    title: r.title,
    ingredientNames: r.ingredients.map((i) => i.name),
    ingredientLines: r.ingredients.map((i) => ({ name: i.name, quantityText: i.quantity.originalText })),
    ingredientIds: ids,
    canonicalNames,
    unmatchedLines,
    allergens: allergensForIngredients(ids, cat),
    tags,
    mealTypes: mealTypesFor(r.mealType),
    dietCategory: r.diet,
    ...(minutes != null ? { totalMinutes: minutes } : {}),
    baseServings: r.servings,
    costPerServingPence: costPerServing(r),
    ...(r.cost.partial ? { costPartial: true } : {}),
    ...(nutritionOf ? { nutritionPerServing: nutritionOf(r) } : {}),
    favourite: r.favourite,
  };
}

/** Plannable recipes straight from the shared recipe store (the library repository, DECISIONS D30). */
export class RepositoryPlanRecipeSource implements PlanRecipeSource {
  /** `nutritionOf` supplies calculated per-serving nutrition (lib/server/calc); omitted = planner shows no nutrition. */
  constructor(
    private readonly repo: RecipeRepository,
    private readonly nutritionOf?: (r: RecipeView) => NutrientMap | null,
  ) {}
  async list() {
    const all = await this.repo.list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 10_000 });
    return all.items.map((r) => toPlanRecipe(r, this.nutritionOf));
  }
  async get(_h: string, ids: string[]) {
    const found = await Promise.all(ids.map((id) => this.repo.get(id)));
    return found.filter((r): r is RecipeView => r !== null).map((r) => toPlanRecipe(r, this.nutritionOf));
  }
}

/** Adapts a PlanRecipeSource to the orchestrator's RecipeRepo (applies the hard exclusion filter). */
export function toRecipeRepo(source: PlanRecipeSource): RecipeRepo {
  const strip = (r: PlanRecipe): Candidate => {
    const { id, title, ingredientNames, tags, mealTypes, dietCategory, totalMinutes, ingredientIds, canonicalNames, unmatchedLines, allergens } = r;
    return { id, title, ingredientNames, tags, mealTypes, dietCategory, totalMinutes, ingredientIds, canonicalNames, unmatchedLines, allergens };
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
