import 'server-only';
import type { PriceObservation, Quantity } from '@fr/engine/cost';
import type { NutrientProfile } from '@fr/engine/nutrition';
import type { CofidDataset, CofidFood } from '@fr/refdata';
import ingredientsJson from '@fr/refdata/ingredients.json';
import pricesJson from '@fr/refdata/prices.json';
import cofidJson from '@fr/refdata/cofid.json';

/**
 * Refdata -> engine inputs (DECISIONS D60). JSON is imported (not read with fs) so it survives webpack bundling,
 * like the ingredient catalogue (D28).
 */
interface PriceSeed {
  ingredientId: string;
  pricePence: number;
  packQuantity: Quantity;
  kind: PriceObservation['kind'];
  observedOn: string;
  source: string;
}

/** The generic UK estimates as PriceObservations (kind 'generic_estimate', lowest priority in the hierarchy). */
export function loadGenericPrices(): PriceObservation[] {
  return (pricesJson as unknown as PriceSeed[]).map((p) => ({
    ingredientId: p.ingredientId,
    pricePence: p.pricePence,
    packQuantity: p.packQuantity,
    kind: p.kind,
    observedOn: p.observedOn,
    source: p.source,
  }));
}

export interface CofidProfiles {
  attribution: string;
  profile(ingredientId: string): NutrientProfile | undefined;
}

interface IngredientCofid {
  id: string;
  cofid?: { code: string; match: 'exact' | 'proxy' };
}

/** Per-100g CoFID profile per canonical ingredient. A 'proxy' mapping marks every value as an estimate. */
export function loadCofidProfiles(): CofidProfiles {
  const dataset = cofidJson as unknown as CofidDataset;
  const foods = new Map<string, CofidFood>();
  for (const f of dataset.foods) if (!f.duplicateCode) foods.set(f.code, f);
  const links = new Map(
    (ingredientsJson as unknown as IngredientCofid[]).flatMap((i) => (i.cofid ? [[i.id, i.cofid] as const] : [])),
  );
  const cache = new Map<string, NutrientProfile | undefined>();
  const source = `${dataset.source.name}, ${dataset.source.version}`;
  return {
    attribution: `Estimated from UK CoFID data (${dataset.source.name}, ${dataset.source.version}; ${dataset.source.licence}).`,
    profile(ingredientId) {
      if (cache.has(ingredientId)) return cache.get(ingredientId);
      const link = links.get(ingredientId);
      const food = link ? foods.get(link.code) : undefined;
      let out: NutrientProfile | undefined;
      if (link && food) {
        const per100g: NutrientProfile['per100g'] = {};
        for (const n of food.nutrients) {
          per100g[n.nutrient] = {
            status: n.status,
            ...(n.value !== undefined ? { value: n.value } : {}),
            estimate: n.estimate || link.match === 'proxy',
            source,
          };
        }
        out = { per100g, source };
      }
      cache.set(ingredientId, out);
      return out;
    },
  };
}
