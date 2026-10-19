'use client';

import { useRef, useState, useTransition, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button, Checkbox, Input, Select, Textarea } from '@fr/ui';
import type { RecipeInput } from '../../../lib/recipes/schema';
import {
  DIET_CATEGORIES,
  MEAL_TYPES,
  QUANTITY_KINDS,
  UNITS,
  type Quantity,
  type QuantityKind,
  type RecipeView,
  type Unit,
} from '../../../lib/recipes/types';
import { checkDuplicatesAction, saveRecipeAction, type DuplicateHit } from '../actions';
import styles from '../recipes.module.css';

const KIND_LABEL: Record<QuantityKind, string> = {
  exact: 'Exact amount',
  range: 'Range',
  approximate: 'Approximate (pinch, handful)',
  to_taste: 'To taste',
  unparsed: 'Keep as written',
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface IngDraft {
  key: string;
  name: string;
  kind: QuantityKind;
  value: string;
  min: string;
  max: string;
  unit: Unit | '';
  approxLabel: string;
  /** Original text as first captured; preserved when editing. */
  originalText: string;
  preparation: string;
  optional: boolean;
}
interface StepDraft {
  key: string;
  text: string;
}

let counter = 0;
const nextKey = () => `k${++counter}`;
const numStr = (n: number | undefined) => (n == null ? '' : String(n));

function blankIngredient(): IngDraft {
  return { key: nextKey(), name: '', kind: 'exact', value: '', min: '', max: '', unit: '', approxLabel: '', originalText: '', preparation: '', optional: false };
}

function fromRecipe(r: RecipeView): IngDraft[] {
  return r.ingredients.map((i) => ({
    key: nextKey(),
    name: i.name,
    kind: i.quantity.kind,
    value: numStr(i.quantity.value),
    min: numStr(i.quantity.min),
    max: numStr(i.quantity.max),
    unit: i.quantity.unit ?? '',
    approxLabel: i.quantity.approxLabel ?? '',
    originalText: i.quantity.originalText,
    preparation: i.preparation ?? '',
    optional: i.optional,
  }));
}

const num = (s: string): number | undefined => {
  if (s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
};
const intOrNull = (s: string): number | null => {
  const n = num(s);
  return n == null ? null : Math.round(n);
};

function composeOriginal(d: IngDraft): string {
  switch (d.kind) {
    case 'exact': return [d.value, d.unit === 'item' ? '' : d.unit].filter(Boolean).join(' ');
    case 'range': return `${d.min}-${d.max}${d.unit && d.unit !== 'item' ? ` ${d.unit}` : ''}`;
    case 'approximate': return d.approxLabel || 'a little';
    case 'to_taste': return 'to taste';
    default: return d.name;
  }
}

function toQuantity(d: IngDraft): Quantity {
  const q: Quantity = { kind: d.kind, originalText: d.originalText.trim() || composeOriginal(d) };
  if (d.kind === 'exact') {
    const v = num(d.value);
    if (v !== undefined) q.value = v;
  }
  if (d.kind === 'range') {
    const lo = num(d.min);
    const hi = num(d.max);
    if (lo !== undefined) q.min = lo;
    if (hi !== undefined) q.max = hi;
  }
  if ((d.kind === 'exact' || d.kind === 'range') && d.unit) q.unit = d.unit;
  if (d.kind === 'approximate' && d.approxLabel.trim()) q.approxLabel = d.approxLabel.trim();
  return q;
}

function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

export function RecipeForm({ recipe }: { recipe?: RecipeView }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [title, setTitle] = useState(recipe?.title ?? '');
  const [description, setDescription] = useState(recipe?.description ?? '');
  const [sourceAttribution, setSourceAttribution] = useState(recipe?.sourceAttribution ?? '');
  const [sourceUrl, setSourceUrl] = useState(recipe?.sourceUrl ?? '');
  const [originalText, setOriginalText] = useState(recipe?.originalText ?? '');
  const [prep, setPrep] = useState(numStr(recipe?.prepMinutes ?? undefined));
  const [cook, setCook] = useState(numStr(recipe?.cookMinutes ?? undefined));
  const [servings, setServings] = useState(String(recipe?.servings ?? 4));
  const [cuisine, setCuisine] = useState(recipe?.cuisine ?? '');
  const [mealType, setMealType] = useState<string>(recipe?.mealType ?? 'dinner');
  const [diet, setDiet] = useState<string>(recipe?.diet ?? 'vegetarian');
  const [tags, setTags] = useState((recipe?.tags ?? []).join(', '));
  const [ings, setIngs] = useState<IngDraft[]>(recipe ? fromRecipe(recipe) : [blankIngredient()]);
  const [steps, setSteps] = useState<StepDraft[]>(
    recipe ? recipe.steps.map((s) => ({ key: nextKey(), text: s.text })) : [{ key: nextKey(), text: '' }],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [dupes, setDupes] = useState<DuplicateHit[]>([]);
  const checkSeq = useRef(0);

  const patchIng = (key: string, patch: Partial<IngDraft>) =>
    setIngs((l) => l.map((i) => (i.key === key ? { ...i, ...patch } : i)));

  const build = (): RecipeInput => ({
    title: title.trim(),
    description: description.trim(),
    imageUrl: recipe?.imageUrl ?? null,
    sourceAttribution: sourceAttribution.trim(),
    sourceUrl: sourceUrl.trim(),
    originalText,
    prepMinutes: intOrNull(prep),
    cookMinutes: intOrNull(cook),
    servings: intOrNull(servings) ?? 0,
    cuisine: cuisine.trim(),
    mealType: mealType as RecipeInput['mealType'],
    diet: diet as RecipeInput['diet'],
    tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
    ingredients: ings.map((d) => ({
      name: d.name.trim(),
      quantity: toQuantity(d),
      ...(d.preparation.trim() ? { preparation: d.preparation.trim() } : {}),
      optional: d.optional,
    })),
    steps: steps.map((s) => s.text.trim()),
  });

  const checkDupes = async () => {
    const seq = ++checkSeq.current;
    if (!title.trim()) return setDupes([]);
    const hits = await checkDuplicatesAction(title, ings.map((i) => i.name).filter(Boolean), recipe?.id);
    if (seq === checkSeq.current) setDupes(hits);
  };

  const submit = (force: boolean) =>
    startTransition(async () => {
      setFormError(null);
      const res = await saveRecipeAction(recipe?.id ?? null, build(), force);
      if (res.ok) {
        router.push(`/recipes/${res.id}`);
        router.refresh();
        return;
      }
      setErrors(res.fieldErrors);
      setDupes(res.duplicates ?? []);
      if (res.message) setFormError(res.message);
      else if (!res.duplicates) setFormError('Please fix the highlighted problems and try again.');
    });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit(false);
  };

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate aria-label={recipe ? 'Edit recipe' : 'New recipe'}>
      {formError && <p className={styles.formError} role="alert">{formError}</p>}

      {dupes.length > 0 && (
        <div className={styles.warn} role="alert">
          <strong>This looks like a recipe you already have.</strong>
          <ul>
            {dupes.map((d) => (
              <li key={d.id}><Link href={`/recipes/${d.id}`} target="_blank">{d.title}</Link></li>
            ))}
          </ul>
          <Button variant="secondary" size="sm" onClick={() => submit(true)} disabled={pending}>Save anyway</Button>
        </div>
      )}

      <fieldset className={styles.fieldset}>
        <legend>Basics</legend>
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={checkDupes} error={errors.title} required />
        <Textarea label="Description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} error={errors.description} />
        <div className={styles.row2}>
          <Input label="Servings" type="number" min={1} inputMode="numeric" value={servings} onChange={(e) => setServings(e.target.value)} error={errors.servings} />
          <Input label="Prep time (minutes)" type="number" min={0} inputMode="numeric" value={prep} onChange={(e) => setPrep(e.target.value)} error={errors.prepMinutes} />
          <Input label="Cook time (minutes)" type="number" min={0} inputMode="numeric" value={cook} onChange={(e) => setCook(e.target.value)} error={errors.cookMinutes} />
        </div>
        <div className={styles.row2}>
          <Input label="Cuisine" value={cuisine} onChange={(e) => setCuisine(e.target.value)} error={errors.cuisine} />
          <Select label="Meal type" value={mealType} onChange={(e) => setMealType(e.target.value)} options={MEAL_TYPES.map((m) => ({ value: m, label: cap(m) }))} />
          <Select label="Diet" value={diet} onChange={(e) => setDiet(e.target.value)} options={DIET_CATEGORIES.map((d) => ({ value: d, label: cap(d) }))} />
        </div>
        <Input label="Tags" hint="Separate with commas" value={tags} onChange={(e) => setTags(e.target.value)} error={errors.tags} />
        <div className={styles.row2}>
          <Input label="Source" hint="Cookbook, person or website" value={sourceAttribution} onChange={(e) => setSourceAttribution(e.target.value)} error={errors.sourceAttribution} />
          <Input label="Source URL" type="url" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} error={errors.sourceUrl} />
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Ingredients</legend>
        {errors.ingredients && <p className={styles.formError} role="alert">{errors.ingredients}</p>}
        {ings.map((d, idx) => {
          const n = idx + 1;
          const err = (k: string) => errors[`ingredients.${idx}.${k}`];
          return (
            <div key={d.key} className={styles.ingRow} role="group" aria-label={`Ingredient ${n}`}>
              <div className={styles.rowTools}>
                <strong>Ingredient {n}</strong>
                <Button variant="ghost" size="sm" aria-label={`Move ingredient ${n} up`} disabled={idx === 0} onClick={() => setIngs((l) => move(l, idx, idx - 1))}>Up</Button>
                <Button variant="ghost" size="sm" aria-label={`Move ingredient ${n} down`} disabled={idx === ings.length - 1} onClick={() => setIngs((l) => move(l, idx, idx + 1))}>Down</Button>
                <Button variant="ghost" size="sm" aria-label={`Remove ingredient ${n}`} disabled={ings.length === 1} onClick={() => setIngs((l) => l.filter((i) => i.key !== d.key))}>Remove</Button>
              </div>
              <Input label={`Ingredient ${n} name`} hideLabel placeholder="Ingredient name" value={d.name} onChange={(e) => patchIng(d.key, { name: e.target.value })} error={err('name')} />
              <div className={styles.row2}>
                <Select label={`Ingredient ${n} quantity type`} hideLabel value={d.kind} onChange={(e) => patchIng(d.key, { kind: e.target.value as QuantityKind })} options={QUANTITY_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} />
                {d.kind === 'exact' && (
                  <Input label={`Ingredient ${n} amount`} hideLabel placeholder="Amount" type="number" min={0} step="any" value={d.value} onChange={(e) => patchIng(d.key, { value: e.target.value })} error={err('quantity.value')} />
                )}
                {d.kind === 'range' && (
                  <>
                    <Input label={`Ingredient ${n} minimum`} hideLabel placeholder="Min" type="number" min={0} step="any" value={d.min} onChange={(e) => patchIng(d.key, { min: e.target.value })} error={err('quantity.min')} />
                    <Input label={`Ingredient ${n} maximum`} hideLabel placeholder="Max" type="number" min={0} step="any" value={d.max} onChange={(e) => patchIng(d.key, { max: e.target.value })} error={err('quantity.max')} />
                  </>
                )}
                {(d.kind === 'exact' || d.kind === 'range') && (
                  <Select label={`Ingredient ${n} unit`} hideLabel placeholder="No unit" value={d.unit} onChange={(e) => patchIng(d.key, { unit: e.target.value as Unit | '' })} options={UNITS.map((u) => ({ value: u, label: u }))} />
                )}
                {d.kind === 'approximate' && (
                  <Input label={`Ingredient ${n} approximate amount`} hideLabel placeholder="e.g. pinch" value={d.approxLabel} onChange={(e) => patchIng(d.key, { approxLabel: e.target.value })} />
                )}
              </div>
              <Input label={`Ingredient ${n} original text`} hideLabel placeholder={d.kind === 'unparsed' ? 'Quantity as written' : 'Original text (kept as written)'} value={d.originalText} onChange={(e) => patchIng(d.key, { originalText: e.target.value })} error={err('quantity.originalText')} />
              <Input label={`Ingredient ${n} preparation`} hideLabel placeholder="Preparation, e.g. finely chopped" value={d.preparation} onChange={(e) => patchIng(d.key, { preparation: e.target.value })} />
              <Checkbox label="Optional" checked={d.optional} onChange={(e) => patchIng(d.key, { optional: e.target.checked })} />
            </div>
          );
        })}
        <div>
          <Button variant="secondary" onClick={() => setIngs((l) => [...l, blankIngredient()])}>Add ingredient</Button>
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Method</legend>
        {errors.steps && <p className={styles.formError} role="alert">{errors.steps}</p>}
        {steps.map((s, idx) => {
          const n = idx + 1;
          return (
            <div key={s.key} className={styles.ingRow} role="group" aria-label={`Step ${n}`}>
              <Textarea label={`Step ${n}`} rows={2} value={s.text} onChange={(e) => setSteps((l) => l.map((x) => (x.key === s.key ? { ...x, text: e.target.value } : x)))} error={errors[`steps.${idx}`]} />
              <div className={styles.rowTools}>
                <Button variant="ghost" size="sm" aria-label={`Move step ${n} up`} disabled={idx === 0} onClick={() => setSteps((l) => move(l, idx, idx - 1))}>Up</Button>
                <Button variant="ghost" size="sm" aria-label={`Move step ${n} down`} disabled={idx === steps.length - 1} onClick={() => setSteps((l) => move(l, idx, idx + 1))}>Down</Button>
                <Button variant="ghost" size="sm" aria-label={`Remove step ${n}`} disabled={steps.length === 1} onClick={() => setSteps((l) => l.filter((x) => x.key !== s.key))}>Remove</Button>
              </div>
            </div>
          );
        })}
        <div>
          <Button variant="secondary" onClick={() => setSteps((l) => [...l, { key: nextKey(), text: '' }])}>Add step</Button>
        </div>
      </fieldset>

      <fieldset className={styles.fieldset}>
        <legend>Original text</legend>
        <Textarea
          label="Original recipe text"
          hint={recipe?.originalText ? 'Kept exactly as first captured; edits above never change it.' : 'Optional: paste the recipe as written so it is always kept.'}
          rows={5}
          value={originalText}
          readOnly={!!recipe?.originalText}
          onChange={(e) => setOriginalText(e.target.value)}
        />
      </fieldset>

      <div className={styles.stickyActions}>
        <Button type="submit" loading={pending}>{recipe ? 'Save changes' : 'Create recipe'}</Button>
        <Link href={recipe ? `/recipes/${recipe.id}` : '/recipes'} className="fr-btn fr-btn--secondary">Cancel</Link>
      </div>
    </form>
  );
}
