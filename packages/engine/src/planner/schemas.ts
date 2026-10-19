import { z } from 'zod';
import type { DietCategory, MealType } from '../contract';
import { isValidIsoDate } from './dates';

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine(isValidIsoDate, 'invalid calendar date');

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const satisfies readonly MealType[];
export const DIET_CATEGORIES = ['meat', 'fish', 'vegetarian', 'vegan'] as const satisfies readonly DietCategory[];

export const MealTypeSchema = z.enum(MEAL_TYPES);
export const DietCategorySchema = z.enum(DIET_CATEGORIES);
export const WeekdaySchema = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

/**
 * A diet-proportion target. Exactly one form:
 *  - { fraction: 0.5 }      "roughly half" -> rounded to a whole-meal range (see resolveTargets)
 *  - { count: 2 }           "two fish meals" -> exactly 2
 *  - { min?: n, max?: m }   explicit bounds, e.g. "at least 2 vegetarian"
 */
export const DietTargetSchema = z.union([
  z.strictObject({ fraction: z.number().min(0).max(1) }),
  z.strictObject({ count: z.number().int().min(0) }),
  z
    .strictObject({ min: z.number().int().min(0).optional(), max: z.number().int().min(0).optional() })
    .refine((t) => t.min !== undefined || t.max !== undefined, 'min or max required')
    .refine((t) => t.min === undefined || t.max === undefined || t.min <= t.max, 'min must be <= max'),
]);
export type DietTarget = z.infer<typeof DietTargetSchema>;

export const DietProportionsSchema = z.strictObject({
  meat: DietTargetSchema.optional(),
  fish: DietTargetSchema.optional(),
  vegetarian: DietTargetSchema.optional(),
  vegan: DietTargetSchema.optional(),
});

export const SkipReasonSchema = z.enum(['eating_out', 'leftovers', 'other']);
export type SkipReason = z.infer<typeof SkipReasonSchema>;

export const SkipSlotSchema = z.strictObject({
  date: IsoDateSchema,
  /** Omit to skip every meal type on that date. */
  mealType: MealTypeSchema.optional(),
  reason: SkipReasonSchema,
  note: z.string().max(200).optional(),
});

export const LockedSlotSchema = z.strictObject({
  date: IsoDateSchema,
  mealType: MealTypeSchema,
  recipeId: z.string().min(1),
});

export const QuickMealsSchema = z.strictObject({
  dates: z.array(IsoDateSchema).default([]),
  weekdays: z.array(WeekdaySchema).default([]),
  maxTotalMinutes: z.number().int().positive(),
});

/**
 * Structured constraints. The LLM's ONLY job is to emit this object from a prompt; the solver
 * below is deterministic code. Fields marked HARD can never be violated by the solver.
 */
export const PlanConstraintsSchema = z
  .strictObject({
    /** Either `dates`, or `startDate` (+ `days`, default 7). */
    startDate: IsoDateSchema.optional(),
    days: z.number().int().min(1).max(31).optional(),
    dates: z.array(IsoDateSchema).min(1).max(62).optional(),
    mealTypes: z.array(MealTypeSchema).min(1).default(['dinner']),
    servings: z.number().int().min(1).max(50),
    /** Soft. Integer pence for the whole plan. */
    budgetPence: z.number().int().min(0).optional(),
    /** Soft. */
    dietProportions: DietProportionsSchema.optional(),
    /** If true, vegan meals also count towards a vegetarian target. */
    vegetarianIncludesVegan: z.boolean().default(true),
    /** HARD. e.g. ['meat','fish'] for a vegetarian household. */
    excludeDietCategories: z.array(DietCategorySchema).default([]),
    /** Soft preference. */
    includeTags: z.array(z.string().min(1)).default([]),
    /** HARD. */
    excludeTags: z.array(z.string().min(1)).default([]),
    /** HARD. Canonical ingredient ids (upstream resolves "mushrooms" to all mushroom ids). */
    excludeIngredientIds: z.array(z.string().min(1)).default([]),
    /**
     * HARD. Allergen names (case-insensitive). Each is enforced three ways: (1) via `allergenGroups`
     * (group -> canonical ingredient ids; primary), (2) against RecipeCandidate.allergens, and
     * (3) as a secondary term match on ingredient names/aliases and unmatched line text.
     */
    excludeAllergens: z.array(z.string().min(1)).default([]),
    /**
     * HARD reference data supplied by the server (NOT the LLM): allergen group -> canonical
     * ingredient ids, e.g. { nuts: ['ing-almond','ing-cashew'] }. Keys are case-insensitive.
     */
    allergenGroups: z.record(z.string(), z.array(z.string().min(1))).default({}),
    /**
     * HARD secondary safety net: free-text terms (e.g. 'mushroom') matched case-insensitively against
     * ingredient names/aliases and the original text of unmatched ingredient lines. Primary matching
     * is always by canonical id (excludeIngredientIds / allergenGroups).
     */
    excludeTerms: z.array(z.string().min(1)).default([]),
    /**
     * HARD-safety switch. When any ingredient/allergen exclusion is set, recipes with unmatched
     * ingredient lines cannot be verified safe and are excluded unless this is true.
     */
    allowUnverifiedIngredients: z.boolean().default(false),
    /** Soft: household member ids whose favourites should be used where possible. */
    favouritesOf: z.array(z.string().min(1)).default([]),
    /** Soft. */
    quickMeals: QuickMealsSchema.optional(),
    /** 'never' = hard (slot left empty rather than repeat); 'avoid' = soft penalty; 'allow' = no penalty. */
    repeats: z.enum(['never', 'avoid', 'allow']).default('avoid'),
    /** Soft: penalise recipes cooked within this many days before the plan starts. */
    avoidRecentDays: z.number().int().min(0).max(365).default(7),
    /** Slots not to plan (eating out / leftovers). */
    skip: z.array(SkipSlotSchema).default([]),
    /** User-pinned meals; still subject to HARD constraints. */
    locked: z.array(LockedSlotSchema).default([]),
  })
  .superRefine((c, ctx) => {
    if (c.dates && (c.startDate || c.days !== undefined)) {
      ctx.addIssue({ code: 'custom', message: 'Provide either dates or startDate/days, not both' });
    }
    if (!c.dates && !c.startDate) {
      ctx.addIssue({ code: 'custom', message: 'Provide dates or startDate' });
    }
  });

export type PlanConstraintsInput = z.input<typeof PlanConstraintsSchema>;
export type PlanConstraints = z.output<typeof PlanConstraintsSchema>;

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
  quickMiss: 60,
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
