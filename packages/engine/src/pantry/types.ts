import type { QuantityConverter } from '../units/converter';
import type { IsoDate, IsoDateTime, Quantity, Uuid } from '../contract';

/** Backed in production by `createQuantityConverter` (@fr/engine/units). */
export type UnitConverter = QuantityConverter;

export type PantrySource = 'manual' | 'purchase' | 'correction' | 'leftover';

/** A stock record. `lastUpdated` doubles as "last confirmed" for confidence decay. */
export interface PantryItem {
  id: Uuid;
  householdId: Uuid;
  ingredientId?: Uuid;
  name: string;
  quantity: Quantity;
  expiry?: IsoDate;
  lastUpdated: IsoDateTime;
  source: PantrySource;
  /** Every purchase event folded into this item (merges keep all ids so replay stays idempotent). */
  sourceEventIds?: Uuid[];
}

export interface StalenessPolicy {
  /** Default days of no update before stock is flagged stale. */
  staleAfterDays: number;
  /** Per-ingredient override (e.g. fresh produce 5, tinned 365). */
  perIngredient?: Record<Uuid, number>;
}

export type ConfidenceStatus = 'confident' | 'stale' | 'expired' | 'approximate';

export interface Confidence {
  status: ConfidenceStatus;
  ageDays: number;
  message: string;
}

export interface EngineCtx {
  now: IsoDateTime;
  converter: UnitConverter;
  newId: () => Uuid;
  policy: StalenessPolicy;
}
