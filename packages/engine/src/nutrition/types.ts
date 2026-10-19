import type { GramsConverter } from '../units/converter';
import type { IsoDateTime, NutrientKey, NutrientValue, Quantity, Uuid, ValueStatus } from '../contract';

export const NUTRIENT_KEYS: readonly NutrientKey[] = [
  'energy_kcal', 'energy_kj', 'protein', 'carbohydrate', 'sugars', 'fat', 'saturates', 'fibre', 'salt', 'sodium',
];

export const NUTRIENT_UNITS: Record<NutrientKey, NutrientValue['unit']> = {
  energy_kcal: 'kcal', energy_kj: 'kJ', protein: 'g', carbohydrate: 'g', sugars: 'g',
  fat: 'g', saturates: 'g', fibre: 'g', salt: 'g', sodium: 'mg',
};

export const KJ_PER_KCAL = 4.184;
/** salt (g) = sodium (mg) / 1000 * 2.5 */
export const SALT_PER_SODIUM = 2.5;

/** Shown wherever weekly (or any) nutrition estimates are presented. */
export const NUTRITION_DISCLAIMER =
  "Nutrition values are estimates calculated from ingredient data and are not medical or dietary advice. " +
  "They do not indicate whether any individual's nutritional needs are being met.";

/** One nutrient of a per-100g ingredient profile. A key absent from the profile means 'unavailable'. */
export interface ProfileNutrient {
  status: ValueStatus;
  value?: number;       // per 100 g, in NUTRIENT_UNITS[key]; required for 'known'
  source?: string;      // e.g. 'CoFID 2021 v1.0'
  estimate?: boolean;
  derived?: boolean;
}
export interface NutrientProfile {
  per100g: Partial<Record<NutrientKey, ProfileNutrient>>;
  /** Fallback source when a nutrient has none. */
  source?: string;
}

export type { GramsResult } from '../units/converter';
/** Backed in production by `createGramsConverter` (@fr/engine/units). */
export type UnitConverter = GramsConverter;

/** Optional drained-weight / cooking-yield hook. Only applied when provided; always flagged estimate. */
export interface GramsFactor { factor: number; reason: string }

export interface NutritionLine {
  id: Uuid;
  name: string;
  ingredientId?: Uuid;
  quantity: Quantity;
  optional: boolean;
  profile?: NutrientProfile;
  /** e.g. canned chickpeas listed by can weight, profile is for drained: { factor: 0.6, reason: 'drained weight' }. */
  gramsFactor?: GramsFactor;
}

export type MissingReason =
  | 'no_profile' | 'no_grams' | 'to_taste' | 'unparsed' | 'nutrient_unknown' | 'nutrient_unavailable'
  | 'no_nutrition';
export interface MissingIngredient { id: string; name: string; reason: MissingReason }

export interface CalculatedNutrient extends NutrientValue {
  /** status 'unknown' + incomplete: value is withheld; lowerBound is the sum of the known parts (NOT a total). */
  incomplete: boolean;
  lowerBound?: number;
  missingIngredients: MissingIngredient[];
  sources: string[];
  calculatedAt: IsoDateTime;
  derived: boolean;
  /** 0..100: share of contributing parts with usable data for this nutrient. */
  coveragePct: number;
}
export type NutrientMap = Record<NutrientKey, CalculatedNutrient>;

export interface CalcOptions {
  now?: () => Date;
  includeOptional?: boolean;          // default false
  /** Treat non-optional 'to taste' lines as negligible instead of missing. Default false (strict). */
  treatToTasteAsNegligible?: boolean;
}

export interface RecipeNutrition {
  servings: number;
  totals: NutrientMap;
  perServing: NutrientMap;
  /** 0..100: share of included lines that had both a profile and a resolvable weight. */
  ingredientCoveragePct: number;
  /** Lines that could not contribute at all (no profile / no weight / to taste / unparsed). */
  missingIngredients: MissingIngredient[];
  warnings: string[];
  calculatedAt: IsoDateTime;
  method: string;
}
