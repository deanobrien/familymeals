import type { NutrientKey } from '../contract';
import {
  NUTRIENT_UNITS, type CalculatedNutrient, type MissingIngredient, type MissingReason,
} from './types';

/** A contribution to one nutrient total, already scaled to its absolute amount. */
export interface Part {
  id: string;
  name: string;
  status: 'known' | 'zero' | 'unknown' | 'unavailable';
  value?: number;            // absolute amount contributed (known/zero)
  lowerBound?: number;       // for nested unknown parts: known portion
  reason?: MissingReason;    // when unknown/unavailable
  sources: string[];
  estimate: boolean;
  derived: boolean;
}

/**
 * Policy (documented decision): if ANY part is unknown/unavailable the total is status 'unknown'
 * with value withheld, `incomplete: true`, the missing parts listed, and `lowerBound` = sum of the
 * known parts. We never emit a number as `value` that could be mistaken for a complete total, and
 * never emit 0 for unknown. All parts true-zero => 'zero'. No parts => 'unavailable'.
 */
export function combine(nutrient: NutrientKey, parts: Part[], calculatedAt: string): CalculatedNutrient {
  const unit = NUTRIENT_UNITS[nutrient];
  const sources = [...new Set(parts.flatMap(p => p.sources))].sort();
  const estimate = parts.some(p => p.estimate);
  const derived = parts.some(p => p.derived);
  const usable = parts.filter(p => p.status === 'known' || p.status === 'zero');
  const missing = parts.filter(p => p.status === 'unknown' || p.status === 'unavailable');
  const coveragePct = parts.length === 0 ? 0 : (usable.length / parts.length) * 100;
  const missingIngredients: MissingIngredient[] = missing.map(p => ({
    id: p.id, name: p.name,
    reason: p.reason ?? (p.status === 'unavailable' ? 'nutrient_unavailable' : 'nutrient_unknown'),
  }));
  const base = { nutrient, unit, estimate, sources, calculatedAt, derived, coveragePct, missingIngredients };
  const src = sources.length ? sources.join('; ') : undefined;

  if (parts.length === 0) {
    return { ...base, status: 'unavailable', incomplete: false, source: src, estimate: false };
  }
  if (missing.length > 0) {
    const lb = parts.reduce(
      (s, p) => s + (p.status === 'known' || p.status === 'zero' ? p.value ?? 0 : p.lowerBound ?? 0), 0);
    const allUnavailable = parts.every(p => p.status === 'unavailable');
    return {
      ...base, status: allUnavailable ? 'unavailable' : 'unknown', incomplete: true,
      lowerBound: allUnavailable ? undefined : lb, source: src,
    };
  }
  const total = usable.reduce((s, p) => s + (p.value ?? 0), 0);
  const allZero = usable.every(p => p.status === 'zero');
  return { ...base, status: allZero ? 'zero' : 'known', value: allZero ? 0 : total, incomplete: false, source: src };
}

/** Divide a total by n (servings/days). Status and flags are preserved; unknown stays unknown. */
export function divideNutrient(n: CalculatedNutrient, divisor: number): CalculatedNutrient {
  if (!(divisor > 0) || !Number.isFinite(divisor)) throw new RangeError(`divisor must be > 0, got ${divisor}`);
  return {
    ...n,
    value: n.value === undefined ? undefined : n.value / divisor,
    lowerBound: n.lowerBound === undefined ? undefined : n.lowerBound / divisor,
  };
}
