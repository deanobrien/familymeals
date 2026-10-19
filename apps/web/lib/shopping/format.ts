import type { Quantity, Unit } from './engine';
import { UNIT_LABELS } from './engine';

const trim = (n: number): string => String(Math.round(n * 100) / 100);

export function formatAmount(value: number, unit?: Unit): string {
  const u = unit ? UNIT_LABELS[unit] : '';
  return u ? `${trim(value)} ${u}` : trim(value);
}

/** Human label for a Quantity (falls back to the original text). */
export function formatQuantity(q: Quantity | undefined): string {
  if (!q) return '';
  if (q.kind === 'exact' || q.kind === 'approximate') {
    return typeof q.value === 'number' ? formatAmount(q.value, q.unit) : q.originalText;
  }
  if (q.kind === 'range' && typeof q.max === 'number') {
    const lo = typeof q.min === 'number' ? `${trim(q.min)}-` : '';
    const u = q.unit ? UNIT_LABELS[q.unit] : '';
    return `${lo}${trim(q.max)}${u ? ` ${u}` : ''}`;
  }
  return q.originalText;
}
