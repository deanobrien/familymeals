// TODO: replace with @fr/engine/pantry after merge batch 2 (vendored verbatim from L22a-pantry/src/contract.ts)
// PRJ-018 shared contract seed. ALL lanes import/copy these shapes verbatim.
// Lane L1 (schema/domain) owns the final zod versions; do not diverge from these names.

export type Uuid = string;
export type IsoDate = string; // YYYY-MM-DD
export type IsoDateTime = string;

/** Canonical units. 'item' = countable (e.g. 2 onions). Imperial/US units convert in to these. */
export type MassUnit = 'mg' | 'g' | 'kg';
export type VolumeUnit = 'ml' | 'l' | 'tsp' | 'tbsp' | 'cup' | 'floz' | 'pint';
export type CountUnit = 'item' | 'clove' | 'slice' | 'can' | 'pack' | 'bunch' | 'sprig' | 'stick';
export type Unit = MassUnit | VolumeUnit | CountUnit;
export type Dimension = 'mass' | 'volume' | 'count';

export type QuantityKind = 'exact' | 'range' | 'approximate' | 'to_taste' | 'unparsed';
export interface Quantity {
  kind: QuantityKind;
  value?: number;          // exact
  min?: number; max?: number; // range
  unit?: Unit;             // absent for to_taste/unparsed or unitless counts
  approxLabel?: string;    // 'pinch' | 'handful' | 'dash' ... never converted to a weight
  originalText: string;    // always preserved
}

export interface CanonicalIngredient {
  id: Uuid; name: string; category: string; aliases: string[];
  densityGPerMl?: { value: number; source: string };      // enables volume<->mass
  unitWeightG?: { value: number; source: string; estimate: true }; // e.g. 1 onion
  form?: 'fresh' | 'dried' | 'ground' | 'frozen' | 'canned' | 'other'; // fresh vs ground coriander stay separate
}

export interface RecipeIngredientLine {
  id: Uuid; recipeId: Uuid; ingredientId?: Uuid; // undefined = unmatched, keep line
  quantity: Quantity; preparation?: string; optional: boolean; order: number;
}

/** Provenance from a shopping requirement back to what contributed it. */
export interface Contribution { recipeId: Uuid; plannedMealId?: Uuid; recipeIngredientId: Uuid; quantity: Quantity; }

export interface Requirement {
  ingredientId?: Uuid; displayName: string;
  quantity: Quantity;                // combined where safely combinable
  contributions: Contribution[];
  unresolved?: Quantity[];           // parts that could not be safely combined/converted
}

export type ValueStatus = 'known' | 'zero' | 'unknown' | 'unavailable';
export interface NutrientValue { nutrient: NutrientKey; status: ValueStatus; value?: number; unit: 'kcal'|'kJ'|'g'|'mg'|'ug'; source?: string; estimate: boolean; }
export type NutrientKey = 'energy_kcal'|'energy_kj'|'protein'|'carbohydrate'|'sugars'|'fat'|'saturates'|'fibre'|'salt'|'sodium';

export type PriceKind = 'user_confirmed' | 'receipt' | 'retailer_verified' | 'generic_estimate'; // priority order
export interface PriceObservation { ingredientId?: Uuid; productPackId?: Uuid; retailer?: string; pricePence: number; packQuantity: Quantity; kind: PriceKind; observedOn: IsoDate; source: string; }
export interface ProductPack { id: Uuid; name: string; ingredientId: Uuid; quantity: Quantity; retailer?: string; }

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type DietCategory = 'meat' | 'fish' | 'vegetarian' | 'vegan';

/** Money is ALWAYS integer pence. Never floats for money. */
export type Pence = number;

/** Append-only purchase event; client-generated id makes offline replay idempotent. */
export interface PurchaseEvent { id: Uuid; shoppingListItemId: Uuid; quantity: Quantity; actualPricePence?: Pence; receiptLineId?: Uuid; createdBy: Uuid; createdAt: IsoDateTime; voidedBy?: Uuid; }
