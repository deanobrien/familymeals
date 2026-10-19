// View models for the recipe library. Shapes mirror CONTRACT-SEED (C:\TFS\FamilyRecipes-lanes\CONTRACT-SEED.ts).
// TODO(@fr/domain): replace these local copies with imports from @fr/domain once lane L1 merges.

export type Uuid = string;
export type IsoDateTime = string;
/** Money is ALWAYS integer pence. */
export type Pence = number;

export type MassUnit = 'mg' | 'g' | 'kg';
export type VolumeUnit = 'ml' | 'l' | 'tsp' | 'tbsp' | 'cup' | 'floz' | 'pint';
export type CountUnit = 'item' | 'clove' | 'slice' | 'can' | 'pack' | 'bunch' | 'sprig' | 'stick';
export type Unit = MassUnit | VolumeUnit | CountUnit;

export const UNITS = [
  'mg', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'floz', 'pint',
  'item', 'clove', 'slice', 'can', 'pack', 'bunch', 'sprig', 'stick',
] as const satisfies readonly Unit[];

export const QUANTITY_KINDS = ['exact', 'range', 'approximate', 'to_taste', 'unparsed'] as const;
export type QuantityKind = (typeof QUANTITY_KINDS)[number];

export interface Quantity {
  kind: QuantityKind;
  value?: number;
  min?: number;
  max?: number;
  unit?: Unit;
  approxLabel?: string;
  /** Always preserved. */
  originalText: string;
}

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealType = (typeof MEAL_TYPES)[number];
export const DIET_CATEGORIES = ['meat', 'fish', 'vegetarian', 'vegan'] as const;
export type DietCategory = (typeof DIET_CATEGORIES)[number];

export type ValueStatus = 'known' | 'zero' | 'unknown' | 'unavailable';
export type NutrientKey =
  | 'energy_kcal' | 'energy_kj' | 'protein' | 'carbohydrate' | 'sugars'
  | 'fat' | 'saturates' | 'fibre' | 'salt' | 'sodium';
export interface NutrientValue {
  nutrient: NutrientKey;
  status: ValueStatus;
  value?: number;
  unit: 'kcal' | 'kJ' | 'g' | 'mg' | 'ug';
  source?: string;
  estimate: boolean;
}

export type PriceKind = 'user_confirmed' | 'receipt' | 'retailer_verified' | 'generic_estimate';

export interface IngredientLine {
  id: Uuid;
  /** Display name as written. */
  name: string;
  /** Canonical @fr/refdata ingredient id when the line matched (engine matcher); undefined = unmatched, line kept. */
  ingredientId?: Uuid | undefined;
  quantity: Quantity;
  preparation?: string | undefined;
  optional: boolean;
  order: number;
}

export interface StepView {
  id: Uuid;
  order: number;
  text: string;
}

export interface RecipeCost {
  /** Whole-recipe cost in pence (null = unknown). Computed by lib/server/calc (D60), never stored or hand-entered. */
  totalPence: Pence | null;
  /** Least-trusted price kind used for any line. */
  kind: PriceKind;
  observedOn?: string;
  source?: string;
  /** true when some lines could not be priced, so totalPence is a lower bound. */
  partial?: boolean;
}

/** Nutrition exactly as printed on an imported recipe card. Source-provided, NEVER calculated by us. */
export interface PrintedNutritionView {
  /** As printed: "per person", "per serving", "per 100g". */
  basis: string;
  values: Array<{ nutrient: string; amount: number; unit: string }>;
  note?: string | undefined;
  source: 'recipe card';
}

export interface RecipeView {
  id: Uuid;
  title: string;
  description: string;
  imageUrl: string | null;
  sourceAttribution: string;
  sourceUrl: string;
  /** Verbatim original text of the recipe as extracted/typed; never overwritten by edits. */
  originalText: string;
  prepMinutes: number | null;
  cookMinutes: number | null;
  servings: number;
  cuisine: string;
  mealType: MealType;
  diet: DietCategory;
  tags: string[];
  ingredients: IngredientLine[];
  steps: StepView[];
  favourite: boolean;
  /** 1-5 household rating, if any. */
  rating: number | null;
  cost: RecipeCost;
  /** Per-serving nutrition; unknown rows are shown as Unknown, never 0. */
  nutritionPerServing: NutrientValue[];
  /** Printed on the recipe card (imports only); shown separately from our own calculation. */
  printedNutrition?: PrintedNutritionView | undefined;
  /** Allergens exactly as printed on the card (imports only). */
  printedAllergens?: string[] | undefined;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export function totalMinutes(r: Pick<RecipeView, 'prepMinutes' | 'cookMinutes'>): number | null {
  if (r.prepMinutes == null && r.cookMinutes == null) return null;
  return (r.prepMinutes ?? 0) + (r.cookMinutes ?? 0);
}

export function costPerServing(r: Pick<RecipeView, 'cost' | 'servings'>): Pence | null {
  if (r.cost.totalPence == null || r.servings <= 0) return null;
  return Math.round(r.cost.totalPence / r.servings);
}
