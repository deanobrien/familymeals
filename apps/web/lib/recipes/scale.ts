// Display-only serving scaling for recipe detail. Calculations of record live in @fr/engine (lane L3);
// TODO(@fr/engine): swap to the engine's scale + format helpers when merged.
import type { Quantity, Unit } from './types';

const FRACTIONS: Record<number, string> = {
  0.125: '⅛',
  0.25: '¼',
  0.333: '⅓',
  0.375: '⅜',
  0.5: '½',
  0.625: '⅝',
  0.667: '⅔',
  0.75: '¾',
  0.875: '⅞',
};

const UNIT_LABEL: Partial<Record<Unit, [string, string]>> = {
  floz: ['fl oz', 'fl oz'],
  clove: ['clove', 'cloves'],
  slice: ['slice', 'slices'],
  can: ['can', 'cans'],
  pack: ['pack', 'packs'],
  bunch: ['bunch', 'bunches'],
  sprig: ['sprig', 'sprigs'],
  stick: ['stick', 'sticks'],
  pint: ['pint', 'pints'],
  cup: ['cup', 'cups'],
};

/** Round a scaled number to a cook-friendly value. Never rounds a positive amount down to zero. */
export function roundForDisplay(value: number, unit?: Unit): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  const metric = unit === 'g' || unit === 'ml' || unit === 'mg';
  if (value >= 100) return metric ? Math.round(value / 5) * 5 : Math.round(value);
  if (value >= 10) return Math.round(value);
  if (value >= 1) return Math.round(value * 4) / 4;
  return Math.max(0.125, Math.round(value * 8) / 8);
}

/** Format a number with unicode fractions for small values (1.5 -> "1½"), decimals otherwise. */
export function formatAmount(value: number): string {
  if (value <= 0) return '0';
  const whole = Math.floor(value);
  const frac = Math.round((value - whole) * 1000) / 1000;
  if (frac === 0) return String(whole);
  const key = Object.keys(FRACTIONS)
    .map(Number)
    .find((k) => Math.abs(k - frac) < 0.01);
  if (key !== undefined) return `${whole > 0 ? whole : ''}${FRACTIONS[key]}`;
  return String(Math.round(value * 100) / 100);
}

/** Convert g -> kg / ml -> l for large amounts (display only). */
function promote(value: number, unit?: Unit): { value: number; unit?: Unit | undefined } {
  if (unit === 'g' && value >= 1000) return { value: value / 1000, unit: 'kg' };
  if (unit === 'ml' && value >= 1000) return { value: value / 1000, unit: 'l' };
  return { value, unit };
}

function unitLabel(unit: Unit | undefined, amount: number): string {
  if (!unit || unit === 'item') return '';
  const pair = UNIT_LABEL[unit];
  if (!pair) return unit;
  return amount === 1 ? pair[0] : pair[1];
}

function render(amount: number, unit?: Unit): string {
  const p = promote(roundForDisplay(amount, unit), unit);
  const shown = p.unit === 'kg' || p.unit === 'l' ? Math.round(p.value * 100) / 100 : p.value;
  const text = p.unit === 'kg' || p.unit === 'l' ? String(shown) : formatAmount(p.value);
  const label = unitLabel(p.unit, shown);
  return label ? `${text} ${label}` : text;
}

export function isScalable(q: Quantity): boolean {
  return (
    (q.kind === 'exact' && q.value != null) ||
    (q.kind === 'range' && q.min != null && q.max != null)
  );
}

/**
 * Display string for a quantity scaled by `factor`. Exact and range quantities are scaled and display-rounded;
 * approximate ("pinch"), to-taste and unparsed quantities are returned unchanged (never given an invented weight).
 */
export function scaleQuantityLabel(q: Quantity, factor: number): string {
  if (q.kind === 'exact' && q.value != null) return render(q.value * factor, q.unit);
  if (q.kind === 'range' && q.min != null && q.max != null) {
    const lo = roundForDisplay(q.min * factor, q.unit);
    const hi = roundForDisplay(q.max * factor, q.unit);
    if (lo === hi) return render(q.min * factor, q.unit);
    const unit = q.unit;
    const label = unitLabel(unit, hi);
    return `${formatAmount(lo)}–${formatAmount(hi)}${label ? ` ${label}` : ''}`;
  }
  if (q.kind === 'approximate') return q.approxLabel || q.originalText || 'a little';
  if (q.kind === 'to_taste') return 'to taste';
  return q.originalText;
}

/** Scale factor between recipe servings and the requested servings. */
export function servingsFactor(base: number, wanted: number): number {
  return base > 0 && wanted > 0 ? wanted / base : 1;
}
