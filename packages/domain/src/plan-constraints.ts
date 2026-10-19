/**
 * The ONE PlanConstraints schema (DECISIONS D130). Moved here from `@fr/engine/planner` (whose solver shape was
 * ratified as canonical); `@fr/engine/planner` re-exports it, `@fr/ai` emits the `PlanRequestSchema` subset of it
 * and `@fr/plan-orchestrator` produces the full object (server-resolved ids, dates).
 */
import { z } from 'zod';
import { DietCategory, MealType } from './primitives';

const isRealDate = (s: string): boolean => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
};

export const PlanDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
  .refine(isRealDate, 'invalid calendar date');

export const PLAN_MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const satisfies readonly MealType[];
export const PLAN_DIET_CATEGORIES = ['meat', 'fish', 'vegetarian', 'vegan'] as const satisfies readonly DietCategory[];

export const PlanMealTypeSchema = z.enum(PLAN_MEAL_TYPES);
export const PlanDietCategorySchema = z.enum(PLAN_DIET_CATEGORIES);
export const PlanWeekdaySchema = z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

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
export type DietProportions = z.infer<typeof DietProportionsSchema>;

export const SkipReasonSchema = z.enum(['eating_out', 'leftovers', 'other']);
export type SkipReason = z.infer<typeof SkipReasonSchema>;

export const SkipSlotSchema = z.strictObject({
  date: PlanDateSchema,
  /** Omit to skip every meal type on that date. */
  mealType: PlanMealTypeSchema.optional(),
  reason: SkipReasonSchema,
  note: z.string().max(200).optional(),
});

export const LockedSlotSchema = z.strictObject({
  date: PlanDateSchema,
  mealType: PlanMealTypeSchema,
  recipeId: z.string().min(1),
});

/**
 * Quick meals on given dates and/or weekdays. SOFT by default (a strong penalty per slot that misses
 * `maxTotalMinutes`); `strict: true` ("ONLY quick meals on Monday") makes it HARD.
 */
export const QuickMealsSchema = z.strictObject({
  dates: z.array(PlanDateSchema).default([]),
  weekdays: z.array(PlanWeekdaySchema).default([]),
  maxTotalMinutes: z.number().int().positive(),
  strict: z.boolean().default(false),
});
export type QuickMeals = z.infer<typeof QuickMealsSchema>;

/**
 * Structured constraints. The LLM's ONLY job is to emit the `PlanRequestSchema` subset of this object from a
 * prompt; the solver is deterministic code. Fields marked HARD can never be violated by the solver.
 */
export const PlanConstraintsBaseSchema = z.strictObject({
  /** Either `dates`, or `startDate` (+ `days`, default 7). */
  startDate: PlanDateSchema.optional(),
  days: z.number().int().min(1).max(31).optional(),
  dates: z.array(PlanDateSchema).min(1).max(62).optional(),
  mealTypes: z.array(PlanMealTypeSchema).min(1).default(['dinner']),
  servings: z.number().int().min(1).max(50),
  /** Soft. Integer pence for the whole plan. */
  budgetPence: z.number().int().min(0).optional(),
  /** Soft. */
  dietProportions: DietProportionsSchema.optional(),
  /** If true, vegan meals also count towards a vegetarian target. */
  vegetarianIncludesVegan: z.boolean().default(true),
  /** HARD. e.g. ['meat','fish'] for a vegetarian household. */
  excludeDietCategories: z.array(PlanDietCategorySchema).default([]),
  /** Soft preference. */
  includeTags: z.array(z.string().min(1)).default([]),
  /** HARD. */
  excludeTags: z.array(z.string().min(1)).default([]),
  /** HARD. Canonical ingredient ids (the server resolves "mushrooms" to all mushroom ids). */
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
  /** Soft (HARD with `strict`). */
  quickMeals: QuickMealsSchema.optional(),
  /** 'never' = hard (slot left empty rather than repeat); 'avoid' = soft penalty; 'allow' = no penalty. */
  repeats: z.enum(['never', 'avoid', 'allow']).default('avoid'),
  /** Soft: penalise recipes cooked within this many days before the plan starts. */
  avoidRecentDays: z.number().int().min(0).max(365).default(7),
  /** Slots not to plan (eating out / leftovers). */
  skip: z.array(SkipSlotSchema).default([]),
  /** User-pinned meals; still subject to HARD constraints. */
  locked: z.array(LockedSlotSchema).default([]),
});

export const PlanConstraintsSchema = PlanConstraintsBaseSchema.superRefine((c, ctx) => {
  if (c.dates && (c.startDate || c.days !== undefined)) {
    ctx.addIssue({ code: 'custom', message: 'Provide either dates or startDate/days, not both' });
  }
  if (!c.dates && !c.startDate) {
    ctx.addIssue({ code: 'custom', message: 'Provide dates or startDate' });
  }
});

export type PlanConstraintsInput = z.input<typeof PlanConstraintsSchema>;
export type PlanConstraints = z.output<typeof PlanConstraintsSchema>;

/**
 * The editable, LLM-facing subset of PlanConstraints (D131): what the model emits from a prompt and what the
 * user's chips edit. No dates, no server-resolved ids or allergen groups, no safety switches.
 *  - `excludeTerms` / `excludeAllergens` are names; the server resolves them to ingredient ids / UK-14 groups.
 *  - `favouritesOf` holds member display names here; the server resolves them to member ids.
 */
export const PlanRequestSchema = PlanConstraintsBaseSchema.pick({
  days: true,
  mealTypes: true,
  servings: true,
  budgetPence: true,
  dietProportions: true,
  excludeDietCategories: true,
  includeTags: true,
  excludeAllergens: true,
  excludeTerms: true,
  favouritesOf: true,
  quickMeals: true,
});
export type PlanRequestInput = z.input<typeof PlanRequestSchema>;
export type PlanRequest = z.output<typeof PlanRequestSchema>;
