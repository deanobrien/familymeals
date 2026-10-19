// Client-safe result shapes of the server-only calc module (lib/server/calc). Plain JSON: safe to pass to client components.
import type { NutrientMap } from '@fr/engine/nutrition';
import type { UncostedReason } from '@fr/engine/cost';
import type { PriceKind } from '../recipes/types';
import type { ProductSourceUsed } from '../products/types';

export interface CostLineResult {
  lineId: string;
  name: string;
  status: 'costed' | 'uncosted' | 'skipped_optional';
  costPence?: number;
  kind?: PriceKind;
  source?: string;
  observedOn?: string;
  isEstimate?: boolean;
  /** 'range_max' = a range was costed at its upper end. */
  basis?: 'exact' | 'range_max';
  reason?: UncostedReason;
  reasonLabel?: string;
}

export interface CostSourceUsed {
  kind: PriceKind;
  source: string;
  observedOn: string;
}

export interface CostResult {
  /** Sum of costed lines only. null = nothing could be costed (never 0). */
  totalPence: number | null;
  perServingPence: number | null;
  servings: number;
  /** 0-100, share of (costed + uncosted) lines that were priced. */
  coveragePct: number;
  /** true when some lines are uncosted, so the totals are a lower bound. */
  isPartial: boolean;
  includesEstimates: boolean;
  /** Least-trusted price kind among costed lines (labels the whole figure); null when nothing was costed. */
  kind: PriceKind | null;
  sources: CostSourceUsed[];
  lines: CostLineResult[];
  uncosted: CostLineResult[];
}

export interface NutritionMissing {
  name: string;
  reason: string;
  reasonLabel: string;
}

export interface NutritionResult {
  servings: number;
  /** Per-serving values (status unknown/unavailable are never shown as 0). */
  perServing: NutrientMap;
  /** Whole-recipe totals. */
  totals: NutrientMap;
  /** 0-100, share of included lines with both a CoFID profile and a resolvable weight. */
  coveragePct: number;
  missing: NutritionMissing[];
  warnings: string[];
  /** true when any figure depends on an estimate (unit weights, ranges, CoFID proxies / bracketed values). */
  hasEstimates: boolean;
  attribution: string;
  /** Ingredients whose nutrition came from a linked product label (Open Food Facts) instead of CoFID. */
  productSources?: ProductSourceUsed[];
  disclaimer: string;
  calculatedAt: string;
}

export interface RecipeCalculation {
  cost: CostResult;
  nutrition: NutritionResult;
}

export const UNCOSTED_LABEL: Record<UncostedReason, string> = {
  unmatched_ingredient: 'ingredient not recognised',
  approximate_quantity: 'amount is approximate',
  to_taste: 'to taste',
  unparsed_quantity: 'amount not understood',
  no_price: 'no price available',
  not_convertible: 'cannot convert to the pack unit',
  missing_unit: 'amount has no unit',
};

export const MISSING_LABEL: Record<string, string> = {
  no_profile: 'no nutrition data for this ingredient',
  no_grams: 'cannot work out its weight',
  to_taste: 'to taste',
  unparsed: 'amount not understood',
  nutrient_unknown: 'nutrient value unknown',
  nutrient_unavailable: 'nutrient not available',
  no_nutrition: 'no nutrition calculated',
};
