import { z } from 'zod';

/** Mirrors CONTRACT-SEED.ts. L1 owns the final versions; keep names identical. */
export const UnitSchema = z.enum([
  'mg', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'floz', 'pint',
  'item', 'clove', 'slice', 'can', 'pack', 'bunch', 'sprig', 'stick',
]);
export const QuantityKindSchema = z.enum(['exact', 'range', 'approximate', 'to_taste', 'unparsed']);

export const QuantitySchema = z.object({
  kind: QuantityKindSchema,
  value: z.number().nonnegative().optional(),
  min: z.number().nonnegative().optional(),
  max: z.number().nonnegative().optional(),
  unit: UnitSchema.optional(),
  approxLabel: z.string().optional(),
  originalText: z.string().min(1),
}).superRefine((q, ctx) => {
  if (q.kind === 'exact' && q.value === undefined) ctx.addIssue({ code: 'custom', message: 'exact quantity needs value' });
  if (q.kind === 'range' && (q.min === undefined || q.max === undefined || q.min > q.max)) {
    ctx.addIssue({ code: 'custom', message: 'range quantity needs min <= max' });
  }
});

export const MealTypeSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack']);
export const DietCategorySchema = z.enum(['meat', 'fish', 'vegetarian', 'vegan']);

/** Confidence 0..1. */
const Conf = z.number().min(0).max(1);

// ---- Recipe extraction ----
export const ExtractedIngredientSchema = z.object({
  originalText: z.string().min(1),
  name: z.string().min(1),
  quantity: QuantitySchema,
  preparation: z.string().optional(),
  optional: z.boolean().default(false),
  confidence: Conf,
});

export const RecipeExtractionSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  ingredients: z.array(ExtractedIngredientSchema).min(1),
  steps: z.array(z.string().min(1)).min(1),
  servings: z.number().positive().optional(),
  prepMinutes: z.number().int().nonnegative().optional(),
  cookMinutes: z.number().int().nonnegative().optional(),
  tags: z.array(z.string()).default([]),
  cuisine: z.string().optional(),
  warnings: z.array(z.string()).default([]),
  /** Per-field confidence, keyed by field name (title, servings, ingredients, steps, times...). */
  confidence: z.record(z.string(), Conf).default({}),
});
export type RecipeExtraction = z.infer<typeof RecipeExtractionSchema>;

// ---- Receipt ----
export const ReceiptLineSchema = z.object({
  text: z.string().min(1),
  qty: z.number().positive().optional(),
  pricePence: z.number().int(),
  confidence: Conf.optional(),
});
export const ReceiptParseSchema = z.object({
  retailer: z.string().optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  lines: z.array(ReceiptLineSchema),
  totalPence: z.number().int().optional(),
  warnings: z.array(z.string()).default([]),
});
export type ReceiptParse = z.infer<typeof ReceiptParseSchema>;

// ---- Tags ----
export const TagSuggestionSchema = z.object({
  tags: z.array(z.string()).max(20),
  cuisine: z.string().optional(),
  dietCategory: DietCategorySchema.optional(),
  mealTypes: z.array(MealTypeSchema).default([]),
});
export type TagSuggestion = z.infer<typeof TagSuggestionSchema>;

// ---- Plan constraints ----
export const PlanConstraintsSchema = z.object({
  days: z.number().int().min(1).max(31),
  mealTypes: z.array(MealTypeSchema).min(1),
  servings: z.number().positive().optional(),
  budgetPence: z.number().int().nonnegative().optional(),
  dietProportions: z.partialRecord(DietCategorySchema, z.number().min(0).max(1)).optional(),
  includeTags: z.array(z.string()).default([]),
  /** HARD exclusions: enforced in code by the solver, never merely advisory. */
  excludeIngredients: z.array(z.string()).default([]),
  favouritesOf: z.array(z.string()).default([]),
  quickMealDays: z.number().int().min(0).max(31).optional(),
  notes: z.string().optional(),
});
export type PlanConstraints = z.infer<typeof PlanConstraintsSchema>;

/** Minimal household context for plan parsing. Callers pass ONLY what the prompt needs. */
export const HouseholdContextSchema = z.object({
  defaultServings: z.number().positive().optional(),
  weeklyBudgetPence: z.number().int().nonnegative().optional(),
  /** Anonymised hard exclusions (ingredient names), no member identities. */
  exclusions: z.array(z.string()).default([]),
  /** Names usable in `favouritesOf` (first names / aliases only). */
  memberNames: z.array(z.string()).default([]),
  availableTags: z.array(z.string()).default([]),
});
export type HouseholdContext = z.input<typeof HouseholdContextSchema>;

// ---- Ingredient matching ----
export const IngredientMatchSchema = z.object({
  matches: z.array(z.object({
    line: z.string(),
    candidateId: z.string().nullable(),
    confidence: Conf,
    reason: z.string().optional(),
  })),
});
export type IngredientMatches = z.infer<typeof IngredientMatchSchema>;

// ---- Substitutions ----
export const SubstitutionSchema = z.object({
  suggestions: z.array(z.object({
    original: z.string(),
    substitute: z.string(),
    ratioNote: z.string().optional(),
    effect: z.string().optional(),
    dietSafe: z.boolean().optional(),
  })),
  notes: z.string().optional(),
});
export type Substitutions = z.infer<typeof SubstitutionSchema>;
