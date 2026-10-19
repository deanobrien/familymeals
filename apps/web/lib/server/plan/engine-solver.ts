/**
 * PlanSolver backed by the deterministic @fr/engine/planner (L9) `solvePlan` / `validatePlan`.
 *
 * The orchestrator speaks the @fr/ai `PlanConstraints` (the LLM-facing shape) and its own `Candidate` /
 * `SolveResult`; the engine owns the canonical solver schema (`PlanConstraintsInput`, `RecipeCandidateInput`).
 * This file is the ONE mapping between them (DECISIONS D29); `engine-solver.test.ts` pins it down.
 *
 * Hard exclusions: the orchestrator already removes candidates whose ingredient names hit
 * `excludeIngredients` (before solving and again at approval). The same names are passed to the engine as
 * `excludeTerms`, its secondary term safety net. Candidates do not carry canonical ingredient ids yet, so
 * `allowUnverifiedIngredients` is true: otherwise every recipe with an unmatched line would be dropped
 * whenever an exclusion exists. TODO: pass ingredient ids + unmatched lines once the recipe store has them.
 */
import type { PlanConstraintsInput, PlanProposal as EnginePlanProposal, RecipeCandidateInput } from '@fr/engine/planner';
import { solvePlan, validatePlan } from '@fr/engine/planner';
import type {
  Candidate, ConstraintReportItem, PlanConstraints, PlanSlot, PlanSolver, SolveOptions, SolveResult, ValidationResult,
} from '@fr/plan-orchestrator';
import { addDays } from '@fr/plan-orchestrator';

/** "Quick" for the AI's `quickMealDays` count (the engine needs concrete dates and a minutes cap). */
export const QUICK_MEAL_MAX_MINUTES = 30;

const isWeekday = (date: string): boolean => {
  const d = new Date(`${date}T00:00:00Z`).getUTCDay();
  return d >= 1 && d <= 5;
};

/** Pick `n` plan dates for quick meals: weekdays first (busy evenings), then the rest, in date order. */
export function quickMealDates(weekStart: string, days: number, n: number): string[] {
  const dates = Array.from({ length: days }, (_, i) => addDays(weekStart, i));
  return [...dates.filter(isWeekday), ...dates.filter((d) => !isWeekday(d))].slice(0, Math.max(0, n)).sort();
}

export function toEngineConstraints(c: PlanConstraints, opts: SolveOptions): PlanConstraintsInput {
  const out: PlanConstraintsInput = {
    startDate: opts.weekStart,
    days: c.days,
    mealTypes: c.mealTypes,
    servings: Math.max(1, Math.round(opts.servings)),
    includeTags: c.includeTags,
    excludeTerms: c.excludeIngredients,
    allowUnverifiedIngredients: true,
    favouritesOf: c.favouritesOf,
    repeats: 'avoid',
  };
  if (c.budgetPence !== undefined) out.budgetPence = c.budgetPence;
  const props = Object.entries(c.dietProportions ?? {}).filter(([, v]) => (v ?? 0) > 0);
  if (props.length) out.dietProportions = Object.fromEntries(props.map(([k, v]) => [k, { fraction: v! }]));
  if (c.quickMealDays) {
    out.quickMeals = {
      dates: quickMealDates(opts.weekStart, c.days, c.quickMealDays),
      weekdays: [],
      maxTotalMinutes: QUICK_MEAL_MAX_MINUTES,
    };
  }
  return out;
}

/**
 * Candidate -> engine RecipeCandidate. `costPence` on a Candidate is at the plan servings; the engine wants
 * per-serving pence. Favourites are matched by the member display names the orchestrator resolved.
 * Returns null for a candidate without a diet category (the engine needs one to honour proportions).
 */
export function toEngineCandidate(c: Candidate, servings: number): RecipeCandidateInput | null {
  if (!c.dietCategory) return null;
  return {
    id: c.id,
    title: c.title,
    dietCategory: c.dietCategory,
    tags: c.tags,
    ingredientNames: c.ingredientNames,
    totalMinutes: c.totalMinutes ?? null,
    estCostPerServingPence: c.costPence == null ? null : Math.round(c.costPence / Math.max(1, servings)),
    favouritedBy: c.favouriteOf ?? [],
    mealTypes: c.mealTypes,
  };
}

const KIND_LABEL: Record<string, string> = {
  hard_exclusions: 'Hard exclusions',
  coverage: 'Meals planned',
  diet_proportion: 'Diet mix',
  budget: 'Budget',
  favourites: 'Favourites',
  quick_meals: 'Quick meals',
  include_tags: 'Preferred tags',
  variety: 'Variety',
  pinned: 'Pinned meals',
};

export function fromEngineProposal(p: EnginePlanProposal): SolveResult {
  const slots: PlanSlot[] = p.slots
    .filter((s) => s.status !== 'skipped')
    .map((s) => ({
      date: s.date,
      mealType: s.mealType,
      recipeId: s.recipeId,
      servings: s.servings,
      ...(s.status === 'empty' ? { note: `No saved ${s.mealType} recipe fits; suggest a new one.` } : {}),
    }));
  const report: ConstraintReportItem[] = p.report
    .filter((r) => r.status !== 'not_applicable')
    .map((r) => ({
      constraint: r.kind === 'diet_proportion' ? `${r.id.replace(/^diet:/, '')} meals` : (KIND_LABEL[r.kind] ?? r.kind),
      met: r.status === 'met',
      detail: r.explanation,
    }));
  const uncostedMeals = p.slots
    .filter((s) => s.status === 'filled' && s.costPence == null)
    .map((s) => `${s.date} ${s.mealType}: ${s.title ?? s.recipeId}`);
  return {
    slots,
    report,
    explanations: [...p.explanations, ...p.notes],
    totalCostPence: p.cost.costedMeals > 0 ? p.cost.totalPence : null,
    uncostedMeals,
  };
}

export interface EngineSolverOptions {
  /**
   * Loads candidates for re-validation at approval (edited slots may name recipes the solve never saw).
   * Defaults to the candidates seen by earlier `solve` calls on this instance.
   */
  loadCandidates?: (ids: string[]) => Promise<Candidate[]>;
  seed?: number;
}

export function createEngineSolver(opts: EngineSolverOptions = {}): PlanSolver {
  const seen = new Map<string, Candidate>();

  const library = (cands: Candidate[], servings: number): RecipeCandidateInput[] =>
    cands.map((c) => toEngineCandidate(c, servings)).filter((c): c is RecipeCandidateInput => c !== null);

  return {
    solve(constraints, candidates, solveOpts): SolveResult {
      for (const c of candidates) seen.set(c.id, c);
      const proposal = solvePlan(toEngineConstraints(constraints, solveOpts), library(candidates, solveOpts.servings), {
        seed: opts.seed ?? 1,
      });
      return fromEngineProposal(proposal);
    },

    async validate(plan, constraints): Promise<ValidationResult> {
      const violations: string[] = [];
      for (const s of plan.slots) {
        if (!(s.servings > 0)) violations.push(`${s.date} ${s.mealType}: servings must be positive.`);
      }
      const dates = plan.slots.map((s) => s.date).sort();
      if (dates.length === 0) return { ok: violations.length === 0, violations };
      const weekStart = dates[0]!;
      const servings = Math.max(1, Math.round(constraints.servings ?? plan.slots[0]?.servings ?? 1));
      const ids = [...new Set(plan.slots.map((s) => s.recipeId).filter((x): x is string => !!x))];
      const cands = opts.loadCandidates ? await opts.loadCandidates(ids) : ids.flatMap((id) => seen.get(id) ?? []);
      const days = Math.max(constraints.days, Math.round((Date.parse(dates.at(-1)!) - Date.parse(weekStart)) / 86_400_000) + 1);
      const v = validatePlan(
        { slots: plan.slots.map((s) => ({ date: s.date, mealType: s.mealType, recipeId: s.recipeId, servings: s.servings })) },
        toEngineConstraints({ ...constraints, days }, { weekStart, servings }),
        library(cands, servings),
      );
      violations.push(...v.hardViolations.map((h) => h.message));
      return { ok: violations.length === 0, violations };
    },
  };
}
