/**
 * Thin interface onto the shopping state engine (`@fr/engine/shopping`, lane L17a).
 * Client-safe: the default converter is the L3 unit table without ingredient data (mass/volume within
 * their dimension, imperial included). The server repository injects the refdata catalogue converter
 * (density / unit weights), and the server is authoritative for every decision.
 */
export * from '@fr/engine/shopping';
export type { Contribution, PurchaseEvent, Quantity, Requirement, Unit, Uuid } from '@fr/domain';

import type { Unit } from '@fr/domain';
import { createQuantityConverter } from '@fr/engine/units';
import type { EngineContext } from '@fr/engine/shopping';

type Dim = 'mass' | 'volume';
const DIM: Partial<Record<Unit, Dim>> = {
  mg: 'mass', g: 'mass', kg: 'mass',
  ml: 'volume', l: 'volume', tsp: 'volume', tbsp: 'volume', cup: 'volume', floz: 'volume', pint: 'volume',
};

export const UNIT_LABELS: Record<Unit, string> = {
  mg: 'mg', g: 'g', kg: 'kg', ml: 'ml', l: 'l', tsp: 'tsp', tbsp: 'tbsp', cup: 'cup', floz: 'fl oz',
  pint: 'pint', item: '', clove: 'clove', slice: 'slice', can: 'can', pack: 'pack', bunch: 'bunch',
  sprig: 'sprig', stick: 'stick',
};

/** Units offered by the add / partial forms. */
export const ALL_UNITS: Unit[] = [
  'item', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'pint', 'can', 'pack', 'bunch', 'clove', 'slice', 'sprig', 'stick',
];

/** Units that can be converted to/from `unit` without density data. */
export function compatibleUnits(unit: Unit): Unit[] {
  const d = DIM[unit];
  if (!d) return [unit];
  return ALL_UNITS.filter((u) => DIM[u] === d);
}

/** Client-side converter: `@fr/engine/units` with no ingredient lookup (never crosses mass/volume/count). */
export const basicConverter = createQuantityConverter();

export const defaultEngineContext: EngineContext = { converter: basicConverter };
