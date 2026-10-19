'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, CardBody, Checkbox } from '@fr/ui';
import { formatPence } from '../../../../lib/receipts/format';
import type { LineDecision, ReviewLine, ReviewModel } from '../../../../lib/receipts/types';
import { confirmReceiptAction } from '../../actions';

const EXTRA = '__extra';

interface LineState {
  /** '' = nothing chosen, EXTRA = not on my list, otherwise a shopping list item id. */
  selection: string;
  confirmed: boolean;
  qty: string;
  addToPantry: boolean;
}

const CLASS_LABEL: Record<ReviewLine['classification'], { text: string; tone: 'success' | 'warning' | 'neutral' }> = {
  confident: { text: 'Suggested match', tone: 'success' },
  uncertain: { text: 'Uncertain match', tone: 'warning' },
  none: { text: 'No match found', tone: 'neutral' },
};

export function ReviewForm({ model }: { model: ReviewModel }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | undefined>();
  // Confident matches are pre-selected but NOT confirmed: the user must tick "Confirm" on every line.
  const [state, setState] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(
      model.lines.map((l) => [
        l.lineId,
        { selection: l.preselectedItemId ?? '', confirmed: false, qty: String(l.defaultQuantity.value), addToPantry: false },
      ]),
    ),
  );

  const patch = (id: string, p: Partial<LineState>) => setState((s) => ({ ...s, [id]: { ...s[id]!, ...p } }));

  const decisions = useMemo<LineDecision[]>(() => {
    const out: LineDecision[] = [];
    for (const l of model.lines) {
      const s = state[l.lineId]!;
      if (s.selection === EXTRA) {
        out.push({ lineId: l.lineId, outcome: 'extra', addToPantry: s.addToPantry });
      } else if (s.selection && s.confirmed) {
        const q = Number(s.qty);
        out.push({
          lineId: l.lineId,
          outcome: 'purchase',
          shoppingListItemId: s.selection,
          quantityValue: Number.isFinite(q) && q > 0 ? q : undefined,
        });
      }
    }
    return out;
  }, [model.lines, state]);

  const purchases = decisions.filter((d) => d.outcome === 'purchase').length;
  const pantryAdds = decisions.filter((d) => d.outcome === 'extra' && d.addToPantry).length;
  const badQty = model.lines.some((l) => {
    const s = state[l.lineId]!;
    const q = Number(s.qty);
    return s.selection && s.selection !== EXTRA && s.confirmed && !(Number.isFinite(q) && q > 0);
  });

  function submit() {
    setError(undefined);
    startTransition(async () => {
      const r = await confirmReceiptAction(model.receiptId, decisions);
      if (!r.ok) setError(r.error);
      else router.refresh();
    });
  }

  const d = model.discrepancyPence;
  const showBanner = d === undefined || d !== 0 || model.linesMissingPrice > 0;

  return (
    <div>
      {showBanner && (
        <div role="alert" data-testid="total-discrepancy" className="fr-field__error" style={{ padding: 12, border: '1px solid currentColor', borderRadius: 8, marginBottom: 16 }}>
          {d === undefined ? (
            <>No receipt total could be read, so the lines cannot be checked. Lines add up to {formatPence(model.computedPence)}.</>
          ) : (
            <>
              Receipt total {formatPence(model.totalPence ?? 0)} does not match the lines, which add up to{' '}
              {formatPence(model.computedPence)} ({d > 0 ? 'receipt is' : 'lines are'} {formatPence(Math.abs(d))} higher). A
              line may be missing or misread.
            </>
          )}
          {model.linesMissingPrice > 0 && <> {model.linesMissingPrice} line(s) have no price.</>}
        </div>
      )}
      {!showBanner && (
        <p role="status" data-testid="total-ok">
          <Badge tone="success">Total checks out</Badge> Lines add up to {formatPence(model.computedPence)}.
        </p>
      )}
      {model.warnings.map((w) => (
        <p key={w} role="note">{w}</p>
      ))}

      <p>Nothing is marked as bought until you tick <strong>Confirm</strong> on a line. Items you do not confirm stay on your shopping list.</p>

      <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 12 }} aria-label="Receipt lines">
        {model.lines.map((l) => {
          const s = state[l.lineId]!;
          const cls = CLASS_LABEL[l.classification];
          const candidateIds = new Set(l.candidates.map((c) => c.itemId));
          const others = model.items.filter((i) => !candidateIds.has(i.shoppingListItemId));
          const isItem = s.selection !== '' && s.selection !== EXTRA;
          const selectedCandidate = l.candidates.find((c) => c.itemId === s.selection);
          return (
            <li key={l.lineId} data-testid="receipt-line" data-classification={l.classification}>
              <Card>
                <CardBody>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' }}>
                    <div>
                      <strong>{l.raw}</strong>{' '}
                      <Badge tone={cls.tone}>{cls.text}</Badge>
                      <div>
                        {l.count > 1 ? `${l.count} × ` : ''}
                        {l.packLabel ? `${l.packLabel} · ` : ''}
                        {l.netPence !== undefined ? formatPence(l.netPence) : 'no price'}
                      </div>
                      {l.discountPence > 0 && (
                        <div data-testid="line-discount">
                          Discount −{formatPence(l.discountPence)} applied ({l.discountLines.join('; ')}); was{' '}
                          {formatPence(l.pricePence ?? 0)}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="fr-field" style={{ marginTop: 8 }}>
                    <label className="fr-field__label" htmlFor={`sel-${l.lineId}`}>Match for {l.raw}</label>
                    <select
                      id={`sel-${l.lineId}`}
                      className="fr-control"
                      value={s.selection}
                      onChange={(e) => patch(l.lineId, { selection: e.target.value, confirmed: false })}
                    >
                      <option value="">Choose a list item…</option>
                      {l.candidates.length > 0 && (
                        <optgroup label="Possible matches">
                          {l.candidates.map((c) => (
                            <option key={c.itemId} value={c.itemId}>{c.name} ({Math.round(c.score * 100)}%)</option>
                          ))}
                        </optgroup>
                      )}
                      {others.length > 0 && (
                        <optgroup label="Other items on your list">
                          {others.map((i) => (
                            <option key={i.shoppingListItemId} value={i.shoppingListItemId}>{i.name}</option>
                          ))}
                        </optgroup>
                      )}
                      <option value={EXTRA}>Not on my list (extra)</option>
                    </select>
                    {selectedCandidate && selectedCandidate.reasons.length > 0 && (
                      <span className="fr-field__hint">{selectedCandidate.reasons.slice(0, 2).join('; ')}</span>
                    )}
                  </div>

                  {isItem && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'end' }}>
                      <div className="fr-field">
                        <label className="fr-field__label" htmlFor={`qty-${l.lineId}`}>Quantity bought ({l.defaultQuantity.unit})</label>
                        <input
                          id={`qty-${l.lineId}`}
                          className="fr-control"
                          type="number"
                          min="0"
                          step="any"
                          inputMode="decimal"
                          value={s.qty}
                          onChange={(e) => patch(l.lineId, { qty: e.target.value, confirmed: false })}
                          style={{ width: 120 }}
                        />
                      </div>
                      <Checkbox
                        label={`Confirm ${l.raw} as bought`}
                        checked={s.confirmed}
                        onChange={(e) => patch(l.lineId, { confirmed: e.target.checked })}
                      />
                    </div>
                  )}
                  {s.selection === EXTRA && (
                    <Checkbox
                      label={`Add ${l.description || l.raw} to pantry`}
                      checked={s.addToPantry}
                      onChange={(e) => patch(l.lineId, { addToPantry: e.target.checked })}
                    />
                  )}
                </CardBody>
              </Card>
            </li>
          );
        })}
      </ul>

      {model.ignored.length > 0 && (
        <details style={{ marginTop: 12 }}>
          <summary>{model.ignored.length} line(s) not recognised as products</summary>
          <ul>{model.ignored.map((x, i) => <li key={`${x}-${i}`}>{x}</li>)}</ul>
        </details>
      )}

      <div style={{ marginTop: 24 }}>
        {error && <p role="alert" className="fr-field__error">{error}</p>}
        <p data-testid="confirm-summary" role="status">
          {purchases} {purchases === 1 ? 'purchase' : 'purchases'} will be recorded
          {pantryAdds > 0 ? `, ${pantryAdds} added to pantry` : ''}.
        </p>
        <Button
          loading={pending}
          disabled={pending || badQty || (purchases === 0 && pantryAdds === 0)}
          onClick={submit}
        >
          {purchases > 0 ? `Confirm ${purchases} ${purchases === 1 ? 'purchase' : 'purchases'}` : 'Save receipt'}
        </Button>
      </div>
    </div>
  );
}
