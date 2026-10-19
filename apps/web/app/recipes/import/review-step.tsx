'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Badge, Button, Card, CardBody, Checkbox, Input, Select, Textarea } from '@fr/ui';
import {
  applyCorrections, computeIssues, describeQuantity, findDuplicates,
  type DraftEdits, type DraftIngredient, type FieldStatus, type Quantity, type RecipeDraft, type RecipeSummary,
} from '@fr/recipe-import';
import type { ApiError, ProviderInfo } from './import-flow';

type Unit = NonNullable<Quantity['unit']>;
const UNITS: Unit[] = ['g', 'kg', 'mg', 'ml', 'l', 'tsp', 'tbsp', 'cup', 'floz', 'pint', 'item', 'clove', 'slice', 'can', 'pack', 'bunch', 'sprig', 'stick'];
const UNIT_OPTIONS = UNITS.map((u) => ({ value: u, label: u }));
const KIND_OPTIONS = [
  { value: 'exact', label: 'Exact amount' },
  { value: 'range', label: 'Range' },
  { value: 'approximate', label: 'Approximate (pinch, handful)' },
  { value: 'to_taste', label: 'To taste' },
  { value: 'unparsed', label: 'Unknown' },
];

const STATUS: Record<FieldStatus, { label: string; tone: 'success' | 'warning' | 'danger' }> = {
  ok: { label: 'OK', tone: 'success' },
  low_confidence: { label: 'Low confidence', tone: 'warning' },
  needs_clarification: { label: 'Needs clarification', tone: 'warning' },
  unparsed: { label: 'Unparsed', tone: 'danger' },
};

function StatusBadge({ status, what }: { status: FieldStatus; what: string }) {
  const s = STATUS[status];
  return <Badge tone={s.tone} data-status={status} aria-label={`${what}: ${s.label}`}>{s.label}</Badge>;
}

/** Text input that keeps what the user typed (incl. trailing spaces) while committing trimmed values upward. */
function TextField({ label, value, onCommit, multiline, hint }: { label: string; value: string; onCommit: (v: string) => void; multiline?: boolean; hint?: string }) {
  const [local, setLocal] = useState(value);
  useEffect(() => { setLocal((cur) => (cur.trim() === value ? cur : value)); }, [value]);
  const props = { label, value: local, hint, onChange: (e: { target: { value: string } }) => { setLocal(e.target.value); onCommit(e.target.value); } };
  return multiline ? <Textarea {...props} rows={2} /> : <Input {...props} />;
}

/** Numeric input committing only valid numbers (>= min). Blank commits nothing. */
function NumberField({ label, value, onCommit, min = 0, step = 'any', hint }: { label: string; value: number | undefined; onCommit: (n: number) => void; min?: number; step?: string; hint?: string }) {
  const [local, setLocal] = useState(value === undefined ? '' : String(value));
  useEffect(() => { setLocal((cur) => (Number(cur) === value && cur !== '' ? cur : value === undefined ? cur : String(value))); }, [value]);
  return (
    <Input
      label={label} type="number" inputMode="decimal" min={min} step={step} hint={hint} value={local}
      onChange={(e) => {
        setLocal(e.target.value);
        const n = Number(e.target.value);
        if (e.target.value.trim() !== '' && Number.isFinite(n) && n >= min) onCommit(n);
      }}
    />
  );
}

function withKind(q: Quantity, kind: Quantity['kind']): Quantity {
  const base = { kind, originalText: q.originalText || 'unspecified' } as Quantity;
  switch (kind) {
    case 'exact': return { ...base, value: q.value ?? q.min ?? 1, unit: q.unit ?? 'item' };
    case 'range': { const min = q.min ?? q.value ?? 1; return { ...base, min, max: q.max ?? min, unit: q.unit ?? 'item' }; }
    case 'approximate': return { ...base, approxLabel: q.approxLabel ?? 'pinch' };
    default: return base;
  }
}

interface RowProps {
  index: number;
  ing: DraftIngredient;
  issues: string[];
  onEdit: (e: DraftEdits) => void;
}

function IngredientRow({ index, ing, issues, onEdit }: RowProps) {
  const n = index + 1;
  const q = ing.quantity.value;
  const setQ = (next: Quantity) => onEdit({ ingredients: [{ key: ing.key, set: { quantity: next } }] });
  const nameAlt = ing.name.alternative;
  const qAlt = ing.quantity.alternative && ing.quantity.alternative.kind !== 'unparsed' ? ing.quantity.alternative : undefined;
  const warnings = [...ing.name.warnings, ...ing.quantity.warnings];
  return (
    <li data-testid="ingredient-row" data-key={ing.key} style={{ listStyle: 'none', border: '1px solid var(--fr-border)', borderRadius: 8, padding: '0.75rem', display: 'grid', gap: '0.5rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <strong>Line {n}</strong>
        <span style={{ color: 'var(--fr-text-muted, inherit)' }}>from photo: &ldquo;{ing.originalText}&rdquo;</span>
        {ing.pantryStaple && <Badge data-testid="pantry-staple-badge">Pantry staple (not supplied)</Badge>}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
        <span>Name <StatusBadge status={ing.name.status} what={`Ingredient ${n} name`} /></span>
        <span>Quantity <StatusBadge status={ing.quantity.status} what={`Ingredient ${n} quantity`} /></span>
        <span>
          Match{' '}
          <StatusBadge status={ing.ingredientId.status} what={`Ingredient ${n} match`} />
        </span>
      </div>
      <TextField label={`Ingredient ${n} name`} value={ing.name.value} onCommit={(v) => v.trim() && onEdit({ ingredients: [{ key: ing.key, set: { name: v } }] })} />
      {nameAlt && (
        <p style={{ margin: 0 }}>
          Alternative reading: &ldquo;{nameAlt}&rdquo;{' '}
          <Button variant="ghost" size="sm" onClick={() => onEdit({ ingredients: [{ key: ing.key, set: { name: nameAlt } }] })}>Use this name</Button>
        </p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))', gap: '0.5rem' }}>
        <Select label={`Ingredient ${n} quantity type`} options={KIND_OPTIONS} value={q.kind} onChange={(e) => setQ(withKind(q, e.target.value as Quantity['kind']))} />
        {q.kind === 'exact' && (
          <NumberField label={`Ingredient ${n} amount`} value={q.value} onCommit={(value) => setQ({ ...q, value })} />
        )}
        {q.kind === 'range' && (
          <>
            <NumberField label={`Ingredient ${n} minimum`} value={q.min} onCommit={(min) => setQ({ ...q, min })} />
            <NumberField label={`Ingredient ${n} maximum`} value={q.max} onCommit={(max) => setQ({ ...q, max })} />
          </>
        )}
        {(q.kind === 'exact' || q.kind === 'range') && (
          <Select label={`Ingredient ${n} unit`} options={UNIT_OPTIONS} placeholder="No unit" value={q.unit ?? ''}
            onChange={(e) => { const { unit: _drop, ...rest } = q; void _drop; setQ(e.target.value ? { ...rest, unit: e.target.value as Unit } : rest); }} />
        )}
        {q.kind === 'approximate' && (
          <TextField label={`Ingredient ${n} approximate amount`} value={q.approxLabel ?? ''} onCommit={(approxLabel) => setQ({ ...q, approxLabel })} />
        )}
      </div>
      {qAlt && (
        <p style={{ margin: 0 }}>
          Alternative reading: {describeQuantity(qAlt)}{' '}
          <Button variant="ghost" size="sm" onClick={() => setQ(qAlt)}>Use this quantity</Button>
        </p>
      )}
      <TextField label={`Ingredient ${n} preparation`} value={ing.preparation ?? ''} onCommit={(v) => onEdit({ ingredients: [{ key: ing.key, set: { preparation: v.trim() ? v : null } }] })} />
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <Checkbox label="Optional" checked={ing.optional} onChange={(e) => onEdit({ ingredients: [{ key: ing.key, set: { optional: e.target.checked } }] })} />
        <Button variant="ghost" size="sm" aria-label={`Remove ingredient ${n}`} onClick={() => onEdit({ ingredients: [{ key: ing.key, remove: true }] })}>Remove line</Button>
      </div>
      {[...new Set([...warnings, ...issues])].map((w) => (
        <p key={w} style={{ margin: 0, color: 'var(--fr-warning)' }}>{w}</p>
      ))}
    </li>
  );
}

interface Props {
  initial: RecipeDraft;
  existing: RecipeSummary[];
  /** Upload folder id: page photos are previewed from /api/uploads/<id>/page-N.jpg. */
  uploadId: string;
  provider?: ProviderInfo | undefined;
  /** Replaces the photo-specific intro (recipes that did not come from photos). */
  intro?: string;
  onSave: (draft: RecipeDraft) => Promise<{ error?: ApiError }>;
  onStartOver: () => void;
}

export function ReviewStep({ initial, existing, uploadId, provider, intro, onSave, onStartOver }: Props) {
  const [draft, setDraft] = useState<RecipeDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function edit(edits: DraftEdits) {
    try {
      setDraft((d) => applyCorrections(d, edits));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That change is not valid.');
    }
  }
  /** Direct edits for fields applyCorrections cannot clear or reorder safely while typing. */
  function mutate(fn: (d: RecipeDraft) => void) {
    setDraft((d) => {
      const next = structuredClone(d);
      fn(next);
      next.issues = computeIssues(next);
      return next;
    });
  }

  const blocking = draft.issues.filter((i) => i.blocking);
  const pageCount = draft.sourceImageRefs.length;
  // The AI's rotation applies only to the page it picked as the front; any other page is shown as uploaded.
  const coverRotation = (draft.coverPage ?? 1) === initial.coverPage ? (initial.coverRotation ?? 0) : 0;
  const duplicates = useMemo(
    () => findDuplicates(
      {
        title: draft.title.value,
        ingredientNames: draft.ingredients.map((i) => i.name.value),
        ingredientIds: draft.ingredients.flatMap((i) => (i.ingredientId.value ? [i.ingredientId.value] : [])),
      },
      existing,
    ),
    [draft.title.value, draft.ingredients, existing],
  );
  const rowIssues = (key: string) => draft.issues.filter((i) => i.ingredientKey === key).map((i) => i.message);
  const general = draft.issues.filter((i) => !i.ingredientKey);

  async function save() {
    setSaving(true);
    setError(null);
    const clean = structuredClone(draft);
    clean.steps = clean.steps.filter((s) => s.text.trim());
    clean.issues = computeIssues(clean);
    const res = await onSave(clean);
    if (res.error) {
      setError(res.error.message);
      setSaving(false);
    }
  }

  return (
    <div style={{ display: 'grid', gap: '1.25rem', maxWidth: 840 }}>
      <h2>Review recipe</h2>
      <p>{intro ?? 'Check what was read from your photos. Anything marked below needs a look before you save. Your original photos and this extraction are kept alongside your corrections.'}</p>

      {draft.warnings.length > 0 && (
        <div role="status" data-testid="extraction-warnings">
          {draft.warnings.map((w) => <p key={w} style={{ margin: 0 }}>Note from the photo: {w}</p>)}
        </div>
      )}

      {duplicates.length > 0 && (
        <div role="alert" data-testid="duplicate-warning" style={{ padding: '0.75rem 1rem', borderRadius: 8, background: 'var(--fr-warning-soft)', color: 'var(--fr-warning)' }}>
          This looks like a recipe you already have:{' '}
          {duplicates.slice(0, 3).map((d, i) => (
            <span key={d.recipeId}>{i > 0 && ', '}<Link href={`/recipes/${d.recipeId}`}>{d.title}</Link></span>
          ))}
          . You can still save it as a new recipe.
        </div>
      )}

      <Card>
        <CardBody>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            {provider && (
              <p data-testid="review-provider" className="fr-muted" style={{ margin: 0 }}>
                Read by: <strong>{provider.label}</strong>
                {provider.isMock && ' (sample data, not your photo)'}
              </p>
            )}
            {draft.source && <p data-testid="review-source" style={{ margin: 0 }}>Source: <strong>{draft.source}</strong></p>}
            {pageCount > 0 && (
              <div data-testid="cover-picker" style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ width: 120, height: 120, overflow: 'hidden', borderRadius: 8, background: 'var(--fr-surface-2)', display: 'grid', placeItems: 'center' }}>
                  <img
                    src={`/api/uploads/${uploadId}/page-${draft.coverPage ?? 1}.jpg`}
                    alt={`Cover photo preview (page ${draft.coverPage ?? 1})`}
                    style={{ width: 120, height: 120, objectFit: 'contain', transform: coverRotation ? `rotate(${coverRotation}deg)` : undefined }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: '12rem' }}>
                  {pageCount > 1 ? (
                    <Select
                      label="Cover photo"
                      value={String(draft.coverPage ?? 1)}
                      onChange={(e) => mutate((d) => { d.coverPage = Number(e.target.value); })}
                      options={Array.from({ length: pageCount }, (_, i) => ({ value: String(i + 1), label: `Page ${i + 1}${i + 1 === initial.coverPage ? ' (front of the card, picked by the AI)' : ''}` }))}
                      hint="Shown on the recipe card and at the top of the recipe. It is turned upright automatically."
                    />
                  ) : (
                    <p style={{ margin: 0 }}>This photo will be the recipe&rsquo;s cover.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardBody>
          <div style={{ display: 'grid', gap: '0.75rem' }}>
            <div>
              <StatusBadge status={draft.title.status} what="Title" />{' '}
              {draft.titleProposed && <span>Suggested by AI. Please confirm or change it.</span>}
            </div>
            <TextField label="Title" value={draft.title.value} onCommit={(v) => edit({ title: v })} />
            {draft.title.alternative && (
              <p style={{ margin: 0 }}>
                The photo reads &ldquo;{draft.title.alternative}&rdquo;{' '}
                <Button variant="ghost" size="sm" onClick={() => edit({ title: draft.title.alternative! })}>Use the photo&rsquo;s title</Button>
              </p>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(9rem, 1fr))', gap: '0.75rem' }}>
              <div>
                <NumberField label="Servings" value={draft.servings.value} min={1} step="1" onCommit={(n) => edit({ servings: n })} />
                <StatusBadge status={draft.servings.status} what="Servings" />
              </div>
              <NumberField label="Prep time (minutes)" value={draft.prepMinutes} step="1"
                onCommit={(n) => mutate((d) => { d.prepMinutes = Math.round(n); })} />
              <NumberField label="Cook time (minutes)" value={draft.cookMinutes} step="1"
                onCommit={(n) => mutate((d) => { d.cookMinutes = Math.round(n); })} />
            </div>
          </div>
        </CardBody>
      </Card>

      {(draft.printedNutrition || (draft.printedAllergens && draft.printedAllergens.length > 0)) && (
        <section aria-labelledby="printed-h" data-testid="printed-card-info">
          <h3 id="printed-h">Printed on the recipe card</h3>
          <p className="fr-muted">
            Copied from the card exactly as printed. This is supplied by the card, not calculated by this app, and is saved
            with the recipe labelled that way.
          </p>
          {draft.printedNutrition && (
            <div data-testid="printed-nutrition">
              <p style={{ margin: '0 0 0.25rem' }}>
                <strong>Nutrition {draft.printedNutrition.basis}</strong> <Badge>from recipe card</Badge>
                {draft.printedNutrition.note ? ` (${draft.printedNutrition.note})` : ''}
              </p>
              <table>
                <caption className="fr-visually-hidden">Nutrition printed on the card, {draft.printedNutrition.basis}</caption>
                <tbody>
                  {draft.printedNutrition.values.map((v) => (
                    <tr key={v.nutrient}>
                      <th scope="row" style={{ textAlign: 'left', fontWeight: 'normal', paddingRight: '1.5rem' }}>{v.nutrient}</th>
                      <td>{v.amount}{v.unit === 'kcal' || v.unit === 'kJ' ? ` ${v.unit}` : v.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {draft.printedAllergens && draft.printedAllergens.length > 0 && (
            <p data-testid="printed-allergens"><strong>Allergens printed on the card:</strong> {draft.printedAllergens.join(', ')}</p>
          )}
        </section>
      )}

      <section aria-labelledby="ing-h">
        <h3 id="ing-h">Ingredients ({draft.ingredients.length})</h3>
        <ul style={{ padding: 0, margin: 0, display: 'grid', gap: '0.75rem' }}>
          {draft.ingredients.map((ing, i) => (
            <IngredientRow key={ing.key} index={i} ing={ing} issues={rowIssues(ing.key)} onEdit={edit} />
          ))}
        </ul>
        <p>
          <Button variant="secondary" onClick={() => edit({ addIngredients: [{ originalText: 'New ingredient', name: 'New ingredient', quantity: { kind: 'unparsed', originalText: 'New ingredient' } }] })}>
            Add ingredient
          </Button>
        </p>
      </section>

      <section aria-labelledby="steps-h">
        <h3 id="steps-h">Method ({draft.steps.length} steps)</h3>
        <ol style={{ padding: 0, margin: 0, display: 'grid', gap: '0.75rem', listStyle: 'none' }}>
          {draft.steps.map((s, i) => (
            <li key={s.key} data-testid="step-row" style={{ display: 'grid', gap: '0.25rem' }}>
              <TextField label={`Step ${i + 1}`} value={s.text} multiline onCommit={(v) => mutate((d) => { const t = d.steps[i]; if (t) { t.text = v; t.edited = true; } })} />
              <div>
                <Button variant="ghost" size="sm" aria-label={`Remove step ${i + 1}`} onClick={() => mutate((d) => { d.steps.splice(i, 1); })}>Remove step</Button>
              </div>
            </li>
          ))}
        </ol>
        <p>
          <Button variant="secondary" onClick={() => mutate((d) => { d.steps.push({ key: `step-${Date.now()}`, text: '', edited: true }); })}>Add step</Button>
        </p>
      </section>

      {(blocking.length > 0 || general.length > 0) && (
        <div data-testid="issues" aria-live="polite">
          {blocking.length > 0 && <strong>Fix these before saving:</strong>}
          <ul>
            {draft.issues.filter((i) => i.blocking).map((i, k) => <li key={`b${k}`} data-blocking="true">{i.message}</li>)}
            {general.filter((i) => !i.blocking).map((i, k) => <li key={`n${k}`}>{i.message}</li>)}
          </ul>
        </div>
      )}

      {error && <div role="alert" data-testid="save-error" style={{ color: 'var(--fr-danger)' }}>{error}</div>}

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <Button onClick={() => void save()} disabled={blocking.length > 0 || saving} loading={saving}>Save recipe</Button>
        <Button variant="ghost" onClick={onStartOver} disabled={saving}>Start over</Button>
      </div>
    </div>
  );
}
