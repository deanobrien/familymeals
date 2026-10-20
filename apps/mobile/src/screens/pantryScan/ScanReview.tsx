import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, Switch, View } from 'react-native';
import { applyEstimates, mergeCloseUp, rowName, toCommitRows, type ScanCommitRow, type ScanPreviewLine } from '@fr/engine/pantry';
import { prepareForUpload, type CapturedImage, type Resizer } from '@/lib/extraction';
import { isIsoDate, newSubmissionId, type PantryScanClient, type PhoneScanRow } from '@/lib/pantryScanApi';
import type { ServerApi } from '@/lib/serverApi';
import ScanRowCard from './ScanRowCard';
import { Button, ErrorText, MIN_TAP, Muted, Text, useStyles, useTheme } from '../ui';

const todayIso = (): string => new Date().toISOString().slice(0, 10);
const DATE_MSG = 'Enter the date as YYYY-MM-DD, e.g. 2026-10-31.';

type DateErrors = Record<string, { useBy?: string; bestBefore?: string }>;

function dateErrorsOf(rows: readonly PhoneScanRow[]): DateErrors {
  const out: DateErrors = {};
  for (const r of rows) {
    if (!r.include) continue;
    const e: { useBy?: string; bestBefore?: string } = {};
    if (r.useBy.trim() && !isIsoDate(r.useBy.trim())) e.useBy = DATE_MSG;
    if (r.bestBefore.trim() && !isIsoDate(r.bestBefore.trim())) e.bestBefore = DATE_MSG;
    if (e.useBy || e.bestBefore) out[r.key] = e;
  }
  return out;
}

/**
 * The phone's scan review (D343 photos, D344 barcodes), the web ReviewStep's twin: nothing is written until "Add to
 * pantry". Shelf-life estimates are OFF by default (D87). The merge preview is the server's (the same engine run the
 * confirm uses), debounced. Confirm is guarded twice against a double tap: an in-flight lock here, and a per-review
 * `submissionId` the server answers once.
 */
export default function ScanReview({
  api, client, householdId, rows, setRows, warnings, onBack, backLabel, onRetry, onAdded,
  resizer, today = todayIso, previewDebounceMs = 300,
}: {
  api: ServerApi;
  client: PantryScanClient;
  householdId: string;
  rows: PhoneScanRow[];
  setRows: React.Dispatch<React.SetStateAction<PhoneScanRow[]>>;
  warnings: string[];
  onBack: () => void;
  backLabel: string;
  onRetry?: (barcode: string) => void;
  onAdded: (message: string) => void;
  resizer?: Resizer;
  today?: () => string;
  previewDebounceMs?: number;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const [estimate, setEstimate] = useState(false);
  const [preview, setPreview] = useState<Record<string, ScanPreviewLine>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const submissionId = useRef(newSubmissionId());

  const dateErrors = useMemo(() => dateErrorsOf(rows), [rows]);
  const commit = useMemo(() => {
    const c = toCommitRows(rows);
    const errors = { ...c.errors };
    for (const k of Object.keys(dateErrors)) errors[k] ??= 'Fix the date first.';
    const sendable: ScanCommitRow[] = c.rows.filter((r) => !dateErrors[r.key]);
    return { rows: sendable, errors };
  }, [rows, dateErrors]);
  const commitKey = JSON.stringify(commit.rows);
  const errorCount = Object.keys(commit.errors).length;

  useEffect(() => {
    if (commit.rows.length === 0) { setPreview({}); setPreviewError(null); return undefined; }
    let cancelled = false;
    const t = setTimeout(() => {
      client.preview(householdId, commit.rows).then(
        (lines) => { if (!cancelled) { setPreview(Object.fromEntries(lines.map((l) => [l.key, l]))); setPreviewError(null); } },
        (e: unknown) => { if (!cancelled) setPreviewError(e instanceof Error ? e.message : 'Could not check your pantry.'); },
      );
    }, previewDebounceMs);
    return () => { cancelled = true; clearTimeout(t); };
    // commitKey is the content of commit.rows
  }, [commitKey, client, householdId, previewDebounceMs]);

  const patch = (key: string, next: PhoneScanRow) => setRows((cur) => cur.map((r) => (r.key === key ? next : r)));

  function toggleEstimate(on: boolean) {
    setEstimate(on);
    setRows((cur) => applyEstimates(cur, on, today()));
  }

  async function closeUp(key: string, img: CapturedImage) {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, closeUp: 'busy' as const, closeUpMessage: 'Reading the close-up...' } : r)));
    try {
      const prepared = await prepareForUpload([img], resizer, 1);
      const out = await client.scan(householdId, prepared, rowName(row) || row.scannedName);
      setRows((cur) => cur.map((r) => (r.key === key ? mergeCloseUp(r, out.rows[0]) : r)));
    } catch (e) {
      const message = e instanceof Error ? e.message : 'The close-up could not be read.';
      setRows((cur) => cur.map((r) => (r.key === key ? { ...r, closeUp: 'unread' as const, closeUpMessage: message } : r)));
    }
  }

  async function confirm() {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setConfirmError(null);
    try {
      const res = await client.confirm(householdId, commit.rows, submissionId.current);
      onAdded(res.message);
    } catch (e) {
      setConfirmError(e instanceof Error ? e.message : 'Could not add to your pantry. Please try again.');
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const isRapid = rows.some((r) => r.rapid);
  const waiting = rows.filter((r) => r.include && r.lookup === 'pending').length;
  const n = commit.rows.length;

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled" testID="scan-review">
      <Text style={styles.title} accessibilityRole="header">Check and add</Text>
      <View style={styles.banner}>
        <Muted>Nothing has been added yet. Check each item, fix anything that is wrong, then add them. Dates are read best from close-up photos.</Muted>
      </View>
      {isRapid && (
        <View style={styles.banner} testID="rapid-review-note">
          <Muted>
            Products scanned from barcodes have no date on them, so they go into your pantry without an expiry date unless you add one.
            {waiting > 0 ? ` Still looking up ${waiting} ${waiting === 1 ? 'product' : 'products'}: they fill in as the lookups finish.` : ''}
          </Muted>
        </View>
      )}
      {warnings.map((w) => <Muted key={w} testID="scan-warning">{w}</Muted>)}

      <View style={[styles.row, { minHeight: MIN_TAP }]}>
        <Text style={{ flex: 1 }}>Suggest typical shelf life when no date is shown</Text>
        <Switch
          value={estimate}
          onValueChange={toggleEstimate}
          accessibilityRole="switch"
          accessibilityLabel="Suggest typical shelf life when no date is shown"
          accessibilityState={{ checked: estimate }}
          trackColor={{ true: theme.primary, false: theme.border }}
          testID="estimate-toggle"
        />
      </View>
      <Muted>Off by default. When on, items with no date get a labelled estimate you can clear. It is a typical figure for that kind of food, not a date from the pack.</Muted>

      {rows.length === 0 ? (
        <Muted testID="scan-empty" accessibilityLiveRegion="polite">No food items were found. Try again with a clearer, closer photo, or scan the barcodes.</Muted>
      ) : (
        rows.map((r) => (
          <ScanRowCard
            key={r.key}
            row={r}
            api={api}
            householdId={householdId}
            error={dateErrors[r.key] ? undefined : commit.errors[r.key]}
            dateErrors={dateErrors[r.key] ?? {}}
            onChange={(next) => patch(r.key, next)}
            onCloseUp={(img) => void closeUp(r.key, img)}
            onRetry={onRetry}
          />
        ))
      )}

      {n > 0 && (
        <View testID="merge-preview">
          <Text style={styles.heading} accessibilityRole="header">Changes to your pantry</Text>
          <ErrorText message={previewError} />
          {commit.rows.map((c) => {
            const line = preview[c.key];
            const row = rows.find((r) => r.key === c.key);
            const name = row ? rowName(row) : c.key;
            return (
              <Text key={c.key} testID="preview-line">
                {!line
                  ? `${name}: checking...`
                  : line.kind === 'merge'
                    ? `${name}: ${line.before ?? ''} to ${line.after} (merged with stock)`
                    : `${name}: new line, ${line.after}`}
                {line?.note ? `. ${line.note}` : ''}
              </Text>
            );
          })}
        </View>
      )}

      <ErrorText message={confirmError} />
      {errorCount > 0 && (
        <Muted testID="review-blocked" style={{ color: theme.danger }}>
          {waiting > 0 && waiting === errorCount ? 'Waiting for the product lookups, or name those items yourself.' : 'Fix the items marked above first.'}
        </Muted>
      )}
      <Button
        title={busy ? 'Adding...' : n === 0 ? 'Add to pantry' : `Add ${n} ${n === 1 ? 'item' : 'items'} to pantry`}
        testID="scan-confirm"
        disabled={busy || n === 0 || errorCount > 0}
        onPress={() => void confirm()}
      />
      <Button title={backLabel} variant="secondary" testID="scan-back" disabled={busy} onPress={onBack} />
    </ScrollView>
  );
}
