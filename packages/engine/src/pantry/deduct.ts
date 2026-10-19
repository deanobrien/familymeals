import type { Quantity, Requirement } from '../contract';
import { allocate, type AllocateOpts, type Allocation, type Skipped } from './allocate';
import { exactQ, fmtQ, isExact } from './common';
import { reduceItem } from './ledger';
import type { EngineCtx, PantryItem } from './types';

export interface DeductionLine {
  displayName: string; ingredientId?: string;
  required: Quantity; deducted: Quantity; stillNeeded: Quantity;
  used: Allocation[]; skipped: Skipped[];
  explanation: string;
}
export interface DeductionResult { toBuy: Requirement[]; lines: DeductionLine[] }

/**
 * What still needs buying after counting pantry stock. Only confident, non-expired, convertible
 * stock is used. Stale/approximate stock is skipped (and reported) unless explicitly allowed.
 * Pure: does not modify the pantry (the shopping-list calc is a what-if, not a consumption).
 */
export function deductRequirements(
  requirements: readonly Requirement[], pantry: readonly PantryItem[], ctx: EngineCtx, opts: AllocateOpts = {},
): DeductionResult {
  const toBuy: Requirement[] = [];
  const lines: DeductionLine[] = [];
  // Virtual consumption so two requirements for the same ingredient don't double-count stock.
  let virtual = [...pantry];
  for (const req of requirements) {
    const q = req.quantity;
    const base = { displayName: req.displayName, ...(req.ingredientId ? { ingredientId: req.ingredientId } : {}), required: q };
    const keep = (why: string) => {
      toBuy.push(req);
      lines.push({ ...base, deducted: exactQ(0, q.unit), stillNeeded: q, used: [], skipped: [], explanation: `${req.displayName}: nothing deducted — ${why}.` });
    };
    if (!req.ingredientId) { keep('not matched to a canonical ingredient'); continue; }
    if (!isExact(q)) { keep(`requirement is ${q.kind} (${q.originalText}), so it is not safe to deduct`); continue; }
    const res = allocate(virtual, req.ingredientId, q.value, q.unit, ctx, opts);
    for (const a of res.allocations) virtual = reduceItem(virtual, a.itemId, a.tookInStockUnit);
    const stillNeeded = exactQ(res.remaining, q.unit);
    const parts: string[] = [];
    if (res.allocations.length) {
      parts.push(`used ${res.allocations.map((a) => `${fmtQ(exactQ(a.took, q.unit))} from "${a.itemName}"${a.flag ? ` (${a.flag})` : ''}`).join(', ')}`);
    } else parts.push('no usable stock');
    for (const s of res.skipped) parts.push(`skipped "${s.itemName}": ${s.reason}`);
    parts.push(res.remaining > 0 ? `still need ${fmtQ(stillNeeded)} of ${fmtQ(q)}` : 'fully covered by pantry');
    lines.push({
      ...base, deducted: exactQ(q.value - res.remaining, q.unit), stillNeeded,
      used: res.allocations, skipped: res.skipped, explanation: `${req.displayName}: ${parts.join('; ')}.`,
    });
    if (res.remaining > 0) toBuy.push({ ...req, quantity: stillNeeded });
  }
  return { toBuy, lines };
}

export interface MealUsage { ingredientId: string; displayName?: string; quantity: Quantity }
export interface ConsumptionResult { items: PantryItem[]; lines: DeductionLine[]; shortfalls: MealUsage[] }

/**
 * Deduct ingredients when a planned meal is marked cooked. Same trust rules as deductRequirements;
 * anything not covered by trusted stock is reported as a shortfall (stock never goes negative).
 */
export function consumeCookedMeal(
  items: readonly PantryItem[], usage: readonly MealUsage[], ctx: EngineCtx, opts: AllocateOpts = {},
): ConsumptionResult {
  let cur = [...items];
  const lines: DeductionLine[] = [];
  const shortfalls: MealUsage[] = [];
  for (const u of usage) {
    const name = u.displayName ?? u.ingredientId;
    if (!isExact(u.quantity)) {
      lines.push({
        displayName: name, ingredientId: u.ingredientId, required: u.quantity, deducted: exactQ(0, u.quantity.unit),
        stillNeeded: u.quantity, used: [], skipped: [], explanation: `${name}: not deducted — quantity is ${u.quantity.kind}.`,
      });
      continue;
    }
    const res = allocate(cur, u.ingredientId, u.quantity.value, u.quantity.unit, ctx, opts);
    for (const a of res.allocations) cur = reduceItem(cur, a.itemId, a.tookInStockUnit);
    const stillNeeded = exactQ(res.remaining, u.quantity.unit);
    const usedText = res.allocations.map((a) => `${fmtQ(exactQ(a.took, u.quantity.unit))} from "${a.itemName}"`).join(', ') || 'nothing';
    lines.push({
      displayName: name, ingredientId: u.ingredientId, required: u.quantity,
      deducted: exactQ(u.quantity.value - res.remaining, u.quantity.unit), stillNeeded, used: res.allocations, skipped: res.skipped,
      explanation: `${name}: used ${usedText}${res.remaining > 0 ? `; ${fmtQ(stillNeeded)} not covered by trusted stock` : ''}.`,
    });
    if (res.remaining > 0) shortfalls.push({ ...u, quantity: stillNeeded });
  }
  return { items: cur, lines, shortfalls };
}
