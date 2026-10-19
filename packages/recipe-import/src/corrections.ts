import { QuantitySchema, type Quantity } from './extraction.js';
import { computeIssues, ingredientAffectsCost } from './draft.js';
import type { DraftIngredient, RecipeDraft } from './types.js';

export class DraftEditError extends Error {}

export interface IngredientPatch {
  name?: string;
  quantity?: Quantity;
  preparation?: string | null;
  optional?: boolean;
  /** string = choose ingredient; null = explicitly unmatched. */
  ingredientId?: string | null;
}
export interface IngredientEdit { key: string; remove?: boolean; set?: IngredientPatch; }
export interface NewIngredient { originalText: string; name: string; quantity: Quantity; preparation?: string; optional?: boolean; ingredientId?: string; }

export interface DraftEdits {
  title?: string;
  description?: string;
  servings?: number;
  prepMinutes?: number;
  cookMinutes?: number;
  tags?: string[];
  cuisine?: string;
  ingredients?: IngredientEdit[];
  addIngredients?: NewIngredient[];
  /** Full ordering of ingredient keys; unlisted keys are appended in existing order. */
  ingredientOrder?: string[];
  /** Full replacement of step texts (order = array order). */
  steps?: string[];
}

/** Returns a new draft; the input is not mutated. User-set fields become status 'ok' + edited. */
export function applyCorrections(draft: RecipeDraft, edits: DraftEdits): RecipeDraft {
  const d: RecipeDraft = structuredClone(draft);

  if (edits.title !== undefined) {
    d.title = { value: edits.title.trim(), status: 'ok', warnings: [], edited: true };
    d.titleProposed = false;
  }
  if (edits.description !== undefined) d.description = edits.description;
  if (edits.servings !== undefined) {
    if (!(edits.servings > 0)) throw new DraftEditError('servings must be positive');
    d.servings = { value: edits.servings, status: 'ok', warnings: [], edited: true };
  }
  if (edits.prepMinutes !== undefined) d.prepMinutes = edits.prepMinutes;
  if (edits.cookMinutes !== undefined) d.cookMinutes = edits.cookMinutes;
  if (edits.tags !== undefined) d.tags = [...edits.tags];
  if (edits.cuisine !== undefined) d.cuisine = edits.cuisine;

  for (const e of edits.ingredients ?? []) {
    const idx = d.ingredients.findIndex((i) => i.key === e.key);
    if (idx < 0) throw new DraftEditError(`unknown ingredient key ${e.key}`);
    if (e.remove) { d.ingredients.splice(idx, 1); continue; }
    const ing = d.ingredients[idx]!;
    const p = e.set ?? {};
    if (p.name !== undefined) {
      if (!p.name.trim()) throw new DraftEditError('ingredient name cannot be empty');
      ing.name = { value: p.name.trim(), status: 'ok', warnings: [], edited: true };
    }
    if (p.quantity !== undefined) {
      const r = QuantitySchema.safeParse(p.quantity);
      if (!r.success) throw new DraftEditError(`invalid quantity for ${e.key}: ${r.error.message}`);
      ing.quantity = { value: r.data, status: r.data.kind === 'unparsed' ? 'unparsed' : 'ok', warnings: [], edited: true };
    }
    if (p.preparation !== undefined) {
      if (p.preparation === null) delete ing.preparation; else ing.preparation = p.preparation;
    }
    if (p.optional !== undefined) ing.optional = p.optional;
    if (p.ingredientId !== undefined) {
      ing.ingredientId = { value: p.ingredientId ?? undefined, status: p.ingredientId === null ? 'needs_clarification' : 'ok', warnings: [], edited: true };
    }
    ing.affectsCost = ingredientAffectsCost(ing.optional, ing.quantity.value);
  }

  let next = draft.ingredients.reduce((m, i) => Math.max(m, Number(i.key.replace('ing-', '')) || 0), 0);
  for (const n of edits.addIngredients ?? []) {
    const r = QuantitySchema.safeParse(n.quantity);
    if (!r.success) throw new DraftEditError(`invalid quantity for new ingredient: ${r.error.message}`);
    const ing: DraftIngredient = {
      key: `ing-${++next}`, originalText: n.originalText,
      name: { value: n.name, status: 'ok', warnings: [], edited: true },
      quantity: { value: r.data, status: r.data.kind === 'unparsed' ? 'unparsed' : 'ok', warnings: [], edited: true },
      optional: n.optional ?? false,
      ingredientId: { value: n.ingredientId, status: n.ingredientId ? 'ok' : 'needs_clarification', warnings: [], edited: true },
      matchAlternatives: [], confidence: 1, affectsCost: false,
    };
    if (n.preparation !== undefined) ing.preparation = n.preparation;
    ing.affectsCost = ingredientAffectsCost(ing.optional, ing.quantity.value);
    d.ingredients.push(ing);
  }

  if (edits.ingredientOrder) {
    const rank = new Map(edits.ingredientOrder.map((k, i) => [k, i]));
    const base = d.ingredients.map((i, pos) => ({ i, pos }));
    base.sort((a, b) => (rank.get(a.i.key) ?? 1e6 + a.pos) - (rank.get(b.i.key) ?? 1e6 + b.pos));
    d.ingredients = base.map((x) => x.i);
  }

  if (edits.steps) {
    const old = new Map(d.steps.map((s) => [s.text, s.key]));
    let n = d.steps.length;
    d.steps = edits.steps.filter((t) => t.trim()).map((text) => {
      const existing = old.get(text);
      return existing ? { key: existing, text } : { key: `step-${++n}`, text, edited: true };
    });
  }

  d.issues = computeIssues(d);
  return d;
}
