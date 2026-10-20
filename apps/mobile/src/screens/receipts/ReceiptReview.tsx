import React, { useMemo, useState } from 'react';
import { Pressable, Text as RNText, TextInput, View } from 'react-native';
import { formatPence, type ConfirmSummary, type ReviewLine, type ReviewModel } from '@/lib/receiptsApi';
import { Button, ErrorText, Muted, Text, MIN_TAP, useStyles, useTheme } from '../ui';
import { EXTRA, buildDecisions, hasBadQuantity, initialState, type LineState } from './reviewState';
import type { LineDecision } from '@/lib/receiptsApi';

const CLASS_LABEL: Record<ReviewLine['classification'], string> = {
  confident: 'Suggested match',
  uncertain: 'Uncertain match',
  none: 'No match found',
};

function Check({ label, checked, onChange, testID }: { label: string; checked: boolean; onChange: (v: boolean) => void; testID: string }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      testID={testID}
      onPress={() => onChange(!checked)}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: MIN_TAP, gap: 10 }}
    >
      <View style={{ width: 28, height: 28, borderRadius: 6, borderWidth: 2, borderColor: t.primary, alignItems: 'center', justifyContent: 'center', backgroundColor: checked ? t.primary : 'transparent' }}>
        {checked ? <RNText style={{ color: t.primaryText, fontWeight: '700' }}>✓</RNText> : null}
      </View>
      <Text style={{ flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

function Choice({ label, detail, selected, onPress, testID }: { label: string; detail?: string; selected: boolean; onPress: () => void; testID: string }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityState={{ selected }}
      testID={testID}
      onPress={onPress}
      style={{ minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: selected ? t.primary : t.border, marginVertical: 3 }}
    >
      <Text style={{ fontWeight: selected ? '700' : '400' }}>{selected ? '● ' : '○ '}{label}</Text>
      {detail ? <Muted>{detail}</Muted> : null}
    </Pressable>
  );
}

function TotalCheck({ model }: { model: ReviewModel }) {
  const styles = useStyles();
  const d = model.discrepancyPence;
  const warn = d === undefined || d !== 0 || model.linesMissingPrice > 0;
  if (!warn) {
    return (
      <View style={styles.banner} testID="total-ok" accessibilityRole="summary">
        <Text>Total checks out: the lines add up to {formatPence(model.computedPence)}.</Text>
      </View>
    );
  }
  return (
    <View style={[styles.banner, { borderColor: '#b00020' }]} testID="total-warning" accessibilityRole="alert">
      <Text style={{ fontWeight: '700' }}>Check this receipt</Text>
      {d === undefined ? (
        <Text>No receipt total could be read, so the lines cannot be checked. The lines add up to {formatPence(model.computedPence)}.</Text>
      ) : (
        <Text>
          Printed total {formatPence(model.totalPence ?? 0)} does not match the lines, which add up to {formatPence(model.computedPence)} (
          {d > 0 ? 'receipt is' : 'lines are'} {formatPence(Math.abs(d))} higher). A line may be missing or misread.
        </Text>
      )}
      {model.linesMissingPrice > 0 ? <Text>{model.linesMissingPrice} line(s) have no price.</Text> : null}
    </View>
  );
}

function LineCard({ line, model, s, patch }: { line: ReviewLine; model: ReviewModel; s: LineState; patch: (p: Partial<LineState>) => void }) {
  const styles = useStyles();
  const [showOthers, setShowOthers] = useState(false);
  const candidateIds = new Set(line.candidates.map((c) => c.itemId));
  const others = model.items.filter((i) => !candidateIds.has(i.shoppingListItemId));
  const isItem = s.selection !== '' && s.selection !== EXTRA;
  const chosenName = isItem ? (model.items.find((i) => i.shoppingListItemId === s.selection)?.name ?? line.candidates.find((c) => c.itemId === s.selection)?.name) : undefined;
  const id = line.lineId;
  return (
    <View style={[styles.banner, { marginBottom: 12 }]} testID={`line-${id}`} accessible={false}>
      <Text style={{ fontWeight: '700' }}>{line.raw}</Text>
      <Muted testID={`class-${id}`}>{CLASS_LABEL[line.classification]}</Muted>
      <Text>
        {line.count > 1 ? `${line.count} × ` : ''}
        {line.packLabel ? `${line.packLabel} · ` : ''}
        {line.netPence !== undefined ? formatPence(line.netPence) : 'no price'}
      </Text>
      {line.discountPence > 0 ? (
        <Muted testID={`discount-${id}`}>
          Discount −{formatPence(line.discountPence)} applied ({line.discountLines.join('; ')}); was {formatPence(line.pricePence ?? 0)}
        </Muted>
      ) : null}

      <Text style={{ marginTop: 8, fontWeight: '600' }}>
        {s.selection === EXTRA ? 'Not on my list (extra)' : isItem ? `Matched to: ${chosenName ?? 'list item'}` : 'No list item chosen (this line is skipped)'}
      </Text>
      {line.preselectedItemId && s.selection === line.preselectedItemId && !s.confirmed ? (
        <Muted testID={`suggested-${id}`}>Suggested, not confirmed yet. Tick Confirm to accept it.</Muted>
      ) : null}

      {line.candidates.map((c) => (
        <Choice
          key={c.itemId}
          label={c.name}
          detail={`${Math.round(c.score * 100)}% match${c.reasons.length ? `: ${c.reasons.slice(0, 2).join('; ')}` : ''}`}
          selected={s.selection === c.itemId}
          onPress={() => patch({ selection: c.itemId, confirmed: false })}
          testID={`cand-${id}-${c.itemId}`}
        />
      ))}
      {others.length > 0 ? (
        <Button
          title={showOthers ? 'Hide other list items' : 'Pick another list item'}
          variant="secondary"
          onPress={() => setShowOthers((v) => !v)}
          testID={`other-toggle-${id}`}
        />
      ) : null}
      {showOthers
        ? others.map((i) => (
            <Choice
              key={i.shoppingListItemId}
              label={i.name}
              selected={s.selection === i.shoppingListItemId}
              onPress={() => patch({ selection: i.shoppingListItemId, confirmed: false })}
              testID={`other-${id}-${i.shoppingListItemId}`}
            />
          ))
        : null}
      <Choice label="Not on my list (extra)" selected={s.selection === EXTRA} onPress={() => patch({ selection: EXTRA, confirmed: false })} testID={`extra-${id}`} />
      <Choice label="Skip this line" selected={s.selection === ''} onPress={() => patch({ selection: '', confirmed: false })} testID={`skip-${id}`} />

      {isItem ? (
        <View style={{ marginTop: 8 }}>
          <Text>Quantity bought ({line.defaultQuantity.unit})</Text>
          <TextInput
            value={s.qty}
            onChangeText={(qty) => patch({ qty, confirmed: false })}
            keyboardType="decimal-pad"
            accessibilityLabel={`Quantity bought for ${line.raw}`}
            testID={`qty-${id}`}
            style={styles.input}
          />
          <Check label={`Confirm ${line.raw} as bought`} checked={s.confirmed} onChange={(confirmed) => patch({ confirmed })} testID={`confirm-${id}`} />
        </View>
      ) : null}
      {s.selection === EXTRA ? (
        <Check label={`Also add ${line.description || line.raw} to my pantry`} checked={s.addToPantry} onChange={(addToPantry) => patch({ addToPantry })} testID={`pantry-${id}`} />
      ) : null}
    </View>
  );
}

/** The review form: nothing is bought until the user ticks Confirm on a line; Confirm sends only those lines. */
export default function ReceiptReview({
  model,
  onConfirm,
}: {
  model: ReviewModel;
  /** Resolves to the summary, or throws an Error whose message is shown. */
  onConfirm: (decisions: LineDecision[]) => Promise<ConfirmSummary>;
}) {
  const [state, setState] = useState(() => initialState(model));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const decisions = useMemo(() => buildDecisions(model, state), [model, state]);
  const purchases = decisions.filter((d) => d.outcome === 'purchase').length;
  const pantryAdds = decisions.filter((d) => d.outcome === 'extra' && d.addToPantry).length;
  const badQty = hasBadQuantity(model, state);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(decisions);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'We could not save that. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <TotalCheck model={model} />
      {model.warnings.map((w) => (
        <Muted key={w} style={{ marginBottom: 4 }}>{w}</Muted>
      ))}
      <Text style={{ marginVertical: 8 }}>Nothing is marked as bought until you tick Confirm on a line. Items you do not confirm stay on your shopping list.</Text>
      {model.lines.length === 0 ? <Muted testID="no-lines">No product lines were read from this receipt.</Muted> : null}
      {model.lines.map((l) => (
        <LineCard key={l.lineId} line={l} model={model} s={state[l.lineId]!} patch={(p) => setState((st) => ({ ...st, [l.lineId]: { ...st[l.lineId]!, ...p } }))} />
      ))}
      {model.ignored.length > 0 ? (
        <View testID="ignored" style={{ marginBottom: 12 }}>
          <Text style={{ fontWeight: '600' }}>{model.ignored.length} line(s) not recognised as products</Text>
          {model.ignored.map((x, i) => (
            <Muted key={`${x}-${i}`}>{x}</Muted>
          ))}
        </View>
      ) : null}
      <ErrorText message={error} />
      <Text testID="confirm-summary" accessibilityRole="summary">
        {purchases} {purchases === 1 ? 'purchase' : 'purchases'} will be recorded{pantryAdds > 0 ? `, ${pantryAdds} added to pantry` : ''}.
      </Text>
      <Button
        title={busy ? 'Saving...' : purchases > 0 ? `Confirm ${purchases} ${purchases === 1 ? 'purchase' : 'purchases'}` : 'Save receipt'}
        onPress={() => void submit()}
        disabled={busy || badQty || decisions.length === 0}
        testID="submit-confirm"
      />
    </View>
  );
}
