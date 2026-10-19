import { z } from 'zod';
import {
  DietProportionsSchema,
  DietTargetSchema,
  LockedSlotSchema,
  PLAN_DIET_CATEGORIES,
  PLAN_MEAL_TYPES,
  PlanConstraintsSchema,
  PlanDateSchema,
  PlanDietCategorySchema,
  PlanMealTypeSchema,
  PlanWeekdaySchema,
  QuickMealsSchema,
  SkipReasonSchema,
  SkipSlotSchema,
  type DietTarget,
  type PlanConstraints,
  type PlanConstraintsInput,
  type SkipReason,
} from '@fr/domain';

/**
 * The PlanConstraints schema lives in @fr/domain (DECISIONS D130); these are re-exports under the planner's
 * historical names so the solver, its tests and consumers keep one import path.
 */
export const IsoDateSchema = PlanDateSchema;
export const MEAL_TYPES = PLAN_MEAL_TYPES;
export const DIET_CATEGORIES = PLAN_DIET_CATEGORIES;
export const MealTypeSchema = PlanMealTypeSchema;
export const DietCategorySchema = PlanDietCategorySchema;
export const WeekdaySchema = PlanWeekdaySchema;
export {
  DietProportionsSchema, DietTargetSchema, LockedSlotSchema, PlanConstraintsSchema, QuickMealsSchema, SkipReasonSchema, SkipSlotSchema,
};
export type { DietTarget, PlanConstraints, PlanConstraintsInput, SkipReason };

/** Recipe summary fed to the solver (built from the library by the caller). */
export const RecipeCandidateSchema = z.object({
  id: z.string().min(1),
  title: z.string().optional(),
  dietCategory: DietCategorySchema,
  tags: z.array(z.string()).default([]),
  ingredientIds: z.array(z.string()).default([]),
  /** Names + aliases of the matched canonical ingredients (secondary term safety net). */
  ingredientNames: z.array(z.string()).default([]),
  /** originalText of ingredient lines with no canonical ingredient match. */
  unmatchedLines: z.array(z.string()).default([]),
  /**
   * Count of unmatched ingredient lines when the texts are not supplied.
   * Effective count = max(unmatchedIngredientCount, unmatchedLines.length).
   */
  unmatchedIngredientCount: z.number().int().min(0).default(0),
  /** Allergens derived upstream from matched ingredients. */
  allergens: z.array(z.string()).default([]),
  totalMinutes: z.number().min(0).nullable(),
  estCostPerServingPence: z.number().int().min(0).nullable(),
  favouritedBy: z.array(z.string()).default([]),
  lastCookedOn: IsoDateSchema.optional(),
  /** If set, the recipe is only offered for these meal types. */
  mealTypes: z.array(MealTypeSchema).optional(),
});
export type RecipeCandidateInput = z.input<typeof RecipeCandidateSchema>;
export type RecipeCandidate = z.output<typeof RecipeCandidateSchema>;

/** Soft-objective weights (penalty points; lower total = better). */
export interface PlannerWeights {
  dietPerMeal: number;
  budgetPerPound: number;
  uncostedWithBudget: number;
  favourite: number;
  quickMiss: number;
  includeTag: number;
  repeat: number;
  recent: number;
  emptySlot: number;
  costTieBreakPerPound: number;
}

export const DEFAULT_WEIGHTS: PlannerWeights = {
  dietPerMeal: 100,
  budgetPerPound: 40,
  uncostedWithBudget: 5,
  favourite: 30,
  // Strong: a busy-day slot that misses its time cap costs more than a diet-mix miss (100) but less than a
  // repeat (150), so quick recipes are preferred on busy days without doubling one up.
  quickMiss: 120,
  includeTag: 10,
  // > dietPerMeal: a small library is reported ("Only 1 fish recipe...") rather than the same
  // recipe doubled up to hit a proportion target. Still far below emptySlot, so repeats beat gaps.
  repeat: 150,
  recent: 15,
  emptySlot: 1000,
  costTieBreakPerPound: 0.05,
};

export interface PlannerOptions {
  /** Tie-break seed. Default 1. */
  seed?: number;
  /** Number of seeded restarts of construct + local search. Default 4. */
  restarts?: number;
  maxIterations?: number;
  weights?: Partial<PlannerWeights>;
  /** Display names for explanations. */
  labels?: {
    members?: Record<string, string>;
    ingredients?: Record<string, string>;
  };
}
