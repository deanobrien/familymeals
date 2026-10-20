import type { LineDecision, ReviewModel } from '@/lib/receiptsApi';

export const EXTRA = '__extra';

export interface LineState {
  /** '' = nothing chosen (line skipped), EXTRA = not on my list, otherwise a shopping list item id. */
  selection: string;
  /** The user ticked "Confirm". A pre-selected confident match is NEVER confirmed until this is true. */
  confirmed: boolean;
  qty: string;
  addToPantry: boolean;
}

export type ReviewState = Record<string, LineState>;

export function initialState(model: ReviewModel): ReviewState {
  return Object.fromEntries(
    model.lines.map((l) => [l.lineId, { selection: l.preselectedItemId ?? '', confirmed: false, qty: String(l.defaultQuantity.value), addToPantry: false }]),
  );
}

export const qtyValue = (s: LineState): number | undefined => {
  const q = Number(s.qty.replace(',', '.'));
  return Number.isFinite(q) && q > 0 ? q : undefined;
};

/** Only what the user explicitly decided: an extra, or an item match whose Confirm box is ticked. Mirrors the web form. */
export function buildDecisions(model: ReviewModel, state: ReviewState): LineDecision[] {
  const out: LineDecision[] = [];
  for (const l of model.lines) {
    const s = state[l.lineId];
    if (!s) continue;
    if (s.selection === EXTRA) out.push({ lineId: l.lineId, outcome: 'extra', addToPantry: s.addToPantry });
    else if (s.selection && s.confirmed) {
      const q = qtyValue(s);
      out.push({ lineId: l.lineId, outcome: 'purchase', shoppingListItemId: s.selection, ...(q !== undefined ? { quantityValue: q } : {}) });
    }
  }
  return out;
}

/** A confirmed item line whose quantity is not a positive number blocks Confirm. */
export function hasBadQuantity(model: ReviewModel, state: ReviewState): boolean {
  return model.lines.some((l) => {
    const s = state[l.lineId];
    return !!s && !!s.selection && s.selection !== EXTRA && s.confirmed && qtyValue(s) === undefined;
  });
}
