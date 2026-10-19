import { z } from 'zod';

// Copied from @fr/ai (L4) src/schemas.ts -- keep identical to CONTRACT-SEED.ts. L4 is not modified.
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
export type Quantity = z.infer<typeof QuantitySchema>;
export type Unit = z.infer<typeof UnitSchema>;
export type QuantityKind = z.infer<typeof QuantityKindSchema>;

const Conf = z.number().min(0).max(1);

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
  confidence: z.record(z.string(), Conf).default({}),
});
export type RecipeExtraction = z.infer<typeof RecipeExtractionSchema>;
export type ExtractedIngredient = z.infer<typeof ExtractedIngredientSchema>;
