import React, { useMemo, useState } from 'react';
import { Image, Linking, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  applyCorrections,
  computeIssues,
  describeQuantity,
  findDuplicates,
  type DraftEdits,
  type DraftIngredient,
  type FieldStatus,
  type Quantity,
  type RecipeDraft,
} from '@fr/recipe-import';
import type { CapturedImage } from '@/lib/extraction';
import type { ExtractionOutcome, ImportClient } from '@/lib/importApi';
import { QUANTITY_KINDS, UNITS } from '@/lib/recipesApi';
import { Button, ErrorText, Loading, Muted, Text, useStyles } from './ui';
import { Badge, Chip, ChipWrap, CommitField, NumberField, OptionRow, Section } from './widgets';

type Unit = NonNullable<Quantity['unit']>;

const KIND_LABEL: Record<Quantity['kind'], string> = {
  exact: 'Exact amount',
  range: 'Range',
  approximate: 'Approximate (pinch, handful)',
  to_taste: 'To taste',
  unparsed: 'Unknown',
};

const STATUS: Record<FieldStatus, { label: string; tone: 'good' | 'warn' | 'bad' }> = {
  ok: { label: 'OK', tone: 'good' },
  low_confidence: { label: 'Low confidence', tone: 'warn' },
  needs_clarification: { label: 'Needs clarification', tone: 'warn' },
  unparsed: { label: 'Unparsed', tone: 'bad' },
};

function StatusBadge({ status, what }: { status: FieldStatus; what: string }) {
  const s = STATUS[status];
  return (
    <View accessible accessibilityLabel={`${what}: ${s.label}`} testID={`status-${what}`}>
      <Badge label={s.label} tone={s.tone} />
    </View>
  );
}

function withKind(q: Quantity, kind: Quantity['kind']): Quantity {
  const base = { kind, originalText: q.originalText || 'unspecified' } as Quantity;
  switch (kind) {
    case 'exact':
      return { ...base, value: q.value ?? q.min ?? 1, unit: q.unit ?? 'item' };
    case 'range': {
      const min = q.min ?? q.value ?? 1;
      return { ...base, min, max: q.max ?? min, unit: q.unit ?? 'item' };
    }
    case 'approximate':
      return { ...base, approxLabel: q.approxLabel ?? 'pinch' };
    default:
      return base;
  }
}

function IngredientRow({ index, ing, issues, onEdit }: { index: number; ing: DraftIngredient; issues: string[]; onEdit: (e: DraftEdits) => void }) {
  const n = index + 1;
  const q = ing.quantity.value;
  const setQ = (next: Quantity) => onEdit({ ingredients: [{ key: ing.key, set: { quantity: next } }] });
  const nameAlt = ing.name.alternative;
  const qAlt = ing.quantity.alternative && ing.quantity.alternative.kind !== 'unparsed' ? ing.quantity.alternative : undefined;
  const warnings = [...new Set([...ing.name.warnings, ...ing.quantity.warnings, ...issues])];
  return (
    <Section testID={`ingredient-row-${n}`}>
      <Text style={{ fontWeight: '600' }}>Line {n}</Text>
      <Muted>from photo: &ldquo;{ing.originalText}&rdquo;</Muted>
      {ing.pantryStaple && (
        <View style={{ flexDirection: 'row' }} testID="pantry-staple-badge">
          <Badge label="Pantry staple (not supplied)" />
        </View>
      )}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginVertical: 4 }}>
        <Muted>Name</Muted>
        <StatusBadge status={ing.name.status} what={`Ingredient ${n} name`} />
        <Muted style={{ marginLeft: 8 }}>Quantity</Muted>
        <StatusBadge status={ing.quantity.status} what={`Ingredient ${n} quantity`} />
        <Muted style={{ marginLeft: 8 }}>Match</Muted>
        <StatusBadge status={ing.ingredientId.status} what={`Ingredient ${n} match`} />
      </View>
      <CommitField
        label={`Ingredient ${n} name`}
        value={ing.name.value}
        testID={`ing-name-${n}`}
        onCommit={(v) => v.trim() && onEdit({ ingredients: [{ key: ing.key, set: { name: v } }] })}
      />
      {nameAlt && (
        <View>
          <Muted>Alternative reading: &ldquo;{nameAlt}&rdquo;</Muted>
          <Button title="Use this name" variant="secondary" onPress={() => onEdit({ ingredients: [{ key: ing.key, set: { name: nameAlt } }] })} testID={`use-name-alt-${n}`} />
        </View>
      )}
      <OptionRow
        label={`Ingredient ${n} quantity type`}
        anyLabel={null}
        value={q.kind}
        options={QUANTITY_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
        onChange={(k) => k && setQ(withKind(q, k))}
        testID={`ing-kind-${n}`}
      />
      {q.kind === 'exact' && <NumberField label={`Ingredient ${n} amount`} value={q.value} testID={`ing-value-${n}`} onCommit={(value) => value !== undefined && setQ({ ...q, value })} />}
      {q.kind === 'range' && (
        <>
          <NumberField label={`Ingredient ${n} minimum`} value={q.min} testID={`ing-min-${n}`} onCommit={(min) => min !== undefined && setQ({ ...q, min })} />
          <NumberField label={`Ingredient ${n} maximum`} value={q.max} testID={`ing-max-${n}`} onCommit={(max) => max !== undefined && setQ({ ...q, max })} />
        </>
      )}
      {(q.kind === 'exact' || q.kind === 'range') && (
        <OptionRow
          label={`Ingredient ${n} unit`}
          anyLabel="No unit"
          value={q.unit}
          options={UNITS.map((u) => ({ value: u, label: u }))}
          onChange={(u) => {
            const { unit: _drop, ...rest } = q;
            void _drop;
            setQ(u ? { ...rest, unit: u as Unit } : rest);
          }}
          testID={`ing-unit-${n}`}
        />
      )}
      {q.kind === 'approximate' && (
        <CommitField label={`Ingredient ${n} approximate amount`} value={q.approxLabel ?? ''} testID={`ing-approx-${n}`} onCommit={(approxLabel) => setQ({ ...q, approxLabel })} />
      )}
      {qAlt && (
        <View>
          <Muted>Alternative reading: {describeQuantity(qAlt)}</Muted>
          <Button title="Use this quantity" variant="secondary" onPress={() => setQ(qAlt)} testID={`use-qty-alt-${n}`} />
        </View>
      )}
      <CommitField
        label={`Ingredient ${n} preparation`}
        value={ing.preparation ?? ''}
        testID={`ing-prep-${n}`}
        onCommit={(v) => onEdit({ ingredients: [{ key: ing.key, set: { preparation: v.trim() ? v : null } }] })}
      />
      <ChipWrap>
        <Chip
          label="Optional"
          accessibilityLabel={`Ingredient ${n} optional`}
          selected={ing.optional}
          testID={`ing-optional-${n}`}
          onPress={() => onEdit({ ingredients: [{ key: ing.key, set: { optional: !ing.optional } }] })}
        />
      </ChipWrap>
      <Button
        title="Remove line"
        accessibilityLabel={`Remove ingredient ${n}`}
        variant="secondary"
        onPress={() => onEdit({ ingredients: [{ key: ing.key, remove: true }] })}
        testID={`ing-remove-${n}`}
      />
      {warnings.map((w) => (
        <Muted key={w}>{w}</Muted>
      ))}
    </Section>
  );
}

/**
 * Full review and edit of what the server extracted (photo import) or built from a discovered recipe: per-field status badges,
 * the model's alternative readings, corrections, blocking issues and the cover pick (web: import/review-step). The corrections
 * use the same `@fr/recipe-import` functions as the web; saving posts the edited draft to /api/extract/save (D332).
 */
export default function ImportReviewScreen({
  outcome,
  client,
  onDone,
  onBack,
  intro,
  pages,
  noteFrom = 'the photo',
  backLabel = 'Back to photos',
  doneLabel = 'Capture another',
}: {
  outcome: ExtractionOutcome;
  client: ImportClient;
  onDone: () => void;
  onBack: () => void;
  /** Replaces the photo-specific intro (recipes that did not come from photos). */
  intro?: string;
  /** The photos the draft was read from (page order), for the cover picker. */
  pages?: CapturedImage[];
  /** Whose notes the warnings are: "the photo" (default) or "the page". */
  noteFrom?: string;
  backLabel?: string;
  doneLabel?: string;
}) {
  const styles = useStyles();
  const router = useRouter();
  const initial = outcome.draft as RecipeDraft;
  const [draft, setDraft] = useState<RecipeDraft>(initial);
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
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

  const duplicates = useMemo(
    () =>
      findDuplicates(
        {
          title: draft.title.value,
          ingredientNames: draft.ingredients.map((i) => i.name.value),
          ingredientIds: draft.ingredients.flatMap((i) => (i.ingredientId.value ? [i.ingredientId.value] : [])),
        },
        outcome.existing,
      ),
    [draft.title.value, draft.ingredients, outcome.existing],
  );

  const blocking = draft.issues.filter((i) => i.blocking);
  const general = draft.issues.filter((i) => !i.ingredientKey && !i.blocking);
  const rowIssues = (key: string) => draft.issues.filter((i) => i.ingredientKey === key).map((i) => i.message);
  const pageCount = Math.max(draft.sourceImageRefs.length, pages?.length ?? 0);
  const coverPage = draft.coverPage ?? 1;
  // The model's rotation applies only to the page it picked as the front; any other page is shown as captured.
  const coverRotation = coverPage === initial.coverPage ? (initial.coverRotation ?? 0) : 0;
  const coverUri = pages?.[coverPage - 1]?.uri;

  async function save() {
    setSaving(true);
    setError(null);
    const clean = structuredClone(draft);
    clean.steps = clean.steps.filter((s) => s.text.trim());
    clean.issues = computeIssues(clean);
    try {
      setSavedId((await client.save({ ...outcome, draft: clean })).id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the recipe');
    } finally {
      setSaving(false);
    }
  }

  if (saving) return <Loading label="Saving recipe" />;

  if (savedId) {
    return (
      <View style={styles.centered}>
        <Text style={styles.title} accessibilityRole="header">
          Recipe saved
        </Text>
        <Text testID="saved-title">{draft.title.value}</Text>
        <Button title="Open recipe" onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: savedId } })} testID="open-recipe" />
        <Button title={doneLabel} variant="secondary" onPress={onDone} testID="capture-another" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">
        Review recipe
      </Text>
      <Muted>
        {intro ?? 'Check what was read from your photos. Anything marked below needs a look before you save. Your original photos and this extraction are kept alongside your corrections.'}
      </Muted>

      {draft.warnings.length > 0 && (
        <View testID="extraction-warnings">
          {draft.warnings.map((w) => (
            <Muted key={w}>Note from {noteFrom}: {w}</Muted>
          ))}
        </View>
      )}

      {duplicates.length > 0 && (
        <View style={styles.banner} accessibilityRole="alert" testID="duplicate-warning">
          <Text>
            This looks like a recipe you already have: {duplicates.slice(0, 3).map((d) => d.title).join(', ')}. You can still save it as a new recipe.
          </Text>
        </View>
      )}

      {outcome.provider && (
        <Muted testID="review-provider">
          Read by: {outcome.provider.label}
          {outcome.provider.isMock ? ' (sample data, not your photo)' : ''}
        </Muted>
      )}
      {draft.source ? <Text testID="review-source">Source: {draft.source}</Text> : null}
      {draft.sourceReference && /^https?:\/\//i.test(draft.sourceReference) ? (
        <Button
          title="Open the original page"
          variant="secondary"
          onPress={() => void Linking.openURL(draft.sourceReference!)}
          testID="review-source-link"
        />
      ) : null}

      {pageCount > 0 && (
        <Section testID="cover-picker">
          {coverUri ? (
            <Image
              source={{ uri: coverUri }}
              accessibilityLabel={`Cover photo preview (page ${coverPage})`}
              style={{ width: 120, height: 120, borderRadius: 8, transform: coverRotation ? [{ rotate: `${coverRotation}deg` }] : [] }}
              resizeMode="contain"
            />
          ) : null}
          {pageCount > 1 ? (
            <OptionRow
              label="Cover photo"
              anyLabel={null}
              value={coverPage}
              options={Array.from({ length: pageCount }, (_, i) => ({
                value: i + 1,
                label: `Page ${i + 1}${i + 1 === initial.coverPage ? ' (picked by the AI)' : ''}`,
              }))}
              onChange={(p) => p && mutate((d) => void (d.coverPage = p))}
              testID="cover-page"
            />
          ) : (
            <Muted>This photo will be the recipe&rsquo;s cover.</Muted>
          )}
        </Section>
      )}

      <Section testID="title-section">
        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
          <StatusBadge status={draft.title.status} what="Title" />
          {draft.titleProposed && <Muted style={{ marginLeft: 8 }}>Suggested by AI. Please confirm or change it.</Muted>}
        </View>
        <CommitField label="Title" value={draft.title.value} testID="review-title-input" onCommit={(v) => edit({ title: v })} />
        {draft.title.alternative && (
          <View>
            <Muted>The photo reads &ldquo;{draft.title.alternative}&rdquo;</Muted>
            <Button title="Use the photo's title" variant="secondary" onPress={() => edit({ title: draft.title.alternative! })} testID="use-title-alt" />
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <StatusBadge status={draft.servings.status} what="Servings" />
        </View>
        <NumberField label="Servings" integer value={draft.servings.value} testID="review-servings" onCommit={(n) => n !== undefined && n > 0 && edit({ servings: n })} />
        <NumberField label="Prep time (minutes)" integer value={draft.prepMinutes} testID="review-prep" onCommit={(n) => n !== undefined && mutate((d) => void (d.prepMinutes = n))} />
        <NumberField label="Cook time (minutes)" integer value={draft.cookMinutes} testID="review-cook" onCommit={(n) => n !== undefined && mutate((d) => void (d.cookMinutes = n))} />
      </Section>

      {(draft.printedNutrition || (draft.printedAllergens && draft.printedAllergens.length > 0)) && (
        <Section testID="printed-card-info">
          <Text style={{ fontWeight: '600' }}>Printed on the recipe card</Text>
          <Muted>Copied from the card exactly as printed. This is supplied by the card, not calculated by this app, and is saved with the recipe labelled that way.</Muted>
          {draft.printedNutrition && (
            <View testID="printed-nutrition">
              <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                <Text>Nutrition {draft.printedNutrition.basis}</Text>
                <Badge label="from recipe card" />
              </View>
              {draft.printedNutrition.note ? <Muted>({draft.printedNutrition.note})</Muted> : null}
              {draft.printedNutrition.values.map((v) => (
                <View key={v.nutrient} style={styles.row}>
                  <Text>{v.nutrient}</Text>
                  <Text>
                    {v.amount}
                    {v.unit === 'kcal' || v.unit === 'kJ' ? ` ${v.unit}` : v.unit}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {draft.printedAllergens && draft.printedAllergens.length > 0 && <Text testID="printed-allergens">Allergens printed on the card: {draft.printedAllergens.join(', ')}</Text>}
        </Section>
      )}

      <Text style={styles.heading} accessibilityRole="header">
        Ingredients ({draft.ingredients.length})
      </Text>
      {draft.ingredients.map((ing, i) => (
        <IngredientRow key={ing.key} index={i} ing={ing} issues={rowIssues(ing.key)} onEdit={edit} />
      ))}
      <Button
        title="Add ingredient"
        variant="secondary"
        testID="add-ingredient"
        onPress={() => edit({ addIngredients: [{ originalText: 'New ingredient', name: 'New ingredient', quantity: { kind: 'unparsed', originalText: 'New ingredient' } }] })}
      />

      <Text style={styles.heading} accessibilityRole="header">
        Method ({draft.steps.length} steps)
      </Text>
      {draft.steps.map((s, i) => (
        <Section key={s.key} testID={`step-row-${i + 1}`}>
          <CommitField
            label={`Step ${i + 1}`}
            value={s.text}
            multiline
            testID={`step-text-${i + 1}`}
            onCommit={(v) =>
              mutate((d) => {
                const t = d.steps[i];
                if (t) {
                  t.text = v;
                  t.edited = true;
                }
              })
            }
          />
          <Button title="Remove step" accessibilityLabel={`Remove step ${i + 1}`} variant="secondary" onPress={() => mutate((d) => void d.steps.splice(i, 1))} testID={`step-remove-${i + 1}`} />
        </Section>
      ))}
      <Button title="Add step" variant="secondary" testID="add-step" onPress={() => mutate((d) => void d.steps.push({ key: `step-${Date.now()}`, text: '', edited: true }))} />

      {(blocking.length > 0 || general.length > 0) && (
        <View style={styles.banner} accessibilityRole={blocking.length ? 'alert' : undefined} testID={blocking.length ? 'blocking-issues' : 'issues'}>
          {blocking.length > 0 && <Text style={{ fontWeight: '600' }}>Fix these before saving:</Text>}
          {blocking.map((i, k) => (
            <Text key={`b${k}`}>- {i.message}</Text>
          ))}
          {general.map((i, k) => (
            <Muted key={`n${k}`}>- {i.message}</Muted>
          ))}
        </View>
      )}

      <ErrorText message={error} />
      <Button title="Save recipe" onPress={() => void save()} disabled={blocking.length > 0 || saving} testID="save-recipe" />
      <Button title={backLabel} variant="secondary" onPress={onBack} testID="back-to-photos" />
    </ScrollView>
  );
}
