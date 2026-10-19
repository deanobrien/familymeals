import type { IsoDate, IsoDateTime, Quantity } from '../contract';
import type { Confidence, PantryItem, StalenessPolicy } from './types';

export const EPS = 1e-9;
export const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
export const today = (now: IsoDateTime): IsoDate => now.slice(0, 10);

export function dayNumber(d: IsoDate | IsoDateTime): number {
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number);
  return Math.floor(Date.UTC(y!, (m ?? 1) - 1, dd ?? 1) / 86_400_000);
}
export const daysBetween = (from: IsoDate | IsoDateTime, to: IsoDate | IsoDateTime): number => dayNumber(to) - dayNumber(from);
export function addDays(d: IsoDate, n: number): IsoDate {
  return new Date((dayNumber(d) + n) * 86_400_000).toISOString().slice(0, 10);
}

export const isExact = (q: Quantity): q is Quantity & { value: number } => q.kind === 'exact' && typeof q.value === 'number';
export const exactQ = (value: number, unit: Quantity['unit'], originalText?: string): Quantity => ({
  kind: 'exact', value: round6(value), ...(unit ? { unit } : {}),
  originalText: originalText ?? `${round6(value)}${unit ? ' ' + unit : ''}`,
});
export const fmtQ = (q: Quantity): string =>
  isExact(q) ? `${round6(q.value)}${q.unit ? ' ' + q.unit : ''}` : q.originalText;

/** Confidence decay: untouched stock is flagged stale, never assumed indefinitely. */
export function assessConfidence(item: PantryItem, now: IsoDateTime, policy: StalenessPolicy): Confidence {
  const ageDays = daysBetween(item.lastUpdated, now);
  if (item.expiry && daysBetween(today(now), item.expiry) < 0) {
    return { status: 'expired', ageDays, message: `expired on ${item.expiry}` };
  }
  const limit = (item.ingredientId ? policy.perIngredient?.[item.ingredientId] : undefined) ?? policy.staleAfterDays;
  if (ageDays > limit) {
    return { status: 'stale', ageDays, message: `stale — please confirm (not updated for ${ageDays} days)` };
  }
  if (!isExact(item.quantity)) {
    return { status: 'approximate', ageDays, message: `approximate quantity (${item.quantity.originalText})` };
  }
  return { status: 'confident', ageDays, message: 'confirmed recently' };
}
