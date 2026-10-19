// Thin interface over the pantry engine's public API (lane L22a).
// TODO: replace the _vendor import with @fr/engine/pantry after merge batch 2; nothing else in the app
// imports _vendor directly, so this file is the only swap point.
import type { Unit, Quantity, Uuid } from './_vendor/contract';
import { exactQ, fmtQ, isExact, round6, today } from './_vendor/common';
import type { EngineCtx, StalenessPolicy, UnitConverter } from './_vendor/types';

export * from './_vendor';
export { exactQ, fmtQ, isExact, round6, today };

export const DEFAULT_STALE_AFTER_DAYS = 14;
export const EXPIRING_SOON_DAYS = 3;
export const URGENCY_DAYS = 5;

const MASS_G: Partial<Record<Unit, number>> = { mg: 0.001, g: 1, kg: 1000 };
const VOLUME_ML: Partial<Record<Unit, number>> = { ml: 1, l: 1000, tsp: 5, tbsp: 15, cup: 240, floz: 28.4131, pint: 568.261 };

/**
 * Same-dimension converter only (mass<->mass, volume<->volume). Mass<->volume and count<->mass need
 * density / unit-weight data, which belongs to the core engine's converter; until it is merged we
 * return null so the pantry stays on the safe side (nothing is deducted across unsafe conversions).
 */
export const basicConverter: UnitConverter = {
  convert(q: Quantity, to: NonNullable<Quantity['unit']>): Quantity | null {
    if (!isExact(q) || !q.unit) return null;
    if (q.unit === to) return q;
    for (const table of [MASS_G, VOLUME_ML]) {
      const from = table[q.unit];
      const target = table[to];
      if (from !== undefined && target !== undefined) return exactQ((q.value * from) / target, to);
    }
    return null;
  },
};

export function makeCtx(opts: {
  now: string;
  staleAfterDays?: number;
  perIngredient?: Record<Uuid, number>;
  newId?: () => Uuid;
}): EngineCtx {
  const policy: StalenessPolicy = {
    staleAfterDays: opts.staleAfterDays ?? DEFAULT_STALE_AFTER_DAYS,
    ...(opts.perIngredient ? { perIngredient: opts.perIngredient } : {}),
  };
  return { now: opts.now, converter: basicConverter, newId: opts.newId ?? (() => crypto.randomUUID()), policy };
}
