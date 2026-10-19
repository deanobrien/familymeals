import type { QuantityConverter } from '../units/converter';
import type { CanonicalIngredient, IsoDate, Pence, PriceKind, Quantity, Uuid } from '../contract';

/** Backed in production by `createQuantityConverter` (@fr/engine/units). */
export type UnitConverter = QuantityConverter;

export type IngredientLookup = (id: Uuid) => CanonicalIngredient | undefined;

export interface PriceChoice {
  pricePence: Pence;
  packQuantity: Quantity;
  kind: PriceKind;
  source: string;
  observedOn: IsoDate;
  isEstimate: boolean;
  productPackId?: Uuid;
  retailer?: string;
}

export interface PantryStock { ingredientId: Uuid; quantity: Quantity; }
