// TODO: replace with @fr/engine/pantry after merge batch 2 (vendored verbatim from L22a-pantry/src/types.ts)
import type { CanonicalIngredient, IsoDate, IsoDateTime, Quantity, Uuid } from './contract';

/** Injected unit conversion (owned by the core engine). Returns null when conversion is unsafe/impossible. */
export interface UnitConverter {
  convert(q: Quantity, to: NonNullable<Quantity['unit']>, ingredient?: CanonicalIngredient | Uuid): Quantity | null;
}

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
