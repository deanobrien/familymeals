import type { Quantity } from '@fr/domain';
import type { Candidate, DietCategory, IngredientLineView, MealType, RecipeFull, RecipeInputWire } from './recipesApi';

/** Pure model behind the create/edit recipe form (mirrors apps/web RecipeForm). */

export type QuantityKind = Quantity['kind'];
export type Unit = NonNullable<Quantity['unit']>;

/** What the form knows about one line's link. `ingredientId`: string = linked, null = "not in list", undefined = automatic. */
export interface LinkState {
  ingredientId: string | null | undefined;
  linkedName?: string | undefined;
  ambiguous: boolean;
  candidates: Candidate[];
  /** The live match has not looked at this name yet. */
  checked: boolean;
}

export const UNCHECKED: LinkState = { ingredientId: undefined, ambiguous: false, candidates: [], checked: false };

export interface IngDraft {
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
  link: LinkState;
}

export interface StepDraft {
  key: string;
  text: string;
}

export interface FormState {
  title: string;
  description: string;
  sourceAttribution: string;
  sourceUrl: string;
  originalText: string;
  prep: string;
  cook: string;
  servings: string;
  cuisine: string;
  mealType: MealType;
  diet: DietCategory;
  tags: string;
  imageUrl: string | null;
  ingredients: IngDraft[];
  steps: StepDraft[];
}

let counter = 0;
export const nextKey = (): string => `k${++counter}`;
const numStr = (n: number | undefined | null) => (n == null ? '' : String(n));

export function blankIngredient(): IngDraft {
  return { key: nextKey(), name: '', kind: 'exact', value: '', min: '', max: '', unit: '', approxLabel: '', originalText: '', preparation: '', optional: false, link: UNCHECKED };
}

export function blankForm(): FormState {
  return {
    title: '',
    description: '',
    sourceAttribution: '',
    sourceUrl: '',
    originalText: '',
    prep: '',
    cook: '',
    servings: '4',
    cuisine: '',
    mealType: 'dinner',
    diet: 'vegetarian',
    tags: '',
    imageUrl: null,
    ingredients: [blankIngredient()],
    steps: [{ key: nextKey(), text: '' }],
  };
}

function fromLine(i: IngredientLineView, linkNames: Record<string, string>): IngDraft {
  return {
    // Saved lines keep what they have; an unlinked saved line is not re-matched until the person asks (it may be a deliberate "not in list").
    link: { ingredientId: i.ingredientId, linkedName: i.ingredientId ? linkNames[i.ingredientId] : undefined, ambiguous: false, candidates: [], checked: true },
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
  };
}

/** A saved recipe as form state. `asCopy` clears what must not be shared with the original (cover, verbatim text) and marks the title. */
export function formFromRecipe(r: RecipeFull, linkNames: Record<string, string>, asCopy = false): FormState {
  return {
    title: asCopy ? `${r.title} (copy)` : r.title,
    description: r.description,
    sourceAttribution: r.sourceAttribution,
    sourceUrl: r.sourceUrl,
    originalText: asCopy ? '' : r.originalText,
    prep: numStr(r.prepMinutes),
    cook: numStr(r.cookMinutes),
    servings: String(r.servings),
    cuisine: r.cuisine,
    mealType: r.mealType,
    diet: r.diet,
    tags: r.tags.join(', '),
    imageUrl: asCopy ? null : r.imageUrl,
    ingredients: [...r.ingredients].sort((a, b) => a.order - b.order).map((i) => fromLine(i, linkNames)),
    steps: [...r.steps].sort((a, b) => a.order - b.order).map((s) => ({ key: nextKey(), text: s.text })),
  };
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

export function composeOriginal(d: IngDraft): string {
  switch (d.kind) {
    case 'exact':
      return [d.value, d.unit === 'item' ? '' : d.unit].filter(Boolean).join(' ');
    case 'range':
      return `${d.min}-${d.max}${d.unit && d.unit !== 'item' ? ` ${d.unit}` : ''}`;
    case 'approximate':
      return d.approxLabel.trim() || 'a little';
    case 'to_taste':
      return 'to taste';
    default:
      return d.name;
  }
}

export function toQuantity(d: IngDraft): Quantity {
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

/** The request body for POST/PUT /api/recipes. The server validates it again (zod) and resolves links (D221). */
export function buildInput(f: FormState): RecipeInputWire {
  return {
    title: f.title.trim(),
    description: f.description.trim(),
    imageUrl: f.imageUrl,
    sourceAttribution: f.sourceAttribution.trim(),
    sourceUrl: f.sourceUrl.trim(),
    originalText: f.originalText,
    prepMinutes: intOrNull(f.prep),
    cookMinutes: intOrNull(f.cook),
    servings: intOrNull(f.servings) ?? 0,
    cuisine: f.cuisine.trim(),
    mealType: f.mealType,
    diet: f.diet,
    tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean),
    ingredients: f.ingredients.map((d) => ({
      name: d.name.trim(),
      ...(d.link.ingredientId !== undefined ? { ingredientId: d.link.ingredientId } : {}),
      quantity: toQuantity(d),
      ...(d.preparation.trim() ? { preparation: d.preparation.trim() } : {}),
      optional: d.optional,
    })),
    steps: f.steps.map((s) => s.text.trim()),
  };
}

export function move<T>(list: T[], from: number, to: number): T[] {
  if (to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item as T);
  return next;
}

/** One-line summary of a link for the "Matched to: X" control. */
export function linkSummary(s: LinkState, hasName: boolean): string {
  if (!hasName) return 'Matched to: (enter a name)';
  if (s.ingredientId) return `Matched to: ${s.linkedName ?? 'ingredient'}`;
  if (s.ingredientId === null) return 'Not in the ingredient list';
  if (!s.checked) return 'Matching...';
  if (s.candidates.length > 0) return `Pick a match (${s.candidates.length} ${s.ambiguous ? 'possible' : 'suggested'})`;
  return 'Not matched yet';
}
