// Thin interface over the pantry engine's public API (@fr/engine/pantry, lane L22a).
// Pure (no server-only imports) so client components can share its types and helpers. Production unit
// conversion comes from the server catalogue (lib/server/refdata/catalogue.ts) and is injected via makeCtx.
import { createQuantityConverter } from '@fr/engine/units';
import type { Uuid } from '@fr/domain';
import type { EngineCtx, StalenessPolicy, UnitConverter } from '@fr/engine/pantry';

export * from '@fr/engine/pantry';
export type { IsoDate, IsoDateTime, PurchaseEvent, Quantity, Requirement, Unit, Uuid } from '@fr/domain';

export const DEFAULT_STALE_AFTER_DAYS = 14;
export const EXPIRING_SOON_DAYS = 3;
export const URGENCY_DAYS = 5;

/**
 * Converter without ingredient data: same-dimension conversions only (mass<->mass, volume<->volume),
 * via @fr/engine/units (pint 568.26125 ml). Mass<->volume and count<->mass need density / unit weight,
 * so they return null and nothing is deducted across an unsafe conversion. The server passes the
 * catalogue-backed converter instead.
 */
export const basicConverter: UnitConverter = createQuantityConverter();

export function makeCtx(opts: {
  now: string;
  staleAfterDays?: number;
  perIngredient?: Record<Uuid, number>;
  newId?: () => Uuid;
  converter?: UnitConverter;
}): EngineCtx {
  const policy: StalenessPolicy = {
    staleAfterDays: opts.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS,
    ...(opts.perIngredient ? { perIngredient: opts.perIngredient } : {}),
  };
  return {
    now: opts.now,
    converter: opts.converter ?? basicConverter,
    newId: opts.newId ?? (() => crypto.randomUUID()),
    policy,
  };
}
