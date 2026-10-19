import type { Quantity, Uuid } from '../contract';
import { assessConfidence, daysBetween, EPS, isExact, round6, today } from './common';
import type { EngineCtx, PantryItem } from './types';

export interface AllocateOpts { allowStale?: boolean; allowApproximate?: boolean }

export interface Allocation {
  itemId: Uuid; itemName: string;
  /** Amount taken, in the requirement's unit. */
  took: number;
  /** Amount taken, in the stock item's own unit. */
  tookInStockUnit: number; stockUnit: Quantity['unit'];
  /** Set when stale/approximate stock was used because the caller explicitly allowed it. */
  flag?: string;
}
export interface Skipped { itemId: Uuid; itemName: string; reason: string }

export interface AllocationResult { allocations: Allocation[]; remaining: number; skipped: Skipped[] }

/** Core explainable allocation: take `need` (in `unit`) from usable stock, soonest expiry first. */
export function allocate(
  items: readonly PantryItem[], ingredientId: Uuid, need: number, unit: Quantity['unit'], ctx: EngineCtx, opts: AllocateOpts = {},
): AllocationResult {
  const skipped: Skipped[] = [];
  const usable: { item: PantryItem; avail: number; stockValue: number; flag?: string }[] = [];
  for (const item of items.filter((i) => i.ingredientId === ingredientId)) {
    const conf = assessConfidence(item, ctx.now, ctx.policy);
    const skip = (reason: string) => skipped.push({ itemId: item.id, itemName: item.name, reason });
    if (conf.status === 'expired') { skip(conf.message); continue; }
    let flag: string | undefined;
    if (conf.status === 'stale') {
      if (!opts.allowStale) { skip(conf.message); continue; }
      flag = conf.message;
    }
    const q = item.quantity;
    if (!isExact(q)) {
      if (!opts.allowApproximate || typeof q.value !== 'number') { skip(`approximate quantity (${q.originalText}) — not deducted`); continue; }
      flag = [flag, `approximate quantity (${q.originalText})`].filter(Boolean).join('; ');
    }
    const stockValue = q.value as number;
    let avail: number;
    if (q.unit === unit) avail = stockValue;
    else {
      const c = unit ? ctx.converter.convert({ ...q, kind: 'exact', value: stockValue }, unit, ingredientId) : null;
      if (!c || !isExact(c)) { skip(`cannot safely convert ${q.unit ?? 'unitless'} to ${unit ?? 'unitless'}`); continue; }
      avail = c.value;
    }
    if (avail <= EPS) continue;
    usable.push({ item, avail, stockValue, ...(flag ? { flag } : {}) });
  }
  usable.sort((a, b) => {
    const ea = a.item.expiry ? daysBetween(today(ctx.now), a.item.expiry) : Number.POSITIVE_INFINITY;
    const eb = b.item.expiry ? daysBetween(today(ctx.now), b.item.expiry) : Number.POSITIVE_INFINITY;
    if (ea !== eb) return ea < eb ? -1 : 1;
    return a.item.lastUpdated.localeCompare(b.item.lastUpdated);
  });
  let remaining = need;
  const allocations: Allocation[] = [];
  for (const u of usable) {
    if (remaining <= EPS) break;
    const took = Math.min(remaining, u.avail);
    allocations.push({
      itemId: u.item.id, itemName: u.item.name, took: round6(took),
      tookInStockUnit: round6(u.stockValue * (took / u.avail)), stockUnit: u.item.quantity.unit,
      ...(u.flag ? { flag: u.flag } : {}),
    });
    remaining = round6(remaining - took);
  }
  return { allocations, remaining: remaining <= EPS ? 0 : remaining, skipped };
}
