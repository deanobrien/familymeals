import type { Pence } from '../contract';

export type BudgetStatus = 'within' | 'over' | 'unknown';

export interface BudgetCheck {
  status: BudgetStatus;
  costPence: Pence | null;
  targetPence: Pence;
  /** cost - target (positive = over). null if unknown. */
  variancePence: Pence | null;
  /** true when the cost is a lower bound (some items uncosted). */
  costIsPartial: boolean;
  headroomPence: Pence | null;
}

/** Meal / plan budget check. `costPence` null = nothing costed -> 'unknown' (never silently "within"). */
export function checkBudget(costPence: Pence | null, targetPence: Pence, opts: { costIsPartial?: boolean } = {}): BudgetCheck {
  const partial = opts.costIsPartial ?? false;
  if (costPence === null) return { status: 'unknown', costPence, targetPence, variancePence: null, costIsPartial: partial, headroomPence: null };
  const variance = costPence - targetPence;
  // A partial cost over target is certainly over; a partial cost under target cannot be called within.
  const status: BudgetStatus = variance > 0 ? 'over' : partial ? 'unknown' : 'within';
  return { status, costPence, targetPence, variancePence: variance, costIsPartial: partial, headroomPence: Math.max(0, -variance) };
}

/** Sum of per-meal costs vs a weekly target; unknown/partial meals make the total partial. */
export function checkPlanBudget(
  meals: readonly { costPence: Pence | null; isPartial?: boolean }[], targetPence: Pence,
): BudgetCheck & { unknownMeals: number } {
  const known = meals.filter(m => m.costPence !== null);
  const total = known.length ? known.reduce((s, m) => s + (m.costPence ?? 0), 0) : null;
  const unknownMeals = meals.length - known.length;
  const partial = unknownMeals > 0 || meals.some(m => m.isPartial);
  return { ...checkBudget(total, targetPence, { costIsPartial: partial }), unknownMeals };
}
