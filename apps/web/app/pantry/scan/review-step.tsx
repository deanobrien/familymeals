'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type Dispatch, type SetStateAction } from 'react';
import { Badge, Button, Card, CardBody, Checkbox, Input, Select } from '@fr/ui';
import { UNIT_OPTIONS, categoryLabel, type IngredientHit } from '../../../lib/pantry/types';
import { postScan } from '../../../lib/pantry/scan-client';
import {
  applyEstimates, confidenceTone, mergeCloseUp, rowName, toCommitRows, withCount, withDate, withQuantity,
  type DateSource, type ScanRow,
} from '../../../lib/pantry/scan-rows';
import type { ScanPreviewLine } from '../../../lib/pantry/scan-types';
import { confirmScanAction, previewScanAction, searchIngredientsAction } from '../../../lib/server/pantry/actions';
import s from './scan.module.css';

const unitOptions = UNIT_OPTIONS.map((u) => ({ value: u, label: u }));
const todayIso = () => new Date().toISOString().slice(0, 10);

interface Props {
  rows: ScanRow[];
  setRows: Dispatch<SetStateAction<ScanRow[]>>;
  warnings: string[];
  imageCount: number;
  onBack: () => void;
  onAdded: (message: string) => void;
}

export function ReviewStep({ rows, setRows, warnings, imageCount, onBack, onAdded }: Props) {
  const [estimate, setEstimate] = useState(false);
  const [preview, setPreview] = useState<Record<string, ScanPreviewLine>>({});
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const commit = useMemo(() => toCommitRows(rows), [rows]);
  const commitKey = JSON.stringify(commit.rows);
  const errorCount = Object.keys(commit.errors).length;

  // "Merge with existing stock" preview: read-only, debounced, computed by the engine on the server (D84).
  useEffect(() => {
    if (commit.rows.length === 0) { setPreview({}); setPreviewError(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      void previewScanAction(commit.rows).then((res) => {
        if (cancelled) return;
        if (res.ok) { setPreview(Object.fromEntries(res.lines.map((l) => [l.key, l]))); setPreviewError(null); }
        else setPreviewError(res.error);
      });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
    // commitKey is the content of commit.rows
  }, [commitKey]);

  const patch = (key: string, next: ScanRow) => setRows((cur) => cur.map((r) => (r.key === key ? next : r)));

  function toggleEstimate(on: boolean) {
    setEstimate(on);
    setRows((cur) => applyEstimates(cur, on, todayIso()));
  }

  async function closeUp(key: string, file: File) {
    const row = rows.find((r) => r.key === key);
    if (!row) return;
    setRows((cur) => cur.map((r) => (r.key === key ? { ...r, closeUp: 'busy' as const, closeUpMessage: 'Reading the close-up...' } : r)));
    const out = await postScan([file], rowName(row));
    setRows((cur) => cur.map((r) => {
      if (r.key !== key) return r;
      return out.ok ? mergeCloseUp(r, out.data.rows[0]) : { ...r, closeUp: 'unread' as const, closeUpMessage: out.error.message };
    }));
  }

  function confirm() {
    setConfirmError(null);
    start(async () => {
      const res = await confirmScanAction(commit.rows);
      if (res.ok) onAdded(res.message ?? 'Added to your pantry');
      else setConfirmError(res.error);
    });
  }

  const included = rows.filter((r) => r.include).length;

  return (
    <div className={s.stack}>
      <div className={s.info} role="note">
        Nothing has been added yet. Check each item, fix anything that is wrong, then confirm. Dates are read best from
        close-up photos.
      </div>
      {warnings.length > 0 && (
        <ul aria-label="Scan warnings" className={s.note} style={{ margin: 0, paddingLeft: '1.25rem' }}>
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      <Card>
        <CardBody>
          <div className={s.stack}>
            <Checkbox
              label="Suggest typical shelf life when no date is shown"
              checked={estimate}
              onChange={(e) => toggleEstimate(e.target.checked)}
              data-testid="estimate-toggle"
            />
            <p className={s.muted}>
              Off by default. When on, items with no date get a labelled estimate you can clear. It is a typical figure for
              that kind of food, not a date from the pack.
            </p>
          </div>
        </CardBody>
      </Card>

      {rows.length === 0 ? (
        <p role="status" data-testid="scan-empty" className={s.info}>
          No food items were found in {imageCount === 1 ? 'that image' : 'those images'}. Try again with a clearer, closer photo.
        </p>
      ) : (
        <ul className={s.rows} aria-label="Scanned items">
          {rows.map((r) => (
            <ScanRowCard
              key={r.key}
              row={r}
              error={commit.errors[r.key]}
              onChange={(next) => patch(r.key, next)}
              onCloseUp={(file) => void closeUp(r.key, file)}
            />
          ))}
        </ul>
      )}

      {commit.rows.length > 0 && (
        <Card>
          <CardBody>
            <div className={s.stack}>
              <h2 style={{ margin: 0, fontSize: 'var(--fr-text-lg)' }}>Changes to your pantry</h2>
              {previewError && <p role="alert" className={s.fieldError}>{previewError}</p>}
              <ul className={s.preview} aria-label="Changes to your pantry" data-testid="merge-preview">
                {commit.rows.map((c) => {
                  const line = preview[c.key];
                  const row = rows.find((r) => r.key === c.key)!;
                  return (
                    <li key={c.key} data-testid="preview-line">
                      <span>
                        <strong>{rowName(row)}</strong>{' '}
                        {!line ? <span className={s.muted}>checking...</span>
                          : line.kind === 'merge'
                            ? <>{line.before} <span className={s.arrow}>to</span> {line.after} <Badge tone="accent">Merged with stock</Badge></>
                            : <>new line: {line.after} <Badge>New</Badge></>}
                      </span>
                      {line?.note && <span className={s.muted}>{line.note}</span>}
                    </li>
                  );
                })}
              </ul>
            </div>
          </CardBody>
        </Card>
      )}

      {confirmError && <p role="alert" className={s.error}>{confirmError}</p>}
      <div className={s.actions}>
        <Button disabled={pending || commit.rows.length === 0 || errorCount > 0} loading={pending} onClick={confirm}>
          {included === 0 ? 'Add to pantry' : `Add ${commit.rows.length} ${commit.rows.length === 1 ? 'item' : 'items'} to pantry`}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={onBack}>Back to photos</Button>
        {errorCount > 0 && <span className={s.fieldError}>Fix the items marked below first.</span>}
      </div>
    </div>
  );
}

const SOURCE_BADGE: Record<DateSource, { tone: 'success' | 'warning' | 'accent' | 'neutral'; label: string } | null> = {
  none: null,
  scan: { tone: 'success', label: 'Read from label' },
  closeup: { tone: 'success', label: 'Read from close-up' },
  user: { tone: 'neutral', label: 'You entered' },
  estimate: { tone: 'warning', label: 'Estimate, not read from the pack' },
};

function ScanRowCard({ row, error, onChange, onCloseUp }: { row: ScanRow; error?: string; onChange: (r: ScanRow) => void; onCloseUp: (f: File) => void }) {
  const conf = confidenceTone(row.confidence);
  const showCloseUp = row.needsCloseUp || row.closeUp !== 'idle';
  const ub = SOURCE_BADGE[row.useBySource];
  const bb = SOURCE_BADGE[row.bestBeforeSource];
  return (
    <li data-testid="scan-row" aria-label={`Scanned item: ${row.scannedName}`} className={row.include ? undefined : s.rowOff}>
      <Card>
        <CardBody>
          <div className={s.rowCard}>
            <div className={s.rowHead}>
              <Checkbox
                label={<strong>{row.scannedName}</strong>}
                aria-label={`Include ${row.scannedName}`}
                checked={row.include}
                onChange={(e) => onChange({ ...row, include: e.target.checked })}
              />
              <div className={s.badges}>
                <Badge tone={conf.tone} data-testid="confidence">{conf.label} ({Math.round(row.confidence * 100)}%)</Badge>
                <span className={s.muted}>seen in {row.frameRefs.length === 1 ? 'image' : 'images'} {row.frameRefs.join(', ')}</span>
              </div>
            </div>
            {row.notes && <p className={s.muted}>{row.notes}</p>}

            <MatchPicker row={row} onChange={onChange} />

            <div className={s.grid}>
              <Input label="Count" inputMode="numeric" value={row.count} onChange={(e) => onChange(withCount(row, e.target.value))}
                hint={row.packSizeText ? `${row.packSizeText} each` : undefined} />
              <Input label="Quantity" inputMode="decimal" value={row.value} onChange={(e) => onChange(withQuantity(row, { value: e.target.value }))} />
              <Select label="Unit" options={unitOptions} value={row.unit} onChange={(e) => onChange(withQuantity(row, { unit: e.target.value }))} />
            </div>

            <div className={s.grid}>
              <div className={s.stack}>
                <Input label="Use by" type="date" value={row.useBy} onChange={(e) => onChange(withDate(row, 'useBy', e.target.value))} />
                {ub && <Badge tone={ub.tone}>{ub.label}</Badge>}
              </div>
              <div className={s.stack}>
                <Input label="Best before" type="date" value={row.bestBefore} onChange={(e) => onChange(withDate(row, 'bestBefore', e.target.value))} />
                {bb && <Badge tone={bb.tone} data-testid={row.bestBeforeSource === 'estimate' ? 'estimate-badge' : undefined}>{bb.label}</Badge>}
              </div>
            </div>

            {showCloseUp && (
              <div className={s.closeUp} data-testid="closeup-block">
                <span role="status">
                  {row.closeUpMessage ?? 'A date label is visible but too small to read.'}
                </span>
                {row.closeUp !== 'done' && (
                  <label className="fr-btn fr-btn--secondary fr-btn--sm" style={{ cursor: 'pointer' }}>
                    Take close-up<span className="fr-visually-hidden"> of {row.scannedName}</span>
                    <input
                      type="file" accept="image/*" capture="environment" data-testid="closeup-input" className="fr-visually-hidden"
                      disabled={row.closeUp === 'busy'}
                      onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onCloseUp(f); }}
                    />
                  </label>
                )}
              </div>
            )}
            {error && <p role="alert" className={s.fieldError}>{error}</p>}
          </div>
        </CardBody>
      </Card>
    </li>
  );
}

function MatchPicker({ row, onChange }: { row: ScanRow; onChange: (r: ScanRow) => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<IngredientHit[]>([]);
  const [changing, setChanging] = useState(false);
  const seq = useRef(0);

  async function search(q: string) {
    setQuery(q);
    const mine = ++seq.current;
    if (!q.trim()) return setHits([]);
    const res = await searchIngredientsAction(q);
    if (mine === seq.current) setHits(res);
  }
  const choose = (i: IngredientHit | null) => { onChange({ ...row, ingredient: i }); setChanging(false); setQuery(''); setHits([]); };

  const searchBox = (
    <>
      <Input label="Find an ingredient" value={query} autoComplete="off" placeholder="Start typing, e.g. carrot" onChange={(e) => void search(e.target.value)} />
      {hits.length > 0 && (
        <ul className={s.matches} aria-label="Ingredient matches">
          {hits.map((h) => (
            <li key={h.id}><button type="button" onClick={() => choose(h)}>{h.name} <span className={s.muted}>({categoryLabel(h.category)})</span></button></li>
          ))}
        </ul>
      )}
    </>
  );

  if (row.ingredient && !changing) {
    return (
      <div className={s.badges}>
        <Badge tone="success" data-testid="match-badge">Matched: {row.ingredient.name}</Badge>
        <span className={s.muted}>{categoryLabel(row.ingredient.category)}</span>
        <Button variant="ghost" size="sm" aria-label={`Change ingredient for ${row.scannedName}`} onClick={() => setChanging(true)}>Change</Button>
        <Button variant="ghost" size="sm" aria-label={`Use my own name for ${row.scannedName}`} onClick={() => choose(null)}>Use my own name</Button>
      </div>
    );
  }

  const ambiguous = row.match.status === 'ambiguous' ? row.match.candidates : [];
  const suggestions = row.match.status === 'unmatched' ? row.match.suggestions : [];
  return (
    <div className={s.stack}>
      {ambiguous.length > 0 && (
        <Select
          label={`Which ingredient is "${row.scannedName}"?`}
          options={[{ value: '', label: 'Keep as typed (no match)' }, ...ambiguous.map((c) => ({ value: c.id, label: c.name }))]}
          value={row.ingredient?.id ?? ''}
          onChange={(e) => choose(ambiguous.find((c) => c.id === e.target.value) ?? null)}
        />
      )}
      <Input label="Name" value={row.freeName} onChange={(e) => onChange({ ...row, freeName: e.target.value })}
        hint={ambiguous.length ? 'Several ingredients could fit: pick one above, or keep your own name.' : 'No exact match in the ingredient list: it will be saved under this name.'} />
      {suggestions.length > 0 && (
        <div className={s.badges}>
          <span className={s.muted}>Did you mean:</span>
          {suggestions.map((c) => <Button key={c.id} variant="secondary" size="sm" onClick={() => choose(c)}>{c.name}</Button>)}
        </div>
      )}
      {searchBox}
    </div>
  );
}
