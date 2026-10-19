// Scan -> pantry ledger, pure (DECISIONS D84-D85). Uses the engine's addStock so a scan merges exactly like a manual add:
// into a confident, same-expiry, convertible line, otherwise as a new line. The same function drives the
// "merge with existing stock" preview and the confirm, so the preview can never disagree with what is written.
import { addStock, exactQ, fmtQ, type EngineCtx, type PantryItem, type Uuid } from './engine';
import type { ScanPreviewLine } from './scan-types';

export interface ScanAddition {
  key: string;
  /** Resolved display name (canonical name or the free-text name). */
  name: string;
  ingredientId?: string;
  value: number;
  unit: string;
  expiry?: string;
}

export interface ScanPlan {
  items: PantryItem[];
  lines: ScanPreviewLine[];
}

export function planScanAdditions(items: readonly PantryItem[], additions: readonly ScanAddition[], householdId: Uuid, ctx: EngineCtx): ScanPlan {
  let cur: PantryItem[] = [...items];
  const lines: ScanPreviewLine[] = [];
  for (const a of additions) {
    const quantity = exactQ(a.value, a.unit as never);
    const next = addStock(cur, {
      householdId, name: a.name, quantity, source: 'manual',
      ...(a.ingredientId ? { ingredientId: a.ingredientId } : {}),
      ...(a.expiry ? { expiry: a.expiry } : {}),
    }, ctx);
    if (next.length === cur.length) {
      // Merged into an existing line: find the one that changed.
      const idx = next.findIndex((it, i) => it !== cur[i]);
      const was = cur[idx];
      const now = next[idx];
      lines.push({
        key: a.key, name: a.name, kind: 'merge',
        before: was ? fmtQ(was.quantity) : '', after: now ? fmtQ(now.quantity) : fmtQ(quantity),
        ...(was && items.indexOf(was) < 0 ? { note: 'Added to the line from this scan' } : {}),
      });
    } else {
      const sameIngredient = a.ingredientId ? cur.filter((it) => it.ingredientId === a.ingredientId) : [];
      lines.push({
        key: a.key, name: a.name, kind: 'new', after: fmtQ(quantity),
        ...(sameIngredient.length
          ? { note: `Kept as a separate line: you already have ${sameIngredient.map((it) => fmtQ(it.quantity)).join(' + ')} with a different date or older stock` }
          : {}),
      });
    }
    cur = next;
  }
  return { items: cur, lines };
}
