import type { IsoDate, MealType } from '../contract';
import { prepareProblem, slotKey, type HardReasonCode } from './problem';
import { buildEvaluation, type PlanEvaluation } from './report';
import type { PlanConstraintsInput, PlannerOptions, RecipeCandidateInput } from './schemas';
import type { Assignment } from './score';

export interface PlanSlotToValidate {
  date: IsoDate;
  mealType: MealType;
  recipeId: string | null;
  servings?: number;
}

export interface PlanToValidate {
  slots: PlanSlotToValidate[];
}

export type HardViolationCode =
  | HardReasonCode
  | 'unknown_recipe'
  | 'slot_out_of_range'
  | 'duplicate_slot'
  | 'skipped_slot_filled'
  | 'repeat_forbidden';

export interface HardViolation {
  code: HardViolationCode;
  slotKey: string;
  recipeId?: string;
  message: string;
}

export interface PlanValidation extends PlanEvaluation {
  /** False if ANY hard constraint is violated. Callers must refuse to save when false. */
  ok: boolean;
  hardViolations: HardViolation[];
  warnings: string[];
}

/**
 * Re-check a (possibly user-edited) plan before save. Hard constraints are re-derived from the
 * constraints + current library, never trusted from the proposal. Soft constraints are re-scored
 * with the same report the solver produces.
 */
export function validatePlan(
  plan: PlanToValidate,
  constraints: PlanConstraintsInput,
  library: RecipeCandidateInput[],
  options: PlannerOptions = {},
): PlanValidation {
  const p = prepareProblem(constraints, library, options);
  const hardViolations: HardViolation[] = [];
  const warnings: string[] = [];
  const a: Assignment = new Array(p.slots.length).fill(null);
  const seen = new Set<string>();
  const uses = new Map<string, string[]>();

  for (const ps of plan.slots) {
    const key = slotKey(ps.date, ps.mealType);
    const si = p.slotIndex.get(key);
    if (seen.has(key)) {
      hardViolations.push({ code: 'duplicate_slot', slotKey: key, message: `Slot ${key} appears more than once.` });
      continue;
    }
    seen.add(key);
    if (si === undefined) {
      if (ps.recipeId !== null) {
        hardViolations.push({ code: 'slot_out_of_range', slotKey: key, recipeId: ps.recipeId, message: `Slot ${key} is outside the plan's dates/meal types.` });
      }
      continue;
    }
    if (ps.recipeId === null) continue;
    const slot = p.slots[si]!;
    const rid = ps.recipeId;
    if (slot.skipReason) {
      hardViolations.push({ code: 'skipped_slot_filled', slotKey: key, recipeId: rid, message: `${key} is marked ${slot.skipReason.replace('_', ' ')} but has a recipe.` });
      continue;
    }
    const ci = p.idIndex.get(rid);
    if (ci === undefined) {
      hardViolations.push({ code: 'unknown_recipe', slotKey: key, recipeId: rid, message: `Recipe ${rid} is not in the library, so it cannot be checked against exclusions.` });
      continue;
    }
    const title = p.candidates[ci]!.title ?? rid;
    for (const r of p.hardReasons[ci]!) {
      hardViolations.push({ code: r.code, slotKey: key, recipeId: rid, message: `"${title}" on ${key}: ${r.message}.` });
    }
    if (!slot.eligibleSet.has(ci) && p.hardReasons[ci]!.length === 0) {
      warnings.push(`"${title}" is not marked as suitable for ${slot.mealType}.`);
    }
    if (ps.servings !== undefined && ps.servings !== p.constraints.servings) {
      warnings.push(`${key} has ${ps.servings} servings; costs are reported for ${p.constraints.servings}.`);
    }
    uses.set(rid, [...(uses.get(rid) ?? []), key]);
    a[si] = ci;
  }

  if (p.constraints.repeats === 'never') {
    for (const [rid, keys] of uses) {
      if (keys.length > 1) {
        for (const key of keys.slice(1)) {
          hardViolations.push({ code: 'repeat_forbidden', slotKey: key, recipeId: rid, message: `Recipe ${rid} is repeated but repeats are set to 'never'.` });
        }
      }
    }
  }
  for (const s of p.slots) {
    if (s.lockedCandidate !== undefined && a[s.index] !== s.lockedCandidate) {
      warnings.push(`Pinned meal on ${s.key} was changed.`);
    }
  }
  warnings.push(...p.lockIssues);

  const evaluation = buildEvaluation(p, a, { hardViolationCount: hardViolations.length });
  return { ...evaluation, ok: hardViolations.length === 0, hardViolations, warnings };
}
