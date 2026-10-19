import 'server-only';
import { getPriceStore } from '../prices/store';
import {
  PRICE_KIND_RANK,
  costRecipe as engineCostRecipe,
  type PriceObservation,
  type RecipeIngredientLine,
} from '@fr/engine/cost';
import {
  NUTRITION_DISCLAIMER,
  calculateRecipeNutrition,
  type NutrientMap,
  type NutritionLine,
} from '@fr/engine/nutrition';
import type { NutrientValue, PriceKind, RecipeCost, RecipeView } from '../../recipes/types';
import { MISSING_LABEL, UNCOSTED_LABEL, type CostResult, type CostSourceUsed, type NutritionResult, type RecipeCalculation } from '../../calc/types';
import { getIngredientCatalogue, type IngredientCatalogue } from '../refdata/catalogue';
import { loadCofidProfiles, loadGenericPrices, type CofidProfiles } from './refdata';

/**
 * Real cost + nutrition for library recipes (DECISIONS D60-D63): `@fr/engine` cost / nutrition over the
 * `@fr/refdata` generic prices, CoFID profiles and the shared ingredient catalogue (D28).
 */

/** Household price observations (user-confirmed / receipt / retailer). Merged above the generic estimates by the engine's hierarchy. */
export interface PriceSource {
  observations(): readonly PriceObservation[];
  /** Changes whenever `observations()` changes; part of the cache key. */
  version(): string;
}

export class StaticPriceSource implements PriceSource {
  private v = 0;
  constructor(private obs: readonly PriceObservation[] = []) {}
  observations() {
    return this.obs;
  }
  version() {
    return String(this.v);
  }
  set(obs: readonly PriceObservation[]) {
    this.obs = obs;
    this.v++;
  }
}

export type CalcRecipe = Pick<RecipeView, 'id' | 'servings' | 'ingredients' | 'updatedAt'>;

export interface CalcDeps {
  catalogue: IngredientCatalogue;
  /** Generic refdata prices first; household observations are appended by the calculator. */
  prices: readonly PriceObservation[];
  cofid: CofidProfiles;
  now?: () => Date;
}

/** Recipe lines as engine lines; lines without a stored canonical id are matched by name (exact name/alias only). */
function toEngineLines(recipe: CalcRecipe, cat: IngredientCatalogue): (RecipeIngredientLine & { name: string })[] {
  return recipe.ingredients.map((l) => {
    let ingredientId = l.ingredientId;
    if (!ingredientId) {
      const m = cat.matcher.match(l.name);
      if (m.status === 'matched' && m.ingredientId) ingredientId = m.ingredientId;
    }
    return {
      id: l.id,
      recipeId: recipe.id,
      name: l.name,
      ...(ingredientId ? { ingredientId } : {}),
      quantity: l.quantity,
      optional: l.optional,
      order: l.order,
    };
  });
}

/** Engine cost over refdata + household prices. `scale` multiplies every quantity (servings scaling). */
export function costRecipe(recipe: CalcRecipe, deps: CalcDeps, opts: { scale?: number } = {}): CostResult {
  const lines = toEngineLines(recipe, deps.catalogue);
  const names = new Map(lines.map((l) => [l.id, l.name]));
  const r = engineCostRecipe({
    lines,
    servings: recipe.servings,
    ...(opts.scale !== undefined ? { scale: opts.scale } : {}),
    prices: deps.prices,
    converter: deps.catalogue.converter,
    ingredients: deps.catalogue.get,
  });
  const mapLine = (l: (typeof r.lines)[number]): CostResult['lines'][number] => ({
    lineId: l.lineId,
    name: names.get(l.lineId) ?? '',
    status: l.status,
    ...(l.costPence !== undefined ? { costPence: l.costPence } : {}),
    ...(l.price ? { kind: l.price.kind, source: l.price.source, observedOn: l.price.observedOn, isEstimate: l.price.isEstimate } : {}),
    ...(l.basis ? { basis: l.basis } : {}),
    ...(l.reason ? { reason: l.reason, reasonLabel: UNCOSTED_LABEL[l.reason] } : {}),
  });
  const mapped = r.lines.map(mapLine);
  const sources = new Map<string, CostSourceUsed>();
  let kind: PriceKind | null = null;
  for (const l of r.lines) {
    if (!l.price) continue;
    sources.set(`${l.price.kind}|${l.price.source}|${l.price.observedOn}`, { kind: l.price.kind, source: l.price.source, observedOn: l.price.observedOn });
    if (kind === null || PRICE_KIND_RANK[l.price.kind] > PRICE_KIND_RANK[kind]) kind = l.price.kind;
  }
  return {
    totalPence: r.totalPence,
    perServingPence: r.perServingPence,
    servings: r.servings,
    coveragePct: r.coveragePct,
    isPartial: r.isPartial,
    includesEstimates: r.includesEstimates,
    kind,
    sources: [...sources.values()],
    lines: mapped,
    uncosted: mapped.filter((l) => l.status === 'uncosted'),
  };
}

/**
 * Engine nutrition over CoFID. Per serving = recipe total / recipe servings. Unknown stays Unknown (never 0);
 * 'to taste' lines are treated as negligible and reported in `warnings`; ranges use the midpoint (estimate).
 */
export function nutritionForRecipe(recipe: CalcRecipe, deps: CalcDeps): NutritionResult {
  const lines = toEngineLines(recipe, deps.catalogue);
  const nLines: NutritionLine[] = lines.map((l) => {
    const profile = l.ingredientId ? deps.cofid.profile(l.ingredientId) : undefined;
    return {
      id: l.id,
      name: l.name,
      ...(l.ingredientId ? { ingredientId: l.ingredientId } : {}),
      quantity: l.quantity,
      optional: l.optional,
      ...(profile ? { profile } : {}),
    };
  });
  const r = calculateRecipeNutrition(nLines, recipe.servings, deps.catalogue.grams, {
    treatToTasteAsNegligible: true,
    ...(deps.now ? { now: deps.now } : {}),
  });
  return {
    servings: r.servings,
    perServing: r.perServing,
    totals: r.totals,
    coveragePct: r.ingredientCoveragePct,
    missing: r.missingIngredients.map((m) => ({ name: m.name, reason: m.reason, reasonLabel: MISSING_LABEL[m.reason] ?? m.reason })),
    warnings: r.warnings,
    hasEstimates: Object.values(r.totals).some((n) => n.estimate),
    attribution: deps.cofid.attribution,
    disclaimer: NUTRITION_DISCLAIMER,
    calculatedAt: r.calculatedAt,
  };
}

/** What the recipe store keeps on a RecipeView (library cards, sorting, price bands). */
export interface RecipeSummary {
  cost: RecipeCost;
  nutritionPerServing: NutrientValue[];
}

export interface RecipeCalculator {
  /** Full result for the detail page and planner. Cached per recipe version. */
  forRecipe(recipe: CalcRecipe): RecipeCalculation;
  /** Compact summary stored on RecipeView. */
  summarise(recipe: CalcRecipe): RecipeSummary;
  nutritionPerServing(recipe: CalcRecipe): NutrientMap;
  /** Drop every cached result (price or refdata change). */
  clear(): void;
}

export interface CalculatorOptions {
  catalogue?: IngredientCatalogue;
  priceSource?: PriceSource;
  genericPrices?: readonly PriceObservation[];
  cofid?: CofidProfiles;
  now?: () => Date;
}

export function createRecipeCalculator(opts: CalculatorOptions = {}): RecipeCalculator {
  const catalogue = opts.catalogue ?? getIngredientCatalogue();
  const generic = opts.genericPrices ?? loadGenericPrices();
  const cofid = opts.cofid ?? loadCofidProfiles();
  const cache = new Map<string, RecipeCalculation>();
  let pricesFor = '';
  let prices: readonly PriceObservation[] = generic;

  const deps = (): CalcDeps => {
    // Rebuild the merged price list only when the household price source changed.
    const v = opts.priceSource?.version() ?? '';
    if (v !== pricesFor || prices === generic) {
      pricesFor = v;
      prices = opts.priceSource ? [...opts.priceSource.observations(), ...generic] : generic;
    }
    return { catalogue, prices, cofid, ...(opts.now ? { now: opts.now } : {}) };
  };

  // Cache per recipe VERSION: id + updatedAt + servings + the price source version. Edits bump updatedAt.
  const keyOf = (r: CalcRecipe) => `${r.id}|${r.updatedAt}|${r.servings}|${opts.priceSource?.version() ?? ''}`;

  const forRecipe = (r: CalcRecipe): RecipeCalculation => {
    const key = keyOf(r);
    const hit = cache.get(key);
    if (hit) return hit;
    const d = deps();
    const out = { cost: costRecipe(r, d), nutrition: nutritionForRecipe(r, d) };
    if (cache.size > 2000) cache.clear();
    cache.set(key, out);
    return out;
  };

  return {
    forRecipe,
    nutritionPerServing: (r) => forRecipe(r).nutrition.perServing,
    summarise(r) {
      const { cost, nutrition } = forRecipe(r);
      const first = cost.sources[0];
      return {
        cost: {
          totalPence: cost.totalPence,
          kind: cost.kind ?? 'generic_estimate',
          ...(first ? { observedOn: first.observedOn, source: first.source } : {}),
          ...(cost.isPartial ? { partial: true } : {}),
        },
        nutritionPerServing: Object.values(nutrition.perServing),
      };
    },
    clear: () => cache.clear(),
  };
}

const KEY = Symbol.for('fr.recipes.calculator');
type G = typeof globalThis & { [KEY]?: RecipeCalculator };

/**
 * Process-wide calculator: generic refdata prices plus the shared price store's recorded observations
 * (receipt prices), which the engine ranks above generic estimates (D34).
 */
export function getRecipeCalculator(): RecipeCalculator {
  const g = globalThis as G;
  return (g[KEY] ??= createRecipeCalculator({ priceSource: getPriceStore().asPriceSource() }));
}
