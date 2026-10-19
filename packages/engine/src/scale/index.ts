/**
 * Serving scaling and display formatting.
 *
 *  - Stored values are scaled exactly (no rounding beyond float-noise removal).
 *  - Ranges scale both ends. `to_taste` and `unparsed` are returned unchanged.
 *  - `approximate` quantities scale only when an explicit number was written ("2 pinches" x2 ->
 *    "4 pinches"); a bare "a pinch" stays "a pinch" — we never manufacture precision.
 *  - Display rounding is a separate, presentation-only step (`formatQuantity`, `roundForDisplay`).
 */
import type { Quantity, Unit } from '../contract';
import { roundStored } from '../units/index';

export class ScaleError extends Error {
  override name = 'ScaleError';
}

function assertFactor(factor: number): void {
  if (!Number.isFinite(factor) || factor <= 0) throw new ScaleError(`Scale factor must be a finite number > 0 (got ${factor})`);
}

/** Multiply a quantity by `factor` (> 0). Returns a new object; input is not mutated. */
export function scaleQuantity(q: Quantity, factor: number): Quantity {
  assertFactor(factor);
  switch (q.kind) {
    case 'to_taste':
    case 'unparsed':
      return { ...q };
    case 'exact':
      return q.value === undefined ? { ...q } : { ...q, value: roundStored(q.value * factor) };
    case 'range':
    case 'approximate': {
      const out: Quantity = { ...q };
      if (q.value !== undefined) out.value = roundStored(q.value * factor);
      if (q.min !== undefined) out.min = roundStored(q.min * factor);
      if (q.max !== undefined) out.max = roundStored(q.max * factor);
      return out;
    }
  }
}

/** Factor to go from `fromServings` to `toServings` (both finite and > 0). */
export function servingsFactor(fromServings: number, toServings: number): number {
  if (!Number.isFinite(fromServings) || fromServings <= 0) throw new ScaleError(`fromServings must be > 0 (got ${fromServings})`);
  if (!Number.isFinite(toServings) || toServings <= 0) throw new ScaleError(`toServings must be > 0 (got ${toServings})`);
  return toServings / fromServings;
}

export function scaleToServings(q: Quantity, fromServings: number, toServings: number): Quantity {
  return scaleQuantity(q, servingsFactor(fromServings, toServings));
}

// ---------------------------------------------------------------------------------------------
// Display

export interface DisplayAmount {
  value: number;
  unit: Unit | undefined;
}

const FRACTION_GLYPH: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };
const SPOON_UNITS = new Set<Unit | undefined>(['tsp', 'tbsp', 'cup']);
const COUNT_UNITS = new Set<Unit | undefined>([undefined, 'item', 'clove', 'slice', 'can', 'pack', 'bunch', 'sprig', 'stick']);

function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step;
}

/**
 * Presentation rounding. Promotes g→kg and ml→l at ≥1000; mg→g at ≥1000.
 * Never rounds a positive amount down to zero (shows the smallest step instead).
 */
export function roundForDisplay(value: number, unit: Unit | undefined): DisplayAmount {
  if (!Number.isFinite(value)) return { value, unit };
  if (value === 0) return { value: 0, unit };
  let v = value;
  let u = unit;
  if (u === 'mg' && v >= 1000) { v /= 1000; u = 'g'; }
  if (u === 'g' && v >= 1000) { v /= 1000; u = 'kg'; }
  if (u === 'ml' && v >= 1000) { v /= 1000; u = 'l'; }

  let step: number;
  if (u === 'g' || u === 'ml' || u === 'mg') step = v >= 100 ? 5 : v >= 10 ? 1 : v >= 1 ? 0.5 : 0.1;
  else if (u === 'kg' || u === 'l') step = 0.05;
  else if (SPOON_UNITS.has(u) || COUNT_UNITS.has(u)) step = 0.25;
  else step = 0.1; // floz, pint
  let r = roundStored(roundTo(v, step));
  if (r === 0) r = step;
  return { value: r, unit: u };
}

const UNIT_LABEL: Record<Unit, [string, string]> = {
  mg: ['mg', 'mg'], g: ['g', 'g'], kg: ['kg', 'kg'], ml: ['ml', 'ml'], l: ['l', 'l'],
  tsp: ['tsp', 'tsp'], tbsp: ['tbsp', 'tbsp'], cup: ['cup', 'cups'], floz: ['fl oz', 'fl oz'], pint: ['pint', 'pints'],
  item: ['', ''], clove: ['clove', 'cloves'], slice: ['slice', 'slices'], can: ['can', 'cans'], pack: ['pack', 'packs'],
  bunch: ['bunch', 'bunches'], sprig: ['sprig', 'sprigs'], stick: ['stick', 'sticks'],
};
const TIGHT_UNITS = new Set<Unit>(['mg', 'g', 'kg', 'ml', 'l']);

/** "1½", "0.35", "2". Uses ¼ ½ ¾ glyphs for spoon / count units. */
export function formatNumber(value: number, unit: Unit | undefined): string {
  if (SPOON_UNITS.has(unit) || COUNT_UNITS.has(unit)) {
    const whole = Math.floor(value);
    const frac = roundStored(value - whole);
    const glyph = FRACTION_GLYPH[frac];
    if (glyph) return whole === 0 ? glyph : `${whole}${glyph}`;
  }
  return String(roundStored(value));
}

function unitLabel(unit: Unit | undefined, value: number): string {
  if (!unit) return '';
  const [one, many] = UNIT_LABEL[unit];
  return value > 1 ? many : one;
}

function joinAmount(num: string, unit: Unit | undefined, value: number): string {
  const label = unitLabel(unit, value);
  if (!label) return num;
  return unit && TIGHT_UNITS.has(unit) ? `${num}${label}` : `${num} ${label}`;
}

/** Human-readable amount (without the ingredient name). Presentation only. */
export function formatQuantity(q: Quantity): string {
  switch (q.kind) {
    case 'to_taste':
      return 'to taste';
    case 'unparsed':
      return q.originalText;
    case 'exact': {
      if (q.value === undefined) return q.originalText;
      const d = roundForDisplay(q.value, q.unit);
      return joinAmount(formatNumber(d.value, d.unit), d.unit, d.value);
    }
    case 'range': {
      if (q.min === undefined || q.max === undefined) return q.originalText;
      const lo = roundForDisplay(q.min, q.unit);
      const hi = roundForDisplay(q.max, q.unit);
      if (lo.unit !== hi.unit) {
        return `${joinAmount(formatNumber(lo.value, lo.unit), lo.unit, lo.value)}–${joinAmount(formatNumber(hi.value, hi.unit), hi.unit, hi.value)}`;
      }
      if (lo.value === hi.value) return joinAmount(formatNumber(lo.value, lo.unit), lo.unit, lo.value);
      return joinAmount(`${formatNumber(lo.value, lo.unit)}–${formatNumber(hi.value, hi.unit)}`, hi.unit, hi.value);
    }
    case 'approximate': {
      const label = q.approxLabel ?? 'some';
      if (label === 'about' || label === 'heaped' || label === 'rounded' || label === 'generous' || label === 'scant') {
        const inner: Quantity = q.value !== undefined
          ? { kind: 'exact', value: q.value, unit: q.unit, originalText: q.originalText }
          : { kind: 'range', min: q.min, max: q.max, unit: q.unit, originalText: q.originalText };
        const amount = formatQuantity(inner);
        return label === 'about' ? `about ${amount}` : `${amount} (${label})`;
      }
      if (q.value !== undefined && q.value !== 1) {
        return `${formatNumber(q.value, undefined)} ${pluralLabel(label)}`;
      }
      if (q.min !== undefined && q.max !== undefined) {
        return `${formatNumber(q.min, undefined)}–${formatNumber(q.max, undefined)} ${pluralLabel(label)}`;
      }
      return `${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}`;
    }
  }
}

function pluralLabel(label: string): string {
  if (label === 'cm' || label === 'mm') return label;
  if (label === 'inch') return 'inches';
  if (/(ch|sh|s|x)$/.test(label)) return `${label}es`;
  return `${label}s`;
}
