import type { AiProvider } from '@fr/ai';
import { settingsAiProvider } from '../ai/provider';
import {
  InMemoryProposalStore, PlanOrchestrator,
  type CostService, type Household, type HouseholdRepo, type MealRef, type ShoppingRequirement,
} from '@fr/plan-orchestrator';
import { getRecipeRepositoryFor } from '../../recipes/factory';
import { getRecipeCalculator } from '../calc';
import { summariserForHousehold } from '../calc/household';
import { RepositoryPlanRecipeSource, toPlanRecipe, toRecipeRepo, type PlanRecipeSource } from './recipe-source';
import { getMealPlanStore, getPlanStore, InMemoryMealPlanRepository, resetPlanStore, type MealPlanRepository } from './repository';
import { createEngineSolver } from './engine-solver';
import { createExclusionResolver } from './exclusions';
import { formatQuantity } from '../../shopping/format';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { getRequirementSource } from '../shopping/approved-plan-source';
import { buildRequirementsForMeals } from '../shopping/plan-requirements';
import { getShoppingStore } from '../shopping/store';
import { generateFromPlan } from '../shopping/service';
import { peekMemorySettings } from '../settings/memory-store';
import { createSupabaseHouseholdProfile, createSupabasePlanRecipeSource, useSupabaseBackend } from '../supabase/backend';

export const DEMO_HOUSEHOLD_ID = 'demo-household';

/**
 * Demo planner profile (in-memory / mock-auth mode). With DATA_BACKEND=supabase, loadPlanServices replaces it per request
 * with the household's real profile: active members, consented exclusions, budget, servings (D125).
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

/** Where the planner reads the household profile and per-member favourites (Supabase, D125). */
export interface HouseholdProfileSource {
  load(householdId: string): Promise<(Household & { withheldExclusions?: number }) | null>;
  favourites(householdId: string, memberId: string): Promise<string[]>;
}

export interface PlanServices {
  /** The household profile for THIS request (refreshed by loadPlanServices in Supabase mode). */
  household: Household;
  /** Allergy/intolerance exclusions withheld because the recorder's consent was withdrawn (Supabase only). */
  withheldExclusions?: number;
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
  /** Real profile + favourites (Supabase). Absent: the demo favourites rule below. */
  profile?: HouseholdProfileSource;
  /** Overrides the name-only requirement preview (production: @fr/engine/aggregate over the recipe store). */
  buildRequirements?: CostService['buildRequirements'];
} = {}): PlanServices {
  const household = opts.household ?? demoHousehold();
  const supabase = useSupabaseBackend();
  // Cost and nutrition come from this household's calculator in both backends, computed on read (D100, D101).
  const nutritionOf = (r: Parameters<typeof toPlanRecipe>[0]) => getRecipeCalculator(household.id).nutritionPerServing(r);
  const recipes = opts.recipes ?? (supabase
    ? createSupabasePlanRecipeSource(undefined, { summariserFor: summariserForHousehold, nutritionOf })
    : new RepositoryPlanRecipeSource(getRecipeRepositoryFor(household.id), nutritionOf));
  // eslint-disable-next-line prefer-const
  let services: PlanServices;
  const households: HouseholdRepo = {
    getHousehold: async (id) => (id === services.household.id ? structuredClone(services.household) : null),
    // Supabase: the member's own recipe_favourites rows. Demo: Lauren's favourites are the household favourites.
    getFavouriteRecipeIds: async (h, memberId) =>
      opts.profile
        ? opts.profile.favourites(h, memberId)
        : memberId === 'm-lauren' ? (await recipes.list(h)).filter((r) => r.favourite).map((r) => r.id) : [],
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
    resolveExclusions: createExclusionResolver(), // names -> ingredient ids / UK-14 groups (D132)
  });
  services = { household, households, recipes, plans: opts.plans ?? (supabase ? getMealPlanStore() : new InMemoryMealPlanRepository()), orchestrator, newId: () => crypto.randomUUID(), now: () => new Date() };
  return services;
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
      ...(useSupabaseBackend() ? { profile: createSupabaseHouseholdProfile() } : { plans: getPlanStore() }),
      buildRequirements: async (h, meals) => {
        const built = await buildRequirementsForMeals(meals, getRecipeRepositoryFor(h), getIngredientCatalogue());
        return built.requirements.map((r) => ({
          displayName: r.displayName,
          ...(r.ingredientId ? { ingredientId: r.ingredientId } : {}),
          quantityText: formatQuantity(r.quantity),
          contributions: r.contributions.map((c) => ({ recipeId: c.recipeId, plannedMealId: c.plannedMealId ?? '' })),
        }));
      },
    });
    svc.onShoppingRequirements = async (h, planId, _reqs, actor) => {
      await generateFromPlan(getShoppingStore(), getRequirementSource(), h, planId, actor, () => crypto.randomUUID());
    };
    map.set(householdId, svc);
  }
  return svc;
}

/**
 * Planner services for THIS request. Supabase mode: the household profile is re-read (members, consented exclusions,
 * budget) so a change in Household settings applies at once; it falls back to an empty profile, never the demo one.
 */
export async function loadPlanServices(householdId: string): Promise<PlanServices> {
  const svc = getPlanServicesFor(householdId);
  if (useSupabaseBackend()) {
    const p = await createSupabaseHouseholdProfile().load(householdId);
    const { withheldExclusions = 0, ...household } = p ?? { id: householdId, hardExclusions: [], members: [] };
    svc.household = household;
    svc.withheldExclusions = withheldExclusions;
  } else {
    // Mock mode: once Settings has saved anything for this household, its profile drives the planner (P0-D, D351):
    // exclusions apply only while consent is active, otherwise they are withheld and the consent notice counts them.
    const saved = peekMemorySettings(householdId);
    if (saved) {
      const next = {
        ...svc.household,
        defaultServings: saved.defaultServings,
        hardExclusions: saved.consentActive ? saved.exclusions.map((ingredientName) => ({ ingredientName, kind: 'allergy' as const })) : [],
        // Soft dislikes (P1-B, D378): independent of allergy consent.
        members: svc.household.members.map(({ dislikes: _old, ...m }) => {
          const terms = saved.members.find((x) => x.memberId === m.id)?.terms ?? [];
          return terms.length ? { ...m, dislikes: terms } : m;
        }),
      };
      if (saved.weeklyBudgetPence === null) delete next.weeklyBudgetPence;
      else next.weeklyBudgetPence = saved.weeklyBudgetPence;
      svc.household = next;
      svc.withheldExclusions = saved.withheldExclusions;
    }
  }
  return svc;
}

/** Test/e2e reset of every in-memory planner store. */
export function resetPlanServices(): void {
  resetPlanStore();
  g.__frPlanServicesByHousehold = undefined;
}
