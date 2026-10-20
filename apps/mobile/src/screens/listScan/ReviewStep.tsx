import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import {
  LIST_UNITS, confirmScan, defaultListName, previewScan, toCommitRows,
  type ConfirmOutcome, type Destination, type ScanPreview, type ScanRow,
} from '@/lib/listScanApi';
import type { ServerApi } from '@/lib/serverApi';
import { Button, ErrorText, MIN_TAP, Muted, Text, useStyles, useTheme } from '../ui';

const KIND_LABEL: Record<string, string> = {
  new: 'New item',
  merge: 'Combined with an item on the list',
  exists: 'Already on the list',
  skip: 'Left as it was',
};

const confidenceLabel = (c: number): string | null => (c >= 0.85 ? null : c >= 0.6 ? 'Check this one' : 'Unsure');
const unitLabel = (u: string): string => (u === 'item' ? 'whole' : u);

/**
 * Review of a scanned handwritten list: what was written next to what was understood (name, amount, aisle, match),
 * edit / remove / add rows, choose the destination, preview what confirming would do, then confirm. The batch id is
 * generated once per review session by the caller and reused by every preview / confirm retry, so a double tap or a
 * retry after a lost response adds nothing twice (D266).
 */
export default function ReviewStep({
  api, householdId, rows, setRows, warnings, title, batchId, onBack, onDone,
}: {
  api: ServerApi;
  householdId: string;
  rows: ScanRow[];
  setRows: React.Dispatch<React.SetStateAction<ScanRow[]>>;
  warnings: string[];
  title?: string | undefined;
  batchId: string;
  onBack: () => void;
  onDone: (outcome: ConfirmOutcome) => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const [kind, setKind] = useState<'current' | 'new'>('current');
  const [newName, setNewName] = useState(() => title?.trim() || defaultListName());
  const [preview, setPreview] = useState<ScanPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const added = useRef(0);

  const commit = useMemo(() => toCommitRows(rows), [rows]);
  const destination: Destination = kind === 'current' ? { kind: 'current' } : { kind: 'new', name: newName.trim() || defaultListName() };
  const stale = JSON.stringify([commit.rows, destination]);
  const errorCount = Object.keys(commit.errors).length;

  // Any edit invalidates the preview: it must describe exactly what confirm would send.
  useEffect(() => {
    setPreview(null);
  }, [stale]);

  const patch = (key: string, p: Partial<ScanRow>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const canSend = commit.rows.length > 0 && errorCount === 0;

  async function doPreview() {
    if (inFlight.current || !canSend) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      setPreview(await previewScan(api, householdId, commit.rows, destination, batchId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not preview. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function doConfirm() {
    if (inFlight.current || !canSend) return; // a double tap sends one request
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      onDone(await confirmScan(api, householdId, commit.rows, destination, batchId));
    } catch (e) {
      // The same batch id is reused on retry: if the first attempt did land, nothing is added twice.
      setError(e instanceof Error ? e.message : 'Could not add the items. Please try again.');
      inFlight.current = false;
      setBusy(false);
    }
  }

  function cycleUnit(r: ScanRow) {
    const i = LIST_UNITS.indexOf(r.unit as (typeof LIST_UNITS)[number]);
    patch(r.key, { unit: LIST_UNITS[(i + 1) % LIST_UNITS.length] as string });
  }

  const input = { minHeight: MIN_TAP, borderWidth: 1, borderColor: theme.border, borderRadius: 8, paddingHorizontal: 12, color: theme.text } as const;
  const includedCount = rows.filter((r) => r.include).length;

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled" testID="list-review">
      <Text accessibilityRole="header" style={styles.title}>Check your list</Text>
      <Muted>What was written is shown first, then what we understood. Fix anything that looks wrong. Nothing is added until you confirm.</Muted>
      {warnings.map((w, i) => <Text key={i} style={styles.pending}>{w}</Text>)}
      <ErrorText message={error} />

      {rows.length === 0 ? <Muted testID="list-empty">No items were found on the photos. Add the items yourself, or go back and try a clearer photo.</Muted> : null}

      {rows.map((r) => {
        const conf = confidenceLabel(r.confidence);
        return (
          <View key={r.key} style={[styles.banner, { opacity: r.include ? 1 : 0.6 }]} testID={`row-${r.key}`}>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: r.include }}
              accessibilityLabel={`Add ${r.name.trim() || 'this item'} to the list`}
              testID={`row-include-${r.key}`}
              onPress={() => patch(r.key, { include: !r.include })}
              style={{ minHeight: MIN_TAP, justifyContent: 'center' }}
            >
              <Text>{r.include ? '[x] ' : '[ ] '}{r.originalText ? `Written: ${r.originalText}` : 'Added by you'}</Text>
            </Pressable>
            {r.crossedOut ? <Muted>Crossed out on the paper: left out by default.</Muted> : null}
            {r.illegible ? <Muted>Could not be read: type what it says, or leave it out.</Muted> : null}
            {conf ? <Text style={styles.pending}>{conf}</Text> : null}
            <TextInput
              accessibilityLabel={`Item name, line ${r.originalText || 'added'}`}
              testID={`row-name-${r.key}`}
              value={r.name}
              placeholder="Item name"
              placeholderTextColor={theme.muted}
              onChangeText={(name) => patch(r.key, { name, include: r.include || (name.trim().length > 0 && !r.crossedOut) })}
              style={input}
            />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <TextInput
                accessibilityLabel={`Quantity for ${r.name.trim() || 'item'}`}
                testID={`row-qty-${r.key}`}
                value={r.value}
                keyboardType="decimal-pad"
                placeholder="Amount"
                placeholderTextColor={theme.muted}
                onChangeText={(value) => patch(r.key, { value })}
                style={[input, { flex: 1 }]}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Unit for ${r.name.trim() || 'item'}, now ${unitLabel(r.unit)}. Double tap for the next unit`}
                testID={`row-unit-${r.key}`}
                onPress={() => cycleUnit(r)}
                style={[input, { minWidth: 88, justifyContent: 'center', alignItems: 'center' }]}
              >
                <Text>{unitLabel(r.unit)}</Text>
              </Pressable>
            </View>
            {r.hint ? <Muted>{r.hint}</Muted> : null}
            <Muted testID={`row-match-${r.key}`}>
              {r.ingredientId && r.ingredientName && r.ingredientName.toLowerCase() === r.name.trim().toLowerCase()
                ? `Matched: ${r.ingredientName}`
                : 'Not matched to an ingredient: kept as you typed it'}
              {r.aisle ? ` - ${r.aisle}` : ''}
            </Muted>
            <ErrorText message={commit.errors[r.key]} />
            <Button
              title="Remove"
              variant="secondary"
              accessibilityLabel={`Remove ${r.name.trim() || 'this item'}`}
              testID={`row-remove-${r.key}`}
              onPress={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}
            />
          </View>
        );
      })}

      <Button
        title="Add another item"
        variant="secondary"
        testID="row-add"
        onPress={() =>
          setRows((rs) => [
            ...rs,
            { key: `added-${++added.current}`, originalText: '', name: '', value: '', unit: 'item', notes: '', aisle: 'Other', crossedOut: false, illegible: false, confidence: 1, imageRef: 1, include: true },
          ])
        }
      />

      <Text accessibilityRole="header" style={styles.heading}>Where should they go?</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Destination" style={{ gap: 8 }}>
        {(['current', 'new'] as const).map((k) => (
          <Pressable
            key={k}
            accessibilityRole="radio"
            accessibilityState={{ selected: kind === k }}
            accessibilityLabel={k === 'current' ? 'Add to my current list' : 'Start a new list'}
            testID={`dest-${k}`}
            onPress={() => setKind(k)}
            style={{ minHeight: MIN_TAP, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 24, borderWidth: 2, borderColor: kind === k ? theme.primary : theme.border }}
          >
            <Text style={{ fontWeight: kind === k ? '700' : '400' }}>{k === 'current' ? 'Add to my current list' : 'Start a new list'}</Text>
          </Pressable>
        ))}
      </View>
      {kind === 'new' ? (
        <TextInput
          accessibilityLabel="New list name"
          testID="dest-new-name"
          value={newName}
          maxLength={120}
          onChangeText={setNewName}
          style={[input, { marginTop: 8 }]}
        />
      ) : null}

      {preview ? (
        <View testID="list-preview" style={{ marginTop: 12 }}>
          <Text accessibilityRole="header" style={styles.heading}>
            {preview.destination.kind === 'new' ? `New list: ${preview.destination.name}` : 'Your current list'}
          </Text>
          <Muted testID="list-preview-summary">{preview.added} new, {preview.merged} combined, {preview.skipped} left as they were</Muted>
          {preview.lines.map((l) => (
            <View key={l.key} style={styles.row} testID={`preview-${l.key}`}>
              <View style={{ flex: 1 }}>
                <Text>{l.name}</Text>
                <Muted>{KIND_LABEL[l.kind]}{l.before ? `: ${l.before} -> ${l.after}` : l.after ? `: ${l.after}` : ''}{l.note ? ` (${l.note})` : ''}</Muted>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      <View style={{ gap: 8, marginTop: 16 }}>
        <Button title="Preview" variant="secondary" testID="list-preview-button" disabled={busy || !canSend} onPress={() => void doPreview()} />
        <Button
          title={`Add ${commit.rows.length} item${commit.rows.length === 1 ? '' : 's'}`}
          testID="list-confirm"
          disabled={busy || !canSend}
          {...(includedCount === 0 ? { accessibilityHint: 'Choose at least one item first' } : {})}
          onPress={() => void doConfirm()}
        />
        <Button title="Back to photos" variant="secondary" testID="list-back" disabled={busy} onPress={onBack} />
      </View>
    </ScrollView>
  );
}
