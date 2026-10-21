import type { Quantity } from '../contract';
import { UNIT_INFO } from '../units/index';

/**
 * Unit-price normalisation (P2-B, D401). A price for a pack is made comparable by dividing by the pack size in a common
 * basis: pence per kg for anything sold by weight, per litre for volume, per each for counts. Weight and volume are never
 * converted into each other (that needs a density, which a shop price does not carry): a shop that sold milk by the litre
 * and one that sold it by weight are simply not comparable. Counts compare only within the same basis.
 */
export type UnitBasis = 'kg' | 'l' | 'each';

export interface UnitPrice {
  basis: UnitBasis;
  /** Pence per kg / per litre / per each, NOT rounded (display rounds). */
  pencePerUnit: number;
  /** How the pack was described ("500 g", "2 l", "6 item"). */
  packLabel: string;
  /** false for a bare "1 item" (the receipt gave no pack size): compared per pack, and labelled that way. */
  packSizeKnown: boolean;
}

export const BASIS_LABEL: Record<UnitBasis, string> = { kg: 'per kg', l: 'per litre', each: 'per item' };

function packLabelOf(q: Quantity, unit: string): string {
  // A receipt line's raw text is long and noisy; only reuse the original wording when it is short.
  if (q.originalText && q.originalText.length <= 24) return q.originalText;
  return `${Math.round((q.value ?? 0) * 1000) / 1000} ${unit}`;
}

/** Unit price of a pack at `pricePence`, or null when the pack size is unusable (not exact/approximate, zero, non-finite). */
export function unitPriceOf(pricePence: number, pack: Quantity): UnitPrice | null {
  if (!Number.isFinite(pricePence) || pricePence < 0) return null;
  if ((pack.kind !== 'exact' && pack.kind !== 'approximate') || typeof pack.value !== 'number' || !(pack.value > 0) || !Number.isFinite(pack.value)) return null;
  const unit = pack.unit ?? 'item';
  const info = UNIT_INFO[unit];
  if (!info) return null;
  const size = pack.value * info.toBase;
  const label = packLabelOf(pack, unit);
  if (info.dimension === 'mass') return { basis: 'kg', pencePerUnit: pricePence / (size / 1000), packLabel: label, packSizeKnown: true };
  if (info.dimension === 'volume') return { basis: 'l', pencePerUnit: pricePence / (size / 1000), packLabel: label, packSizeKnown: true };
  return { basis: 'each', pencePerUnit: pricePence / size, packLabel: label, packSizeKnown: !(unit === 'item' && pack.value === 1) };
}

export function formatPence(p: number): string {
  const r = Math.round(p);
  return r < 0 ? `-£${(-r / 100).toFixed(2)}` : `£${(r / 100).toFixed(2)}`;
}

/** "£1.20 per kg" / "45p per litre". Sub-pound unit prices read better as pence. */
export function formatUnitPrice(u: Pick<UnitPrice, 'basis' | 'pencePerUnit'>): string {
  const p = u.pencePerUnit;
  const amount = p < 100 ? `${p < 10 ? p.toFixed(1).replace(/\.0$/, '') : Math.round(p)}p` : `£${(p / 100).toFixed(2)}`;
  return `${amount} ${BASIS_LABEL[u.basis]}`;
}
