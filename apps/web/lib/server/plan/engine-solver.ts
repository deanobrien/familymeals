/**
 * PlanSolver backed by the deterministic @fr/engine/planner (L9) `solvePlan` / `validatePlan`.
 *
 * Since D130 the orchestrator speaks the SAME canonical PlanConstraints as the engine (`@fr/domain`), so the old
 * D29 mapping layer is gone: constraints pass straight through (only servings are rounded to the plan servings).
 * What remains is the Candidate -> engine RecipeCandidate shape change and the engine proposal -> orchestrator
 * result mapping. Candidates carry canonical ingredient ids, unmatched line texts and derived allergens (D132),
 * so `allowUnverifiedIngredients` stays false: a recipe with an unverifiable line is only dropped when an
 * exclusion is set, and a line that mentions an excluded term is always dropped (engine behaviour).
 */
import type { PlanConstraintsInput, PlanProposal as EnginePlanProposal, RecipeCandidateInput } from '@fr/engine/planner';
import { solvePlan, validatePlan } from '@fr/engine/planner';
import type {
  Candidate, ConstraintReportItem, PlanConstraints, PlanSlot, PlanSolver, SolveOptions, SolveResult, ValidationResult,
} from '@fr/plan-orchestrator';

/** Pass-through: the canonical constraints are the engine input; only servings follow the plan servings. */
export function toEngineConstraints(c: PlanConstraints, opts: Pick<SolveOptions, 'servings'>): PlanConstraintsInput {
  return { ...c, servings: Math.max(1, Math.round(opts.servings)) };
}

/**
 * Candidate -> engine RecipeCandidate. `costPence` on a Candidate is at the plan servings; the engine wants
 * per-serving pence. Returns null for a candidate without a diet category (the engine needs one for proportions).
 */
export function toEngineCandidate(c: Candidate, servings: number): RecipeCandidateInput | null {
  if (!c.dietCategory) return null;
  return {
    id: c.id,
    title: c.title,
    dietCategory: c.dietCategory,
    tags: c.tags,
    ingredientIds: c.ingredientIds ?? [],
    ingredientNames: c.canonicalNames ?? c.ingredientNames,
    unmatchedLines: c.unmatchedLines ?? [],
    allergens: c.allergens ?? [],
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
        ...(solveOpts.memberLabels ? { labels: { members: solveOpts.memberLabels } } : {}),
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
      const servings = Math.max(1, Math.round(constraints.servings ?? plan.slots[0]?.servings ?? 1));
      const ids = [...new Set(plan.slots.map((s) => s.recipeId).filter((x): x is string => !!x))];
      const cands = opts.loadCandidates ? await opts.loadCandidates(ids) : ids.flatMap((id) => seen.get(id) ?? []);
      const start = constraints.startDate ?? dates[0]!;
      const span = Math.round((Date.parse(dates.at(-1)!) - Date.parse(start)) / 86_400_000) + 1;
      const v = validatePlan(
        { slots: plan.slots.map((s) => ({ date: s.date, mealType: s.mealType, recipeId: s.recipeId, servings: s.servings })) },
        // Grid edits may add meals beyond a short plan ("5 dinners"): widen the window, never reject them for it.
        toEngineConstraints({ ...constraints, days: Math.max(constraints.days ?? 7, span) }, { servings }),
        library(cands, servings),
      );
      violations.push(...v.hardViolations.map((h) => h.message));
      return { ok: violations.length === 0, violations };
    },
  };
}
