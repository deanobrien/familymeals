import type { Quantity } from '../../src/contract';
import { exactQ } from '../../src/pantry/common';
import type { EngineCtx, PantryItem, UnitConverter } from '../../src/pantry/types';

const MASS: Record<string, number> = { mg: 0.001, g: 1, kg: 1000 };
const VOL: Record<string, number> = { ml: 1, l: 1000 };
/** ml-per-g density per ingredient (g/ml) for volume<->mass. */
export const DENSITY: Record<string, number> = { milk: 1.03 };

/** Test double: same-dimension conversions, plus volume<->mass only for ingredients with density. */
export const converter: UnitConverter = {
  convert(q, to, ing) {
    if (q.kind !== 'exact' || q.value === undefined || !q.unit) return null;
    const id = typeof ing === 'string' ? ing : ing?.id;
    const v = q.value;
    if (q.unit in MASS && to in MASS) return exactQ((v * MASS[q.unit]!) / MASS[to]!, to);
    if (q.unit in VOL && to in VOL) return exactQ((v * VOL[q.unit]!) / VOL[to]!, to);
    const d = id ? DENSITY[id] : undefined;
    if (d && q.unit in VOL && to in MASS) return exactQ((v * VOL[q.unit]! * d) / MASS[to]!, to);
    if (d && q.unit in MASS && to in VOL) return exactQ((v * MASS[q.unit]!) / d / VOL[to]!, to);
    return q.unit === to ? q : null;
  },
};

export const NOW = '2026-10-19T09:00:00.000Z';
let n = 0;
export const mkCtx = (over: Partial<EngineCtx> = {}): EngineCtx => ({
  now: NOW, converter, newId: () => `id-${++n}`, policy: { staleAfterDays: 30 }, ...over,
});
export const q = (value: number, unit: Quantity['unit']): Quantity => exactQ(value, unit);
export const item = (over: Partial<PantryItem> & { id: string }): PantryItem => ({
  householdId: 'h1', name: over.id, quantity: q(1, 'item'), lastUpdated: '2026-10-15T09:00:00.000Z', source: 'manual', ...over,
});
