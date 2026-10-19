import type { AiProvider } from '@fr/ai';
import { settingsAiProvider } from '../ai/provider';
import {
  InMemoryProposalStore, PlanOrchestrator,
  type CostService, type Household, type HouseholdRepo, type MealRef, type ShoppingRequirement,
} from '@fr/plan-orchestrator';
import { getRecipeRepository } from '../../recipes/factory';
import { getRecipeCalculator } from '../calc';
import { summariserForHousehold } from '../calc/household';
import { RepositoryPlanRecipeSource, toPlanRecipe, toRecipeRepo, type PlanRecipeSource } from './recipe-source';
import { getPlanStore, InMemoryMealPlanRepository, resetPlanStore, type MealPlanRepository } from './repository';
import { createEngineSolver } from './engine-solver';
import { formatQuantity } from '../../shopping/format';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { getRequirementSource } from '../shopping/approved-plan-source';
import { buildRequirementsForMeals } from '../shopping/plan-requirements';
import { getShoppingRepository } from '../shopping/repository';
import { generateFromPlan } from '../shopping/service';
import { createSupabaseMealPlanRepository, createSupabasePlanRecipeSource, useSupabaseBackend } from '../supabase/backend';

export const DEMO_HOUSEHOLD_ID = 'demo-household';

/**
 * Planner profile for a household. The id comes from the session (getAppContext); members, exclusions and
 * budget are still demo values. TODO(Supabase): load from household_members + dietary profiles.
 */
export function demoHousehold(id: string = DEMO_HOUSEHOLD_ID): Household {
  return {
    id,
    defaultServings: 4,
    weeklyBudgetPence: 10000,
    hardExclusions: [{ ingredientName: 'peanuts', kind: 'allergy' }],
    members: [
      { id: 'm-lauren', displayName: 'Lauren' },
      { id: 'm-sam', displayName: 'Sam' },
    ],
  };
}

export interface PlanServices {
  household: Household;
  households: HouseholdRepo;
  recipes: PlanRecipeSource;
  plans: MealPlanRepository;
  orchestrator: PlanOrchestrator;
  newId: () => string;
  now: () => Date;
  /** Creates/updates the household's shopping list from the approved plan (wired in getPlanServicesFor). */
  onShoppingRequirements?: (householdId: string, planId: string, reqs: ShoppingRequirement[], actor: string) => Promise<void>;
}

export function createCostService(recipes: PlanRecipeSource): CostService {
  return {
    async costRecipes(h, ids, servings) {
      const found = await recipes.get(h, ids);
      return Object.fromEntries(
        ids.map((id) => {
          const r = found.find((x) => x.id === id);
          return [id, r?.costPerServingPence == null ? null : Math.round(r.costPerServingPence * servings)];
        }),
      );
    },
    /** Aggregated by ingredient name only; unit-aware aggregation arrives with @fr/engine (TODO). */
    async buildRequirements(h, meals: MealRef[]) {
      const found = new Map((await recipes.get(h, [...new Set(meals.map((m) => m.recipeId))])).map((r) => [r.id, r]));
      const out = new Map<string, ShoppingRequirement>();
      for (const m of meals) {
        for (const line of found.get(m.recipeId)?.ingredientLines ?? []) {
          const key = line.name.toLowerCase();
          const cur = out.get(key) ?? { displayName: line.name, quantityText: '', contributions: [] };
          cur.quantityText = [cur.quantityText, line.quantityText].filter(Boolean).join(' + ');
          cur.contributions.push({ recipeId: m.recipeId, plannedMealId: m.plannedMealId });
          out.set(key, cur);
        }
      }
      return [...out.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
    },
  };
}

export function createPlanServices(opts: {
  ai?: AiProvider; recipes?: PlanRecipeSource; plans?: MealPlanRepository; household?: Household;
  /** Overrides the name-only requirement preview (production: @fr/engine/aggregate over the recipe store). */
  buildRequirements?: CostService['buildRequirements'];
} = {}): PlanServices {
  const household = opts.household ?? demoHousehold();
  const supabase = useSupabaseBackend();
  // Cost and nutrition come from this household's calculator in both backends, computed on read (D100, D101).
  const nutritionOf = (r: Parameters<typeof toPlanRecipe>[0]) => getRecipeCalculator(household.id).nutritionPerServing(r);
  const recipes = opts.recipes ?? (supabase
    ? createSupabasePlanRecipeSource(undefined, { summariserFor: summariserForHousehold, nutritionOf })
    : new RepositoryPlanRecipeSource(getRecipeRepository(), nutritionOf));
  const households: HouseholdRepo = {
    getHousehold: async (id) => (id === household.id ? structuredClone(household) : null),
    // TODO(Supabase): per-member favourites. Demo: Lauren's favourites are the household favourites.
    getFavouriteRecipeIds: async (h, memberId) =>
      memberId === 'm-lauren' ? (await recipes.list(h)).filter((r) => r.favourite).map((r) => r.id) : [],
  };
  // Resolved per call from Settings > AI provider, else env, else the dev mock (D41).
  const ai = opts.ai ?? settingsAiProvider;
  const recipeRepo = toRecipeRepo(recipes);
  const orchestrator = new PlanOrchestrator({
    ai,
    solver: createEngineSolver({ loadCandidates: (ids) => recipeRepo.getRecipes(household.id, ids) }),
    households,
    recipes: recipeRepo,
    costs: opts.buildRequirements ? { ...createCostService(recipes), buildRequirements: opts.buildRequirements } : createCostService(recipes),
    proposals: new InMemoryProposalStore(),
  });
  return { household, households, recipes, plans: opts.plans ?? (supabase ? createSupabaseMealPlanRepository() : new InMemoryMealPlanRepository()), orchestrator, newId: () => crypto.randomUUID(), now: () => new Date() };
}

const g = globalThis as { __frPlanServicesByHousehold?: Map<string, PlanServices> };

/**
 * Planner services scoped to one household (cached per household so AI proposals survive between requests).
 * Wiring: shared plan store, aggregate-based requirements, and the shopping-list hook (D33).
 */
export function getPlanServicesFor(householdId: string): PlanServices {
  const map = (g.__frPlanServicesByHousehold ??= new Map<string, PlanServices>());
  let svc: PlanServices | undefined = map.get(householdId);
  if (!svc) {
    svc = createPlanServices({
      household: demoHousehold(householdId),
      ...(useSupabaseBackend() ? {} : { plans: getPlanStore() }),
      buildRequirements: async (_h, meals) => {
        const built = await buildRequirementsForMeals(meals, getRecipeRepository(), getIngredientCatalogue());
        return built.requirements.map((r) => ({
          displayName: r.displayName,
          ...(r.ingredientId ? { ingredientId: r.ingredientId } : {}),
          quantityText: formatQuantity(r.quantity),
          contributions: r.contributions.map((c) => ({ recipeId: c.recipeId, plannedMealId: c.plannedMealId ?? '' })),
        }));
      },
    });
    svc.onShoppingRequirements = async (h, planId, _reqs, actor) => {
      await generateFromPlan(getShoppingRepository(), getRequirementSource(), h, planId, actor, () => crypto.randomUUID());
    };
    map.set(householdId, svc);
  }
  return svc;
}

/** Test/e2e reset of every in-memory planner store. */
export function resetPlanServices(): void {
  resetPlanStore();
  g.__frPlanServicesByHousehold = undefined;
}
