// Supabase-backed MealPlanRepository + PlanRecipeSource (lane S1, DECISIONS D50-D59).
// PlanDoc <-> meal_plans + planned_meals. save_meal_plan / select_meal_plans (migration 0015) do the multi-table work
// in one transaction; this file maps the row-shaped results through the @fr/domain row schemas.
import { MealPlan, PlannedMeal, fromDbRow, type DbRow } from '@fr/domain';
import { MEAL_TYPES, type MealType, type PlanDoc, type PlanEntry } from '../../plan/types';
import { toPlanRecipe, type PlanRecipe, type PlanRecipeSource } from '../plan/recipe-source';
import type { MealPlanRepository } from '../plan/repository';
import type { NutrientMap } from '@fr/engine/nutrition';
import type { RecipeView } from '../../recipes/types';
import type { SummariserFor } from './backend';
import { SupabaseRecipeRepository } from './recipe-repository';
import { callRpc, isUuid, toIso, type SupabaseClient } from './rpc';

interface PlanDocRow {
  plan: DbRow;
  meals: DbRow[];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isMealType = (v: unknown): v is MealType => (MEAL_TYPES as readonly unknown[]).includes(v);

/** meal_plans + planned_meals rows -> PlanDoc. eating_out / other both read back as `eating_out` (PlanEntry has no 'other'). */
export function planDocFromRows({ plan, meals }: PlanDocRow): PlanDoc {
  const p = fromDbRow(MealPlan, plan);
  const entries: PlanDoc['entries'] = {};
  for (const row of meals) {
    const m = fromDbRow(PlannedMeal, row);
    const note = m.notes ? { note: m.notes } : {};
    let entry: PlanEntry;
    if (m.kind === 'recipe' && m.recipeId) entry = { kind: 'recipe', recipeId: m.recipeId, servings: m.servings, ...note };
    else if (m.kind === 'leftovers') entry = { kind: 'leftovers', ...note };
    else entry = { kind: 'eating_out', ...note };
    entries[`${m.mealDate}|${m.mealType}`] = entry;
  }
  const c = p.constraints ?? {};
  const stored = Array.isArray(c.mealTypes) ? (c.mealTypes as unknown[]).filter(isMealType) : [];
  const used = MEAL_TYPES.filter((t) => Object.keys(entries).some((k) => k.endsWith(`|${t}`)));
  const mealTypes = stored.length > 0 ? stored : used.length > 0 ? [...used] : (['dinner'] as MealType[]);
  return {
    id: p.id,
    householdId: p.householdId,
    weekStart: p.startDate,
    mealTypes,
    entries,
    status: p.status === 'approved' ? 'approved' : 'draft',
    ...(p.budgetTargetPence !== null ? { budgetPence: p.budgetTargetPence } : {}),
    ...(p.planningPrompt ? { prompt: p.planningPrompt } : {}),
    ...(typeof c.proposalId === 'string' ? { proposalId: c.proposalId } : {}),
    updatedAt: toIso(p.updatedAt),
  };
}

export class SupabaseMealPlanRepository implements MealPlanRepository {
  constructor(
    private readonly client: SupabaseClient,
    /** Signed-in member (approved_by / created_by). null = service context. */
    private readonly userId: string | null = null,
  ) {}

  private async select(householdId: string, filters: { id?: string; weekStart?: string }): Promise<PlanDoc[]> {
    const rows = await callRpc<PlanDocRow[]>(this.client, 'select_meal_plans', {
      p_household_id: householdId,
      p_id: filters.id ?? null,
      p_start_date: filters.weekStart ?? null,
    });
    return (rows ?? []).map(planDocFromRows);
  }

  async getByWeek(householdId: string, weekStart: string): Promise<PlanDoc | null> {
    if (!isUuid(householdId) || !DATE_RE.test(weekStart)) return null;
    return (await this.select(householdId, { weekStart }))[0] ?? null;
  }

  async get(householdId: string, id: string): Promise<PlanDoc | null> {
    if (!isUuid(householdId) || !isUuid(id)) return null;
    return (await this.select(householdId, { id }))[0] ?? null;
  }

  async list(householdId: string): Promise<PlanDoc[]> {
    if (!isUuid(householdId)) return [];
    return this.select(householdId, {});
  }

  /** Upsert by id; any other live plan for the same household + week is archived (history kept). */
  async save(doc: PlanDoc): Promise<void> {
    if (!isUuid(doc.householdId)) throw new Error(`Plan household id must be a UUID (got "${doc.householdId}")`);
    if (!isUuid(doc.id)) throw new Error(`Plan id must be a UUID (got "${doc.id}")`);
    if (!DATE_RE.test(doc.weekStart)) throw new Error(`Plan weekStart must be YYYY-MM-DD (got "${doc.weekStart}")`);
    for (const [key, e] of Object.entries(doc.entries)) {
      if (e.kind === 'recipe' && !isUuid(e.recipeId)) throw new Error(`Plan entry ${key}: recipe id must be a UUID (got "${e.recipeId}")`);
    }
    await callRpc<null>(this.client, 'save_meal_plan', { p_household_id: doc.householdId, p_user_id: this.userId, p_doc: doc });
  }
}

export interface PlanSourceOptions {
  /** Same summariser the in-memory source uses: planner costs come from the calculator, computed on read (D100). */
  summariserFor?: SummariserFor | undefined;
  /** Calculated per-serving nutrition for the planner (D61). */
  nutritionOf?: ((r: RecipeView) => NutrientMap | null) | undefined;
}

/** Plannable recipes straight from the household's recipes (cost and nutrition are computed on read, D100). */
export class SupabasePlanRecipeSource implements PlanRecipeSource {
  constructor(
    private readonly client: SupabaseClient,
    private readonly userId: string | null = null,
    private readonly opts: PlanSourceOptions = {},
  ) {}

  private repo(householdId: string): SupabaseRecipeRepository {
    return new SupabaseRecipeRepository({
      client: this.client,
      householdId,
      userId: this.userId,
      summariser: this.opts.summariserFor?.(householdId),
    });
  }

  async list(householdId: string): Promise<PlanRecipe[]> {
    if (!isUuid(householdId)) return [];
    const all = await this.repo(householdId).list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 10_000 });
    return all.items.map((r) => toPlanRecipe(r, this.opts.nutritionOf));
  }

  async get(householdId: string, ids: string[]): Promise<PlanRecipe[]> {
    if (!isUuid(householdId)) return [];
    return (await this.repo(householdId).getMany(ids)).map((r) => toPlanRecipe(r, this.opts.nutritionOf));
  }
}
