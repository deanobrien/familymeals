'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type Dispatch, type SetStateAction } from 'react';
import { Badge, Button, Card, CardBody, Checkbox, Input, Select } from '@fr/ui';
import { ALL_UNITS, UNIT_LABELS, type Unit } from '../../../lib/shopping/engine';
import { confidenceTone, toCommitRows, withIngredient, type ListRow } from '../../../lib/shopping/list-scan-rows';
import type { ListDestination, ListScanPreview, ListScanPreviewLine } from '../../../lib/shopping/list-scan-types';
import { AISLES } from '../../../lib/shopping/types';
import { categoryLabel, type IngredientHit } from '../../../lib/pantry/types';
import { searchIngredientsAction } from '../../../lib/server/pantry/actions';
import { confirmShoppingScanAction, previewShoppingScanAction } from './actions';
import s from './scan.module.css';

const unitOptions = ALL_UNITS.map((u) => ({ value: u, label: UNIT_LABELS[u] || 'whole item(s)' }));
const aisleOptions = AISLES.map((a) => ({ value: a, label: a }));

export function defaultListName(now = new Date()): string {
  return `Shopping list - ${now.getDate()} ${now.toLocaleString('en-GB', { month: 'short' })}`;
}

interface Props {
  rows: ListRow[];
  setRows: Dispatch<SetStateAction<ListRow[]>>;
  warnings: string[];
  /** A heading read from the paper list; offered as a name for a new list, never applied silently. */
  title?: string;
  /** The household's current list. */
  current: { name: string; itemCount: number };
  imageCount: number;
  batchId: string;
  onBack: () => void;
  onDone: (message: string) => void;
}

export function ReviewStep({ rows, setRows, warnings, title, current, imageCount, batchId, onBack, onDone }: Props) {
  const [kind, setKind] = useState<'current' | 'new'>('current');
  const [newName, setNewName] = useState(() => defaultListName());
  const [preview, setPreview] = useState<ListScanPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const commit = useMemo(() => toCommitRows(rows), [rows]);
  const commitKey = JSON.stringify(commit.rows);
  const errorCount = Object.keys(commit.errors).length;
  const destination: ListDestination = kind === 'current' ? { kind: 'current' } : { kind: 'new', name: newName.trim() || defaultListName() };
  const destKey = JSON.stringify(destination);

  // Read-only preview, computed by the engine on the server over the destination list (D265): same function as confirm.
  useEffect(() => {
    if (commit.rows.length === 0) { setPreview(null); setPreviewError(null); return; }
    let cancelled = false;
    const t = setTimeout(() => {
      void previewShoppingScanAction(commit.rows, destination, batchId).then((res) => {
        if (cancelled) return;
        if (res.ok) { setPreview(res.preview); setPreviewError(null); }
        else setPreviewError(res.error);
      });
    }, 250);
    return () => { cancelled = true; clearTimeout(t); };
    // commitKey / destKey are the content of commit.rows / destination
  }, [commitKey, destKey, batchId]);

  const patch = (key: string, next: ListRow) => setRows((cur) => cur.map((r) => (r.key === key ? next : r)));
  const lines = useMemo(() => Object.fromEntries((preview?.lines ?? []).map((l) => [l.key, l])), [preview]);

  function confirm() {
    setConfirmError(null);
    start(async () => {
      const res = await confirmShoppingScanAction(commit.rows, destination, batchId);
      if (res.ok) onDone(res.message);
      else setConfirmError(res.error);
    });
  }

  const included = commit.rows.length;
  const crossed = rows.filter((r) => r.crossedOut).length;
  const unclear = rows.filter((r) => r.illegible).length;
  const confirmLabel = included === 0
    ? 'Nothing to add yet'
    : kind === 'current'
      ? `Add ${included} ${included === 1 ? 'item' : 'items'} to my list`
      : `Create the list with ${included} ${included === 1 ? 'item' : 'items'}`;

  return (
    <div className={s.stack}>
      <div className={s.info} role="note">
        Nothing has been added yet. Check what was read from your list, fix anything that is wrong, choose where it goes,
        then confirm.
      </div>
      {warnings.length > 0 && (
        <ul aria-label="Scan warnings" className={s.note} style={{ margin: 0, paddingLeft: '1.25rem' }}>
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}

      {rows.length === 0 ? (
        <p role="status" data-testid="scan-empty" className={s.info}>
          No list lines were found{imageCount > 0 ? <> in {imageCount === 1 ? 'that photo' : 'those photos'}</> : null}. Try again with a
          closer, brighter photo with the writing filling the picture.
        </p>
      ) : (
        <>
          <p className={s.muted} data-testid="scan-summary">
            {rows.length} {rows.length === 1 ? 'line' : 'lines'} read, {included} selected
            {crossed > 0 ? `, ${crossed} crossed out and left out` : ''}
            {unclear > 0 ? `, ${unclear} hard to read and left out` : ''}. Tick any you want to include.
          </p>
          <ul className={s.rows} aria-label="Lines read from your list">
            {rows.map((r) => (
              <ListRowCard key={r.key} row={r} error={commit.errors[r.key]} line={lines[r.key]} onChange={(next) => patch(r.key, next)} />
            ))}
          </ul>
        </>
      )}

      {rows.length > 0 && (
        <Card>
          <CardBody>
            <fieldset className={s.choices} data-testid="destination">
              <legend>Where should these go?</legend>
              <label className={`${s.choice} ${kind === 'current' ? s.choiceOn : ''}`}>
                <input type="radio" name="destination" value="current" checked={kind === 'current'} onChange={() => setKind('current')} data-testid="dest-current" />
                <span>
                  <strong>Add to my current list</strong>
                  <br />
                  <span className={s.muted}>
                    "{current.name}" ({current.itemCount} {current.itemCount === 1 ? 'item' : 'items'}). Matching items are combined, for example 2 + 3.
                  </span>
                </span>
              </label>
              <label className={`${s.choice} ${kind === 'new' ? s.choiceOn : ''}`}>
                <input type="radio" name="destination" value="new" checked={kind === 'new'} onChange={() => setKind('new')} data-testid="dest-new" />
                <span>
                  <strong>Create a new list</strong>
                  <br />
                  <span className={s.muted}>Your current list is kept (you can switch back to it from the Lists button).</span>
                </span>
              </label>
            </fieldset>
            {kind === 'new' && (
              <div className={s.stack} style={{ marginTop: 'var(--fr-space-3)' }}>
                <Input label="Name of the new list" value={newName} maxLength={120} onChange={(e) => setNewName(e.target.value)} data-testid="new-list-name" />
                {title && title !== newName && (
                  <div className={s.badges}>
                    <span className={s.muted}>Your list was headed "{title}".</span>
                    <Button variant="secondary" size="sm" onClick={() => setNewName(title)}>Use that name</Button>
                  </div>
                )}
              </div>
            )}
          </CardBody>
        </Card>
      )}

      {commit.rows.length > 0 && (
        <Card>
          <CardBody>
            <div className={s.stack}>
              <h2 style={{ margin: 0, fontSize: 'var(--fr-text-lg)' }}>
                {kind === 'current' ? 'Changes to your list' : `The new list "${destination.kind === 'new' ? destination.name : ''}"`}
              </h2>
              {previewError && <p role="alert" className={s.fieldError}>{previewError}</p>}
              <ul className={s.preview} aria-label="Changes to your list" data-testid="merge-preview">
                {commit.rows.map((c) => {
                  const line = lines[c.key];
                  return (
                    <li key={c.key} data-testid="preview-line">
                      <span><strong>{line?.name ?? c.name}</strong> {line ? <PreviewText line={line} /> : <span className={s.muted}>checking...</span>}</span>
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
        <Button disabled={pending || included === 0 || errorCount > 0 || rows.length === 0} loading={pending} onClick={confirm} data-testid="confirm-scan">
          {confirmLabel}
        </Button>
        <Button variant="secondary" disabled={pending} onClick={onBack}>Back to photos</Button>
        {errorCount > 0 && <span className={s.fieldError}>Fix the items marked above first.</span>}
      </div>
    </div>
  );
}

function PreviewText({ line }: { line: ListScanPreviewLine }) {
  if (line.kind === 'merge') {
    return <>{line.before} <span className={s.arrow}>to</span> {line.after} <Badge tone="accent">Combined with your list</Badge></>;
  }
  if (line.kind === 'exists') return <>{line.after} <Badge>Already on your list</Badge></>;
  if (line.kind === 'skip') return <Badge tone="warning">Not added</Badge>;
  return <>{line.after} <Badge>New</Badge> <span className={s.muted}>in {line.aisle}</span></>;
}

function ListRowCard({ row, error, line, onChange }: { row: ListRow; error?: string; line?: ListScanPreviewLine; onChange: (r: ListRow) => void }) {
  const conf = confidenceTone(row.confidence);
  const label = row.originalText || row.scannedName || 'unreadable line';
  return (
    <li data-testid="scan-row" aria-label={`Line from your list: ${label}`} className={row.include ? undefined : s.rowOff}>
      <Card>
        <CardBody>
          <div className={s.rowCard}>
            <div className={s.rowHead}>
              <Checkbox
                label={<span>Written: <strong className={s.written}>"{row.originalText || '?'}"</strong></span>}
                aria-label={`Include ${label}`}
                checked={row.include}
                onChange={(e) => onChange({ ...row, include: e.target.checked })}
              />
              <div className={s.badges}>
                {row.crossedOut && <Badge tone="warning" data-testid="crossed-badge">Crossed out</Badge>}
                {row.illegible && <Badge tone="danger" data-testid="illegible-badge">Hard to read</Badge>}
                {!row.illegible && <Badge tone={conf.tone} data-testid="confidence">{conf.label} ({Math.round(row.confidence * 100)}%)</Badge>}
                <span className={s.muted}>photo {row.imageRef}</span>
              </div>
            </div>
            {row.illegible && <p className={s.muted}>We could not read this line. Type what it says below, or leave it out.</p>}
            {row.writtenHint && <p className={s.muted}>{row.writtenHint}</p>}

            <MatchPicker row={row} onChange={onChange} />

            <div className={s.grid}>
              <Input label="Quantity" inputMode="decimal" value={row.value} hint="Blank = just one" onChange={(e) => onChange({ ...row, value: e.target.value })} />
              <Select label="Unit" options={unitOptions} value={row.unit} onChange={(e) => onChange({ ...row, unit: e.target.value as Unit })} />
              <Select label="Aisle" options={aisleOptions} value={row.aisle} onChange={(e) => onChange({ ...row, aisle: e.target.value })} />
            </div>
            <Input label="Note" value={row.notes} maxLength={200} onChange={(e) => onChange({ ...row, notes: e.target.value })} hint="For example: semi-skimmed, or if on offer" />
            {row.include && line && (
              <p className={s.muted} data-testid="row-aisle">Goes under <strong>{line.aisle}</strong>.</p>
            )}
            {error && <p role="alert" className={s.fieldError}>{error}</p>}
          </div>
        </CardBody>
      </Card>
    </li>
  );
}

function MatchPicker({ row, onChange }: { row: ListRow; onChange: (r: ListRow) => void }) {
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
  const choose = (i: IngredientHit | null) => { onChange(withIngredient(row, i)); setChanging(false); setQuery(''); setHits([]); };

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
  const shown = row.originalText || 'this line';

  if (row.ingredient && !changing) {
    return (
      <div className={s.badges}>
        <Badge tone="success" data-testid="match-badge">Read as: {row.ingredient.name}</Badge>
        <span className={s.muted}>{categoryLabel(row.ingredient.category)}</span>
        <Button variant="ghost" size="sm" aria-label={`Change ingredient for ${shown}`} onClick={() => setChanging(true)}>Change</Button>
        <Button variant="ghost" size="sm" aria-label={`Use my own name for ${shown}`} onClick={() => choose(null)}>Use my own name</Button>
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
      <Input
        label="Item name"
        value={row.freeName}
        onChange={(e) => onChange({ ...row, freeName: e.target.value })}
        hint={ambiguous.length ? 'Several ingredients could fit: pick one above, or keep your own name.' : 'Not in the ingredient list: it will be added to your list under this name.'}
      />
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

