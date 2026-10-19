import type { Candidate, ConstraintReportItem, PlanConstraints, PlanSlot, PlanSolver, SolveOptions, SolveResult } from '@fr/plan-orchestrator';
import { addDays } from '@fr/plan-orchestrator';
import { DIET_CATEGORIES, roundProportions } from '../../plan/proportions';
import type { DietCategory } from '../../plan/types';

/**
 * TEMPORARY adapter: a simple diet-aware round-robin solver.
 * TODO(L9 merge): replace with @fr/engine/planner `solve` / `validatePlan`, mapping
 *   solve(constraints, candidates, opts) -> SolveResult and validatePlan(plan, constraints) -> ValidationResult.
 * The orchestrator only sees the PlanSolver interface, so nothing else changes. Hard exclusions are enforced
 * by the orchestrator before candidates reach this code.
 */
export function createRoundRobinSolver(): PlanSolver {
  return { solve, validate };
}

const pool = (cands: Candidate[], c: DietCategory) =>
  cands.filter((x) => x.dietCategory === c || (c === 'vegetarian' && x.dietCategory === 'vegan'));

/** Spread the target counts across the days (largest remaining share first) so categories alternate. */
function categorySequence(counts: Record<DietCategory, number>, n: number): DietCategory[] {
  const remaining = { ...counts };
  const seq: DietCategory[] = [];
  for (let i = 0; i < n; i++) {
    const next = [...DIET_CATEGORIES].sort((a, b) => remaining[b] - remaining[a])[0]!;
    if (remaining[next] <= 0) break;
    remaining[next]--;
    seq.push(next);
  }
  return seq;
}

function solve(constraints: PlanConstraints, candidates: Candidate[], opts: SolveOptions): SolveResult {
  const slots: PlanSlot[] = [];
  const explanations: string[] = [];
  const report: ConstraintReportItem[] = [];
  const used = new Map<string, number>();
  const byFav = (a: Candidate, b: Candidate) => (b.favouriteOf?.length ?? 0) - (a.favouriteOf?.length ?? 0);
  const pick = (list: Candidate[]): Candidate | undefined => {
    const sorted = [...list].sort((a, b) => (used.get(a.id) ?? 0) - (used.get(b.id) ?? 0) || byFav(a, b));
    return sorted[0];
  };
  const hasProps = Object.values(constraints.dietProportions ?? {}).some((v) => (v ?? 0) > 0);
  const rounded = hasProps ? roundProportions(constraints.dietProportions ?? {}, constraints.days) : undefined;
  if (rounded) explanations.push(...rounded.explanations);

  for (const mealType of constraints.mealTypes) {
    const forMeal = candidates.filter((c) => c.mealTypes.includes(mealType));
    const seq = rounded ? categorySequence(rounded.counts, constraints.days) : [];
    for (let d = 0; d < constraints.days; d++) {
      const date = addDays(opts.weekStart, d);
      const want = seq[d];
      let chosen = pick(want ? pool(forMeal, want) : forMeal);
      let note: string | undefined;
      if (!chosen && want) {
        note = `No saved ${want} recipe for ${mealType}; ${forMeal.length ? 'a different type was used' : 'a new recipe is needed'}.`;
        chosen = pick(forMeal);
        if (chosen) explanations.push(`${date}: ${note}`);
      }
      if (!chosen) {
        slots.push({ date, mealType, recipeId: null, servings: opts.servings, note: `No saved ${mealType} recipe matches; suggest a new one.` });
        continue;
      }
      used.set(chosen.id, (used.get(chosen.id) ?? 0) + 1);
      slots.push({ date, mealType, recipeId: chosen.id, servings: opts.servings, ...(note ? { note } : {}) });
    }
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));
  const filled = slots.filter((s) => s.recipeId);
  const mealsLeft = slots.length - filled.length;
  report.push({ constraint: 'Meals planned', met: mealsLeft === 0, detail: `${filled.length} of ${slots.length} slots filled from saved recipes.` });

  if (rounded) {
    for (const c of DIET_CATEGORIES) {
      if (rounded.counts[c] === 0) continue;
      const got = filled.filter((s) => byId.get(s.recipeId!)?.dietCategory === c || (c === 'vegetarian' && byId.get(s.recipeId!)?.dietCategory === 'vegan')).length;
      report.push({ constraint: `${c} meals`, met: got === rounded.counts[c], detail: `Target ${rounded.counts[c]} of ${constraints.days}, planned ${got}.` });
    }
  }
  for (const tag of constraints.includeTags) {
    const n = filled.filter((s) => byId.get(s.recipeId!)?.tags.includes(tag)).length;
    report.push({ constraint: `Include "${tag}"`, met: n > 0, detail: `${n} meal${n === 1 ? '' : 's'} tagged "${tag}" planned.` });
  }
  if (constraints.quickMealDays) {
    const n = filled.filter((s) => byId.get(s.recipeId!)?.tags.includes('quick')).length;
    report.push({ constraint: 'Quick meals', met: n >= constraints.quickMealDays, detail: `${n} quick meal${n === 1 ? '' : 's'} planned (wanted ${constraints.quickMealDays}).` });
  }

  let total = 0;
  const uncosted: string[] = [];
  for (const s of filled) {
    const c = byId.get(s.recipeId!);
    if (c?.costPence == null) uncosted.push(`${s.date} ${s.mealType}: ${c?.title ?? s.recipeId}`);
    else total += c.costPence;
  }
  if (constraints.budgetPence != null) {
    const over = total > constraints.budgetPence;
    const detail = uncosted.length
      ? `At least £${(total / 100).toFixed(2)} (estimate) with ${uncosted.length} meal${uncosted.length === 1 ? '' : 's'} uncosted, so staying within £${(constraints.budgetPence / 100).toFixed(2)} cannot be confirmed.`
      : `About £${(total / 100).toFixed(2)} (estimate) against a budget of £${(constraints.budgetPence / 100).toFixed(2)}.`;
    report.push({ constraint: 'Budget', met: !over && uncosted.length === 0, detail });
  }
  return { slots, report, explanations, totalCostPence: filled.length === uncosted.length ? null : total, uncostedMeals: uncosted };
}

function validate(plan: { slots: PlanSlot[] }) {
  const violations: string[] = [];
  for (const s of plan.slots) {
    if (!(s.servings > 0)) violations.push(`${s.date} ${s.mealType}: servings must be positive.`);
  }
  return { ok: violations.length === 0, violations };
}
