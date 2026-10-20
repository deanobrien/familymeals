import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import {
  UNCHECKED,
  blankForm,
  blankIngredient,
  buildInput,
  formFromRecipe,
  move,
  nextKey,
  type FormState,
  type IngDraft,
  type QuantityKind,
  type Unit,
} from '@/lib/recipeForm';
import { DIET_CATEGORIES, MEAL_TYPES, QUANTITY_KINDS, UNITS, type Candidate, type DuplicateHit } from '@/lib/recipesApi';
import IngredientLinkControl from './IngredientLinkControl';
import { Button, EmptyState, ErrorState, ErrorText, Loading, Muted, Text, useStyles } from './ui';
import { Chip, Field, NumberField, OptionRow, Section } from './widgets';

const KIND_LABEL: Record<QuantityKind, string> = {
  exact: 'Exact amount',
  range: 'Range',
  approximate: 'Approximate (pinch, handful)',
  to_taste: 'To taste',
  unparsed: 'Keep as written',
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Create (no id), edit (`id`) or copy (`from`) a recipe (web: RecipeForm). Saving goes through the same server action logic as
 * the web (POST/PUT /api/recipes): validation, duplicate check, and ingredient matching all happen on the server (D221, D331).
 */
export default function RecipeFormScreen() {
  const { recipes, householdId } = useApp();
  const router = useRouter();
  const styles = useStyles();
  const params = useLocalSearchParams<{ id?: string; from?: string }>();
  const editId = params.id;
  const copyOf = params.from;
  const [form, setForm] = useState<FormState | null>(editId || copyOf ? null : blankForm());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [dupes, setDupes] = useState<DuplicateHit[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const checkSeq = useRef(0);
  const previewSeq = useRef<Record<string, number>>({});

  useEffect(() => {
    const source = editId ?? copyOf;
    if (!source || !householdId) return;
    setLoadError(null);
    recipes.get(householdId, source).then(
      (d) => (d ? setForm(formFromRecipe(d.recipe, d.linkNames, !editId)) : setMissing(true)),
      (e: unknown) => setLoadError(e instanceof Error ? e.message : 'Could not load the recipe'),
    );
  }, [recipes, householdId, editId, copyOf]);

  if (!householdId) return <EmptyState title="Pick a household first." />;
  if (missing) return <EmptyState title="Recipe not found." hint="It may have been deleted or archived." />;
  if (loadError) return <ErrorState message={loadError} onRetry={() => router.back()} />;
  if (!form) return <Loading label="Loading recipe" />;

  const set = (patch: Partial<FormState>) => setForm((f) => (f ? { ...f, ...patch } : f));
  const patchIng = (key: string, patch: Partial<IngDraft>) =>
    setForm((f) => (f ? { ...f, ingredients: f.ingredients.map((i) => (i.key === key ? { ...i, ...patch } : i)) } : f));

  /** Live match of one line's typed name; applies the result unless the person has chosen something since. */
  async function previewLink(key: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed || !householdId) return;
    const seq = (previewSeq.current[key] = (previewSeq.current[key] ?? 0) + 1);
    try {
      const [s] = await recipes.matchNames(householdId, [trimmed]);
      if (!s || previewSeq.current[key] !== seq) return;
      patchIng(key, {
        link:
          s.status === 'matched'
            ? { ingredientId: s.ingredientId, linkedName: s.ingredientName, ambiguous: false, candidates: [], checked: true }
            : { ingredientId: undefined, ambiguous: s.status === 'ambiguous', candidates: s.candidates, checked: true },
      });
    } catch {
      // Matching is a convenience: the server re-matches on save.
      patchIng(key, { link: { ...UNCHECKED, checked: true } });
    }
  }

  const chooseLink = (key: string, choice: Candidate | null) => {
    previewSeq.current[key] = (previewSeq.current[key] ?? 0) + 1;
    patchIng(key, {
      link: choice
        ? { ingredientId: choice.id, linkedName: choice.name, ambiguous: false, candidates: [], checked: true }
        : { ingredientId: null, ambiguous: false, candidates: [], checked: true },
    });
  };

  async function checkDupes() {
    if (!form || !householdId) return;
    const seq = ++checkSeq.current;
    if (!form.title.trim()) return setDupes([]);
    try {
      const hits = await recipes.checkDuplicates(householdId, form.title, form.ingredients.map((i) => i.name).filter(Boolean), editId);
      if (seq === checkSeq.current) setDupes(hits);
    } catch {
      /* advisory only */
    }
  }

  async function submit(force: boolean) {
    if (!form || !householdId) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await recipes.save(householdId, editId ?? null, buildInput(form), force);
      if (res.ok) {
        if (editId) router.back();
        else router.replace({ pathname: '/recipe/[id]', params: { id: res.id } });
        return;
      }
      setErrors(res.fieldErrors);
      setDupes(res.duplicates ?? []);
      if (res.message) setFormError(res.message);
      else if (!res.duplicates) setFormError('Please fix the highlighted problems and try again.');
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save the recipe. Please try again.');
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!editId || !householdId) return;
    setSaving(true);
    try {
      await recipes.remove(householdId, editId);
      router.replace('/(tabs)/recipes');
    } catch (e) {
      setConfirmDelete(false);
      setFormError(e instanceof Error ? e.message : 'Could not delete the recipe.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled" testID="recipe-form">
      <Text style={styles.title} accessibilityRole="header">
        {editId ? 'Edit recipe' : copyOf ? 'Copy recipe' : 'New recipe'}
      </Text>
      <ErrorText message={formError} />

      {dupes.length > 0 && (
        <Section testID="duplicate-warning">
          <Text style={{ fontWeight: '600' }} accessibilityRole="alert">
            This looks like a recipe you already have.
          </Text>
          {dupes.map((d) => (
            <Muted key={d.id}>{d.title}</Muted>
          ))}
          <Button title="Save anyway" variant="secondary" onPress={() => void submit(true)} disabled={saving} testID="save-anyway" />
        </Section>
      )}

      <Text style={styles.heading} accessibilityRole="header">
        Basics
      </Text>
      <Field label="Title" value={form.title} onChangeText={(v) => set({ title: v })} onBlur={() => void checkDupes()} error={errors.title} testID="f-title" />
      <Field label="Description" value={form.description} onChangeText={(v) => set({ description: v })} multiline error={errors.description} testID="f-description" />
      <NumberField label="Servings" integer value={Number(form.servings) || undefined} onCommit={(n) => set({ servings: n === undefined ? '' : String(n) })} error={errors.servings} testID="f-servings" />
      <NumberField label="Prep time (minutes)" integer value={form.prep === '' ? undefined : Number(form.prep)} onCommit={(n) => set({ prep: n === undefined ? '' : String(n) })} error={errors.prepMinutes} testID="f-prep" />
      <NumberField label="Cook time (minutes)" integer value={form.cook === '' ? undefined : Number(form.cook)} onCommit={(n) => set({ cook: n === undefined ? '' : String(n) })} error={errors.cookMinutes} testID="f-cook" />
      <Field label="Cuisine" value={form.cuisine} onChangeText={(v) => set({ cuisine: v })} error={errors.cuisine} testID="f-cuisine" />
      <OptionRow label="Meal type" anyLabel={null} value={form.mealType} options={MEAL_TYPES.map((m) => ({ value: m, label: cap(m) }))} onChange={(v) => v && set({ mealType: v })} testID="f-meal" />
      <OptionRow label="Diet" anyLabel={null} value={form.diet} options={DIET_CATEGORIES.map((d) => ({ value: d, label: cap(d) }))} onChange={(v) => v && set({ diet: v })} testID="f-diet" />
      <Field label="Tags" hint="Separate with commas" value={form.tags} onChangeText={(v) => set({ tags: v })} error={errors.tags} testID="f-tags" />
      <Field label="Source" hint="Cookbook, person or website" value={form.sourceAttribution} onChangeText={(v) => set({ sourceAttribution: v })} error={errors.sourceAttribution} testID="f-source" />
      <Field label="Source URL" value={form.sourceUrl} onChangeText={(v) => set({ sourceUrl: v })} keyboardType="url" error={errors.sourceUrl} testID="f-source-url" />

      <Text style={styles.heading} accessibilityRole="header">
        Ingredients
      </Text>
      <ErrorText message={errors.ingredients} />
      {form.ingredients.map((d, idx) => {
        const n = idx + 1;
        const err = (k: string) => errors[`ingredients.${idx}.${k}`];
        return (
          <Section key={d.key} testID={`ingredient-${n}`}>
            <Text style={{ fontWeight: '600' }}>Ingredient {n}</Text>
            <Field
              label={`Ingredient ${n} name`}
              value={d.name}
              onChangeText={(v) => patchIng(d.key, { name: v, link: UNCHECKED })}
              onBlur={() => {
                if (!d.link.checked) void previewLink(d.key, d.name);
              }}
              error={err('name')}
              testID={`ing-name-${n}`}
            />
            <IngredientLinkControl
              n={n}
              hasName={d.name.trim() !== ''}
              state={d.link}
              onChoose={(c) => chooseLink(d.key, c)}
              onAuto={() => {
                patchIng(d.key, { link: UNCHECKED });
                void previewLink(d.key, d.name);
              }}
            />
            <OptionRow
              label={`Ingredient ${n} quantity type`}
              anyLabel={null}
              value={d.kind}
              options={QUANTITY_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
              onChange={(k) => k && patchIng(d.key, { kind: k })}
              testID={`ing-kind-${n}`}
            />
            {d.kind === 'exact' && (
              <NumberField label={`Ingredient ${n} amount`} value={d.value === '' ? undefined : Number(d.value)} onCommit={(v) => patchIng(d.key, { value: v === undefined ? '' : String(v) })} error={err('quantity.value')} testID={`ing-value-${n}`} />
            )}
            {d.kind === 'range' && (
              <>
                <NumberField label={`Ingredient ${n} minimum`} value={d.min === '' ? undefined : Number(d.min)} onCommit={(v) => patchIng(d.key, { min: v === undefined ? '' : String(v) })} error={err('quantity.min')} testID={`ing-min-${n}`} />
                <NumberField label={`Ingredient ${n} maximum`} value={d.max === '' ? undefined : Number(d.max)} onCommit={(v) => patchIng(d.key, { max: v === undefined ? '' : String(v) })} error={err('quantity.max')} testID={`ing-max-${n}`} />
              </>
            )}
            {(d.kind === 'exact' || d.kind === 'range') && (
              <OptionRow
                label={`Ingredient ${n} unit`}
                anyLabel="No unit"
                value={d.unit === '' ? undefined : d.unit}
                options={UNITS.map((u) => ({ value: u, label: u }))}
                onChange={(u) => patchIng(d.key, { unit: (u ?? '') as Unit | '' })}
                testID={`ing-unit-${n}`}
              />
            )}
            {d.kind === 'approximate' && (
              <Field label={`Ingredient ${n} approximate amount`} placeholder="e.g. pinch" value={d.approxLabel} onChangeText={(v) => patchIng(d.key, { approxLabel: v })} testID={`ing-approx-${n}`} />
            )}
            <Field
              label={`Ingredient ${n} original text`}
              placeholder={d.kind === 'unparsed' ? 'Quantity as written' : 'Original text (kept as written)'}
              value={d.originalText}
              onChangeText={(v) => patchIng(d.key, { originalText: v })}
              error={err('quantity.originalText')}
              testID={`ing-original-${n}`}
            />
            <Field label={`Ingredient ${n} preparation`} placeholder="Preparation, e.g. finely chopped" value={d.preparation} onChangeText={(v) => patchIng(d.key, { preparation: v })} testID={`ing-prep-${n}`} />
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              <Chip label="Optional" selected={d.optional} onPress={() => patchIng(d.key, { optional: !d.optional })} testID={`ing-optional-${n}`} accessibilityLabel={`Ingredient ${n} optional`} />
            </View>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button title="Up" variant="secondary" accessibilityLabel={`Move ingredient ${n} up`} disabled={idx === 0} onPress={() => setForm((f) => (f ? { ...f, ingredients: move(f.ingredients, idx, idx - 1) } : f))} testID={`ing-up-${n}`} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Down" variant="secondary" accessibilityLabel={`Move ingredient ${n} down`} disabled={idx === form.ingredients.length - 1} onPress={() => setForm((f) => (f ? { ...f, ingredients: move(f.ingredients, idx, idx + 1) } : f))} testID={`ing-down-${n}`} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Remove" variant="secondary" accessibilityLabel={`Remove ingredient ${n}`} disabled={form.ingredients.length === 1} onPress={() => setForm((f) => (f ? { ...f, ingredients: f.ingredients.filter((i) => i.key !== d.key) } : f))} testID={`ing-remove-${n}`} />
              </View>
            </View>
          </Section>
        );
      })}
      <Button title="Add ingredient" variant="secondary" onPress={() => setForm((f) => (f ? { ...f, ingredients: [...f.ingredients, blankIngredient()] } : f))} testID="add-ingredient" />

      <Text style={styles.heading} accessibilityRole="header">
        Method
      </Text>
      <ErrorText message={errors.steps} />
      {form.steps.map((s, idx) => {
        const n = idx + 1;
        return (
          <Section key={s.key} testID={`step-${n}`}>
            <Field
              label={`Step ${n}`}
              value={s.text}
              multiline
              onChangeText={(v) => setForm((f) => (f ? { ...f, steps: f.steps.map((x) => (x.key === s.key ? { ...x, text: v } : x)) } : f))}
              error={errors[`steps.${idx}`]}
              testID={`step-text-${n}`}
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Button title="Up" variant="secondary" accessibilityLabel={`Move step ${n} up`} disabled={idx === 0} onPress={() => setForm((f) => (f ? { ...f, steps: move(f.steps, idx, idx - 1) } : f))} testID={`step-up-${n}`} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Down" variant="secondary" accessibilityLabel={`Move step ${n} down`} disabled={idx === form.steps.length - 1} onPress={() => setForm((f) => (f ? { ...f, steps: move(f.steps, idx, idx + 1) } : f))} testID={`step-down-${n}`} />
              </View>
              <View style={{ flex: 1 }}>
                <Button title="Remove" variant="secondary" accessibilityLabel={`Remove step ${n}`} disabled={form.steps.length === 1} onPress={() => setForm((f) => (f ? { ...f, steps: f.steps.filter((x) => x.key !== s.key) } : f))} testID={`step-remove-${n}`} />
              </View>
            </View>
          </Section>
        );
      })}
      <Button title="Add step" variant="secondary" onPress={() => setForm((f) => (f ? { ...f, steps: [...f.steps, { key: nextKey(), text: '' }] } : f))} testID="add-step" />

      <Text style={styles.heading} accessibilityRole="header">
        Original text
      </Text>
      <Field
        label="Original recipe text"
        hint={editId && form.originalText ? 'Kept exactly as first captured; edits above never change it.' : 'Optional: paste the recipe as written so it is always kept.'}
        value={form.originalText}
        onChangeText={(v) => set({ originalText: v })}
        editable={!(editId && form.originalText)}
        multiline
        testID="f-original"
      />

      <Button title={saving ? 'Saving...' : editId ? 'Save changes' : 'Create recipe'} onPress={() => void submit(false)} disabled={saving} testID="save-form" />
      <Button title="Cancel" variant="secondary" onPress={() => router.back()} testID="cancel-form" />

      {editId && (
        <View style={{ marginTop: 16 }}>
          {!confirmDelete ? (
            <Button title="Delete recipe" variant="secondary" onPress={() => setConfirmDelete(true)} testID="delete-form" />
          ) : (
            <Section testID="confirm-delete">
              <Text style={{ fontWeight: '600' }}>Delete this recipe?</Text>
              <Muted>It is removed from your library (archived, not shared with anyone).</Muted>
              <Button title="Delete recipe" onPress={() => void remove()} disabled={saving} testID="confirm-delete-yes" />
              <Button title="Keep it" variant="secondary" onPress={() => setConfirmDelete(false)} testID="confirm-delete-no" />
            </Section>
          )}
        </View>
      )}
    </ScrollView>
  );
}
