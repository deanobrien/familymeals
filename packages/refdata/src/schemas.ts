import { z } from 'zod';

/** Zod mirrors of the CONTRACT-SEED.ts shapes used by this lane (names unchanged). */
export const UnitSchema = z.enum([
  'mg', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'floz', 'pint',
  'item', 'clove', 'slice', 'can', 'pack', 'bunch', 'sprig', 'stick',
]);
export const CountUnitSchema = z.enum(['item', 'clove', 'slice', 'can', 'pack', 'bunch', 'sprig', 'stick']);
export const FormSchema = z.enum(['fresh', 'dried', 'ground', 'frozen', 'canned', 'other']);
export const PriceKindSchema = z.enum(['user_confirmed', 'receipt', 'retailer_verified', 'generic_estimate']);

export const QuantitySchema = z.object({
  kind: z.enum(['exact', 'range', 'approximate', 'to_taste', 'unparsed']),
  value: z.number().positive().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  unit: UnitSchema.optional(),
  approxLabel: z.string().optional(),
  originalText: z.string(),
});

export const IsoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const AISLES = [
  'fruit_veg', 'meat_poultry', 'fish_seafood', 'dairy_eggs', 'dairy_alternatives', 'meat_alternatives',
  'bakery', 'baking', 'pasta_rice_grains', 'cereals', 'tinned_jarred', 'sauces_condiments', 'oils_vinegars',
  'herbs_spices', 'nuts_seeds', 'sweeteners_spreads', 'frozen', 'snacks', 'drinks', 'world_foods',
] as const;
export const AisleSchema = z.enum(AISLES);

export const CofidLinkSchema = z.object({ code: z.string().regex(/^\d{2}-\d{3,4}$/), match: z.enum(['exact', 'proxy']) });

export const CanonicalIngredientSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/),
  name: z.string().min(1),
  category: AisleSchema,
  aliases: z.array(z.string().min(1)),
  densityGPerMl: z.object({ value: z.number().positive(), source: z.string().min(1) }).optional(),
  unitWeightG: z.object({ value: z.number().positive(), source: z.string().min(1), estimate: z.literal(true) }).optional(),
  /** Weight of ONE can/clove/slice/bunch/sprig/stick/pack (D90); always an estimate. */
  countUnitWeightsG: z.partialRecord(CountUnitSchema, z.object({ value: z.number().positive(), source: z.string().min(1), estimate: z.literal(true) })).optional(),
  form: FormSchema.optional(),
  cofid: CofidLinkSchema.optional(),
});
export type CanonicalIngredientSeed = z.infer<typeof CanonicalIngredientSchema>;

export const PriceObservationSeedSchema = z.object({
  ingredientId: z.string().uuid(),
  ingredientName: z.string().min(1),
  pricePence: z.number().int().positive(),
  packQuantity: QuantitySchema.extend({ kind: z.literal('exact'), value: z.number().positive(), unit: UnitSchema }),
  kind: z.literal('generic_estimate'),
  observedOn: IsoDateSchema,
  source: z.string().min(1),
});
export type PriceObservationSeed = z.infer<typeof PriceObservationSeedSchema>;
