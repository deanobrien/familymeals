import type { AiProvider } from '@fr/ai';
import { settingsAiProvider } from '../ai/provider';
import {
  InMemoryProposalStore, PlanOrchestrator,
  type CostService, type Household, type HouseholdRepo, type MealRef, type ShoppingRequirement,
} from '@fr/plan-orchestrator';
import { getRecipeRepository } from '../../recipes/factory';
import { RepositoryPlanRecipeSource, toRecipeRepo, type PlanRecipeSource } from './recipe-source';
import { InMemoryMealPlanRepository, type MealPlanRepository } from './repository';
import { createEngineSolver } from './engine-solver';
import { createSupabaseMealPlanRepository, createSupabasePlanRecipeSource, useSupabaseBackend } from '../supabase/backend';

export const DEMO_HOUSEHOLD_ID = 'demo-household';
/** Supabase mode needs a real household uuid: interim SUPABASE_DEFAULT_HOUSEHOLD_ID until the auth lane supplies the session's. */
const planHouseholdId = (): string => (useSupabaseBackend() ? (process.env.SUPABASE_DEFAULT_HOUSEHOLD_ID ?? DEMO_HOUSEHOLD_ID) : DEMO_HOUSEHOLD_ID);

/** TODO(Supabase): resolve the signed-in user's household; exclusions from member dietary profiles. */
export function demoHousehold(): Household {
  return {
    id: planHouseholdId(),
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
  /** TODO(L-shopping): create/update the real shopping list from confirmed requirements. */
  onShoppingRequirements?: (householdId: string, planId: string, reqs: ShoppingRequirement[]) => Promise<void>;
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

export function createPlanServices(opts: { ai?: AiProvider; recipes?: PlanRecipeSource; plans?: MealPlanRepository; household?: Household } = {}): PlanServices {
  const household = opts.household ?? demoHousehold();
  const supabase = useSupabaseBackend();
  const recipes = opts.recipes ?? (supabase ? createSupabasePlanRecipeSource() : new RepositoryPlanRecipeSource(getRecipeRepository()));
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
    costs: createCostService(recipes),
    proposals: new InMemoryProposalStore(),
  });
  return { household, households, recipes, plans: opts.plans ?? (supabase ? createSupabaseMealPlanRepository() : new InMemoryMealPlanRepository()), orchestrator, newId: () => crypto.randomUUID(), now: () => new Date() };
}

const g = globalThis as { __frPlanServices?: PlanServices };
/** Process-wide singleton (globalThis so Next dev's separate RSC/action module graphs share state). */
export function getPlanServices(): PlanServices {
  return (g.__frPlanServices ??= createPlanServices());
}
