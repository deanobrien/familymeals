import { z } from 'zod';
import {
  DIET_CATEGORIES,
  MEAL_TYPES,
  QUANTITY_KINDS,
  UNITS,
  type DietCategory,
  type MealType,
  type PrintedNutritionView,
  type Quantity,
} from './types';

const num = z.number().finite().nonnegative().max(100000);

export const quantitySchema = z
  .object({
    kind: z.enum(QUANTITY_KINDS),
    value: num.optional(),
    min: num.optional(),
    max: num.optional(),
    unit: z.enum(UNITS).optional(),
    approxLabel: z.string().trim().max(40).optional(),
    originalText: z.string().trim().max(200),
  })
  .superRefine((q, ctx) => {
    if (q.kind === 'exact' && q.value == null) {
      ctx.addIssue({ code: 'custom', message: 'Enter a quantity', path: ['value'] });
    }
    if (q.kind === 'range') {
      if (q.min == null || q.max == null) {
        ctx.addIssue({ code: 'custom', message: 'Enter a minimum and maximum', path: ['min'] });
      } else if (q.min > q.max) {
        ctx.addIssue({ code: 'custom', message: 'Minimum is above maximum', path: ['min'] });
      }
    }
  });

export const ingredientInputSchema = z.object({
  name: z.string().trim().min(1, 'Ingredient name is required').max(120),
  ingredientId: z.string().trim().max(64).optional(),
  quantity: quantitySchema,
  preparation: z.string().trim().max(200).optional(),
  optional: z.boolean(),
});

export const printedNutritionSchema = z.object({
  basis: z.string().trim().min(1).max(60),
  values: z.array(z.object({
    nutrient: z.string().trim().min(1).max(40),
    amount: z.number().min(0).max(100000),
    unit: z.string().trim().min(1).max(10),
  })).min(1).max(30),
  note: z.string().trim().max(200).optional(),
  source: z.literal('recipe card'),
});

export const recipeInputSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(160),
  description: z.string().trim().max(2000),
  imageUrl: z.string().trim().max(500).nullable(),
  sourceAttribution: z.string().trim().max(200),
  sourceUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === '' || /^https?:\/\//i.test(v), 'Source URL must start with http:// or https://'),
  originalText: z.string().max(20000),
  prepMinutes: z.number().int().min(0).max(10000).nullable(),
  cookMinutes: z.number().int().min(0).max(10000).nullable(),
  servings: z.number().int().min(1, 'At least 1 serving').max(500),
  cuisine: z.string().trim().max(60),
  mealType: z.enum(MEAL_TYPES),
  diet: z.enum(DIET_CATEGORIES),
  tags: z.array(z.string().trim().min(1).max(40)).max(30),
  ingredients: z.array(ingredientInputSchema).min(1, 'Add at least one ingredient').max(100),
  steps: z.array(z.string().trim().min(1, 'Steps cannot be empty').max(2000)).min(1, 'Add at least one step').max(100),
  /** Imports only; preserved across edits when the form does not send them. */
  printedNutrition: printedNutritionSchema.optional(),
  printedAllergens: z.array(z.string().trim().min(1).max(80)).max(30).optional(),
});

export interface RecipeInput {
  title: string;
  description: string;
  imageUrl: string | null;
  sourceAttribution: string;
  sourceUrl: string;
  originalText: string;
  prepMinutes: number | null;
  cookMinutes: number | null;
  servings: number;
  cuisine: string;
  mealType: MealType;
  diet: DietCategory;
  tags: string[];
  ingredients: Array<{
    name: string;
    ingredientId?: string | undefined;
    quantity: Quantity;
    preparation?: string | undefined;
    optional: boolean;
  }>;
  steps: string[];
  printedNutrition?: PrintedNutritionView | undefined;
  printedAllergens?: string[] | undefined;
}

// ---- list query (URL driven) ----

export const SORTS = ['name', 'recent', 'cost', 'rating', 'prep'] as const;
export type RecipeSort = (typeof SORTS)[number];
export const COLLECTIONS = ['favourites', 'quick', 'budget', 'vegetarian'] as const;
export type RecipeCollection = (typeof COLLECTIONS)[number];
export const PRICE_BANDS = ['low', 'mid', 'high', 'unknown'] as const;
export type PriceBand = (typeof PRICE_BANDS)[number];
export const PREP_LIMITS = [15, 30, 60] as const;

export interface RecipeQuery {
  q: string;
  cuisine?: string | undefined;
  mealType?: MealType | undefined;
  maxPrepMinutes?: number | undefined;
  diet?: DietCategory | undefined;
  priceBand?: PriceBand | undefined;
  tags: string[];
  collection?: RecipeCollection | undefined;
  sort: RecipeSort;
  page: number;
  pageSize: number;
}

export const DEFAULT_PAGE_SIZE = 12;

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

/** Parse URL search params leniently: anything invalid falls back to the default rather than erroring. */
export function parseRecipeQuery(params: Params): RecipeQuery {
  const pick = <T extends string>(key: string, allowed: readonly T[]): T | undefined => {
    const v = first(params[key]);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
  };
  const prep = Number(first(params.prep));
  const page = Math.floor(Number(first(params.page)));
  const tagRaw = params.tag;
  const tags = (Array.isArray(tagRaw) ? tagRaw : tagRaw ? [tagRaw] : [])
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
  return {
    q: (first(params.q) ?? '').trim().slice(0, 100),
    cuisine: first(params.cuisine)?.trim() || undefined,
    mealType: pick('meal', MEAL_TYPES),
    maxPrepMinutes: (PREP_LIMITS as readonly number[]).includes(prep) ? prep : undefined,
    diet: pick('diet', DIET_CATEGORIES),
    priceBand: pick('price', PRICE_BANDS),
    tags,
    collection: pick('collection', COLLECTIONS),
    sort: pick('sort', SORTS) ?? 'name',
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, 1000) : 1,
    pageSize: DEFAULT_PAGE_SIZE,
  };
}

/** Serialise a query (plus view mode) back to URL params, omitting defaults. */
export function recipeQueryToParams(q: Partial<RecipeQuery> & { view?: string }): URLSearchParams {
  const p = new URLSearchParams();
  if (q.q) p.set('q', q.q);
  if (q.cuisine) p.set('cuisine', q.cuisine);
  if (q.mealType) p.set('meal', q.mealType);
  if (q.maxPrepMinutes) p.set('prep', String(q.maxPrepMinutes));
  if (q.diet) p.set('diet', q.diet);
  if (q.priceBand) p.set('price', q.priceBand);
  for (const t of q.tags ?? []) p.append('tag', t);
  if (q.collection) p.set('collection', q.collection);
  if (q.sort && q.sort !== 'name') p.set('sort', q.sort);
  if (q.page && q.page > 1) p.set('page', String(q.page));
  if (q.view && q.view !== 'grid') p.set('view', q.view);
  return p;
}
