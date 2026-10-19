/**
 * Unit metadata and safe conversion.
 *
 * Rules (BRIEF §8, BRIEF-REVIEW #3):
 *  - Conversion within a dimension is always allowed (mass↔mass, volume↔volume).
 *  - Count units only convert to the *same* count unit (a clove is not a bulb, a can is not a pack).
 *  - volume↔mass ONLY when the ingredient carries `densityGPerMl`.
 *  - count('item' / unitless)↔mass ONLY via `unitWeightG`, and the result is flagged `estimate`.
 *  - `approximate`, `to_taste` and `unparsed` quantities are NEVER converted.
 */
import type {
  CanonicalIngredient,
  CountUnit,
  Dimension,
  MassUnit,
  Quantity,
  Unit,
  VolumeUnit,
} from '../contract';

export interface UnitInfo {
  dimension: Dimension;
  /** Multiplier to the dimension's base unit (g, ml, or the count unit itself). */
  toBase: number;
}

/** UK conventions: metric cup (250 ml), imperial fl oz and pint. */
export const UNIT_INFO: Readonly<Record<Unit, UnitInfo>> = Object.freeze({
  mg: { dimension: 'mass', toBase: 0.001 },
  g: { dimension: 'mass', toBase: 1 },
  kg: { dimension: 'mass', toBase: 1000 },
  ml: { dimension: 'volume', toBase: 1 },
  l: { dimension: 'volume', toBase: 1000 },
  tsp: { dimension: 'volume', toBase: 5 },
  tbsp: { dimension: 'volume', toBase: 15 },
  cup: { dimension: 'volume', toBase: 250 },
  floz: { dimension: 'volume', toBase: 28.4130625 },
  pint: { dimension: 'volume', toBase: 568.26125 },
  item: { dimension: 'count', toBase: 1 },
  clove: { dimension: 'count', toBase: 1 },
  slice: { dimension: 'count', toBase: 1 },
  can: { dimension: 'count', toBase: 1 },
  pack: { dimension: 'count', toBase: 1 },
  bunch: { dimension: 'count', toBase: 1 },
  sprig: { dimension: 'count', toBase: 1 },
  stick: { dimension: 'count', toBase: 1 },
});

export const MASS_UNITS: readonly MassUnit[] = ['mg', 'g', 'kg'];
export const VOLUME_UNITS: readonly VolumeUnit[] = ['ml', 'l', 'tsp', 'tbsp', 'cup', 'floz', 'pint'];
export const COUNT_UNITS: readonly CountUnit[] = ['item', 'clove', 'slice', 'can', 'pack', 'bunch', 'sprig', 'stick'];

export function isUnit(value: unknown): value is Unit {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(UNIT_INFO, value);
}

/** Dimension of a unit; an absent unit on a numeric quantity is a unitless count. */
export function dimensionOf(unit: Unit | undefined): Dimension {
  return unit === undefined ? 'count' : UNIT_INFO[unit].dimension;
}

/** Base unit per dimension; count quantities keep their own unit ('item' for unitless). */
export function baseUnitOf(unit: Unit | undefined): Unit {
  const dim = dimensionOf(unit);
  if (dim === 'mass') return 'g';
  if (dim === 'volume') return 'ml';
  return unit ?? 'item';
}

/** Numeric kinds are the only ones that can ever be converted or summed. */
export function isNumericQuantity(q: Quantity): boolean {
  if (q.kind === 'exact') return isFiniteNonNegative(q.value);
  if (q.kind === 'range') return isFiniteNonNegative(q.min) && isFiniteNonNegative(q.max) && q.min! <= q.max!;
  return false;
}

function isFiniteNonNegative(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

/** Round away binary floating-point noise (1e-9 relative granularity is far below any kitchen scale). */
export function roundStored(n: number): number {
  if (n === 0) return 0;
  return Number.parseFloat(n.toPrecision(12));
}

export type ConversionFailure =
  | 'not_convertible_kind'
  | 'invalid_quantity'
  | 'incompatible_dimension'
  | 'incompatible_count_unit'
  | 'missing_density'
  | 'missing_unit_weight';

export type ConversionResult =
  | { ok: true; quantity: Quantity; estimate: boolean }
  | { ok: false; reason: ConversionFailure };

export interface ConversionOptions {
  /** Permit count↔mass via `unitWeightG` (result is flagged estimate). Default true for explicit conversions. */
  allowEstimate?: boolean;
}

/**
 * Factor f such that amount_in_target = amount_in_source * f, or a failure reason.
 * `unit === undefined` means a unitless count and is treated as 'item'.
 */
export function conversionFactor(
  from: Unit | undefined,
  to: Unit | undefined,
  ingredient?: Pick<CanonicalIngredient, 'densityGPerMl' | 'unitWeightG'>,
  options: ConversionOptions = {},
): { ok: true; factor: number; estimate: boolean } | { ok: false; reason: ConversionFailure } {
  const allowEstimate = options.allowEstimate ?? true;
  const fromDim = dimensionOf(from);
  const toDim = dimensionOf(to);
  const fromInfo = UNIT_INFO[from ?? 'item'];
  const toInfo = UNIT_INFO[to ?? 'item'];

  if (fromDim === toDim) {
    if (fromDim === 'count' && (from ?? 'item') !== (to ?? 'item')) {
      return { ok: false, reason: 'incompatible_count_unit' };
    }
    return { ok: true, factor: fromInfo.toBase / toInfo.toBase, estimate: false };
  }

  const pair = `${fromDim}>${toDim}`;
  if (pair === 'volume>mass' || pair === 'mass>volume') {
    const density = ingredient?.densityGPerMl?.value;
    if (!isFinitePositive(density)) return { ok: false, reason: 'missing_density' };
    // volume -> ml -> g  or  mass -> g -> ml
    const factor = pair === 'volume>mass'
      ? (fromInfo.toBase * density) / toInfo.toBase
      : fromInfo.toBase / density / toInfo.toBase;
    return { ok: true, factor, estimate: false };
  }

  if (pair === 'count>mass' || pair === 'mass>count') {
    const countUnit = pair === 'count>mass' ? from : to;
    if ((countUnit ?? 'item') !== 'item') return { ok: false, reason: 'incompatible_count_unit' };
    const weight = ingredient?.unitWeightG?.value;
    if (!allowEstimate || !isFinitePositive(weight)) return { ok: false, reason: 'missing_unit_weight' };
    const factor = pair === 'count>mass' ? weight / toInfo.toBase : fromInfo.toBase / weight;
    return { ok: true, factor, estimate: true };
  }

  // count<->volume is never meaningful without a chain of estimates.
  return { ok: false, reason: 'incompatible_dimension' };
}

function isFinitePositive(n: number | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0;
}

/**
 * Convert a quantity to `target`. Ranges convert both ends. `originalText` is preserved.
 * Never converts approximate / to_taste / unparsed.
 */
export function convertQuantity(
  q: Quantity,
  target: Unit,
  ingredient?: Pick<CanonicalIngredient, 'densityGPerMl' | 'unitWeightG'>,
  options: ConversionOptions = {},
): ConversionResult {
  if (q.kind !== 'exact' && q.kind !== 'range') return { ok: false, reason: 'not_convertible_kind' };
  if (!isNumericQuantity(q)) return { ok: false, reason: 'invalid_quantity' };
  const f = conversionFactor(q.unit, target, ingredient, options);
  if (!f.ok) return f;
  const quantity: Quantity = q.kind === 'exact'
    ? { kind: 'exact', value: roundStored(q.value! * f.factor), unit: target, originalText: q.originalText }
    : { kind: 'range', min: roundStored(q.min! * f.factor), max: roundStored(q.max! * f.factor), unit: target, originalText: q.originalText };
  return { ok: true, quantity, estimate: f.estimate };
}

/** Amount (min/max) of a numeric quantity expressed in its dimension's base unit. */
export function toBaseAmount(q: Quantity): { dimension: Dimension; baseUnit: Unit; min: number; max: number } | undefined {
  if (!isNumericQuantity(q)) return undefined;
  const info = UNIT_INFO[q.unit ?? 'item'];
  const min = q.kind === 'exact' ? q.value! : q.min!;
  const max = q.kind === 'exact' ? q.value! : q.max!;
  return { dimension: info.dimension, baseUnit: baseUnitOf(q.unit), min: min * info.toBase, max: max * info.toBase };
}

export * from './converter';
