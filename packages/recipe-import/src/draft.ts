import { RecipeExtractionSchema, type Quantity, type RecipeExtraction } from './extraction.js';
import { mergeExtractions } from './merge.js';
import type {
  BuildDraftDeps, BuildDraftOptions, DraftIngredient, DraftIssue, Field, ParsedIngredientLine, RecipeDraft,
} from './types.js';
import { normText } from './util.js';

const ok = <T>(value: T): Field<T> => ({ value, status: 'ok', warnings: [] });

const close = (a?: number, b?: number) =>
  a === undefined || b === undefined ? a === b : Math.abs(a - b) <= Math.max(1e-6, 0.01 * Math.max(Math.abs(a), Math.abs(b)));

export function quantitiesAgree(a: Quantity, b: Quantity): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'exact': return close(a.value, b.value) && a.unit === b.unit;
    case 'range': return close(a.min, b.min) && close(a.max, b.max) && a.unit === b.unit;
    case 'approximate': return normText(a.approxLabel ?? '') === normText(b.approxLabel ?? '');
    default: return true; // to_taste / unparsed: kind match is enough
  }
}

export function describeQuantity(q: Quantity): string {
  switch (q.kind) {
    case 'exact': return `${q.value}${q.unit ? ' ' + q.unit : ''}`;
    case 'range': return `${q.min}-${q.max}${q.unit ? ' ' + q.unit : ''}`;
    case 'approximate': return q.approxLabel ?? 'approximate';
    case 'to_taste': return 'to taste';
    default: return 'unparsed';
  }
}

export function ingredientAffectsCost(optional: boolean, q: Quantity): boolean {
  return !optional && q.kind === 'unparsed';
}

/** Recompute the issue list from draft state (used after build and after every correction). */
export function computeIssues(d: Pick<RecipeDraft, 'title' | 'ingredients' | 'steps' | 'servings'>): DraftIssue[] {
  const issues: DraftIssue[] = [];
  if (!d.title.value.trim()) issues.push({ code: 'missing_title', blocking: true, message: 'Recipe needs a title.' });
  if (d.ingredients.length === 0) issues.push({ code: 'no_ingredients', blocking: true, message: 'Recipe has no ingredients.' });
  if (d.steps.length === 0) issues.push({ code: 'no_steps', blocking: true, message: 'Recipe has no steps.' });
  if (d.servings.value === undefined) {
    issues.push({ code: 'missing_servings', blocking: false, message: 'Servings not found; cost per serving and scaling need it.' });
  }
  for (const ing of d.ingredients) {
    if (ing.quantity.value.kind === 'unparsed' && !ing.optional) {
      issues.push({
        code: 'ingredient_unparsed_quantity', blocking: true, ingredientKey: ing.key,
        message: `"${ing.originalText}" has no usable quantity, so its cost cannot be estimated. Enter a quantity or mark it optional.`,
      });
    }
    if (ing.ingredientId.value === undefined) {
      issues.push({ code: 'unmatched_ingredient', blocking: false, ingredientKey: ing.key, message: `"${ing.name.value}" is not matched to a known ingredient (line kept).` });
    }
    for (const w of [...ing.name.warnings, ...ing.quantity.warnings]) {
      if (/differs/i.test(w)) issues.push({ code: 'parse_disagreement', blocking: false, ingredientKey: ing.key, message: w });
    }
    if (ing.quantity.status === 'low_confidence' || ing.name.status === 'low_confidence') {
      issues.push({ code: 'low_confidence', blocking: false, ingredientKey: ing.key, message: `Low extraction confidence for "${ing.originalText}".` });
    }
  }
  return issues;
}

function buildIngredient(
  raw: RecipeExtraction['ingredients'][number], index: number, deps: BuildDraftDeps,
): DraftIngredient {
  const lowT = deps.lowConfidenceThreshold ?? 0.7;
  const matchT = deps.matchThreshold ?? 0.6;
  const key = `ing-${index + 1}`;

  let parsed: ParsedIngredientLine | undefined;
  try { parsed = deps.parser.parse(raw.originalText); } catch { parsed = undefined; }

  // ---- quantity ----
  const qty: Field<Quantity> = ok(raw.quantity);
  if (!parsed) {
    qty.warnings.push('Deterministic parser failed on this line; AI value kept unverified.');
    if (raw.quantity.kind === 'unparsed') qty.status = 'unparsed';
    else if (raw.confidence < lowT) qty.status = 'low_confidence';
  } else if (raw.quantity.kind === 'unparsed' && parsed.quantity.kind !== 'unparsed') {
    // AI had nothing: surface the parser reading, but ask the user to confirm it.
    qty.value = parsed.quantity;
    qty.alternative = raw.quantity;
    qty.status = 'needs_clarification';
    qty.warnings.push(`AI could not read a quantity; parser read "${describeQuantity(parsed.quantity)}". Please confirm.`);
  } else if (!quantitiesAgree(raw.quantity, parsed.quantity)) {
    qty.alternative = parsed.quantity;
    qty.status = 'needs_clarification';
    qty.warnings.push(
      `AI quantity "${describeQuantity(raw.quantity)}" differs from parsed "${describeQuantity(parsed.quantity)}" for "${raw.originalText}".`);
  } else if (raw.quantity.kind === 'unparsed') {
    qty.status = 'unparsed';
  } else if (raw.confidence < lowT) {
    qty.status = 'low_confidence';
  }

  // ---- name ----
  const name: Field<string> = ok(raw.name);
  const aiN = normText(raw.name);
  const pN = parsed ? normText(parsed.name) : aiN;
  if (parsed && pN !== aiN && !pN.includes(aiN) && !aiN.includes(pN)) {
    name.alternative = parsed.name;
    name.status = 'needs_clarification';
    name.warnings.push(`AI name "${raw.name}" differs from parsed name "${parsed.name}".`);
  } else if (raw.confidence < lowT) name.status = 'low_confidence';

  // ---- match ----
  let match: { ingredientId?: string; confidence: number; alternatives: DraftIngredient['matchAlternatives'] } =
    { confidence: 0, alternatives: [] };
  try { match = deps.matcher.match(raw.name); } catch { /* treat as unmatched */ }
  const idField: Field<string | undefined> = ok(match.ingredientId);
  if (match.ingredientId === undefined) {
    idField.status = 'needs_clarification';
    idField.warnings.push('No ingredient match found.');
  } else if (match.confidence < matchT) {
    idField.status = 'low_confidence';
    idField.warnings.push(`Weak ingredient match (${match.confidence.toFixed(2)}).`);
  }

  const preparation = raw.preparation ?? parsed?.preparation;
  const ing: DraftIngredient = {
    key, originalText: raw.originalText, name, quantity: qty,
    optional: raw.optional || (parsed?.optional ?? false),
    ingredientId: idField, matchAlternatives: match.alternatives ?? [],
    confidence: raw.confidence,
    affectsCost: false,
  };
  if (preparation !== undefined) ing.preparation = preparation;
  ing.affectsCost = ingredientAffectsCost(ing.optional, qty.value);
  return ing;
}

/** Build a reviewable draft from one extraction, or several pages of the same recipe. */
export function buildDraft(
  extraction: RecipeExtraction | RecipeExtraction[],
  deps: BuildDraftDeps,
  opts: BuildDraftOptions = {},
): RecipeDraft {
  const lowT = deps.lowConfidenceThreshold ?? 0.7;
  const pages = (Array.isArray(extraction) ? extraction : [extraction]).map((e) => RecipeExtractionSchema.parse(e));
  const merged = mergeExtractions(pages);
  const original = pages.length === 1 ? pages[0]! : { pages };

  const userTitle = opts.userTitle?.trim();
  const title: Field<string> = userTitle
    ? { value: userTitle, status: 'ok', warnings: [], ...(normText(userTitle) !== normText(merged.title) ? { alternative: merged.title } : {}) }
    : { value: merged.title, status: (merged.confidence.title ?? 1) < lowT ? 'low_confidence' : 'ok', warnings: ['Title proposed by AI; please confirm.'] };

  const servings: Field<number | undefined> = merged.servings === undefined
    ? { value: undefined, status: 'needs_clarification', warnings: ['Servings not found.'] }
    : { value: merged.servings, status: (merged.confidence.servings ?? 1) < lowT ? 'low_confidence' : 'ok', warnings: [] };

  const ingredients = merged.ingredients.map((r, i) => buildIngredient(r, i, deps));
  const steps = merged.steps.map((text, i) => ({ key: `step-${i + 1}`, text }));

  const draft: RecipeDraft = {
    title, titleProposed: !userTitle, servings, ingredients, steps,
    tags: merged.tags, warnings: merged.warnings, issues: [],
    sourceImageRefs: opts.sourceImageRefs ?? [], original,
    extractedAt: (deps.now?.() ?? new Date()).toISOString(),
  };
  if (merged.description !== undefined) draft.description = merged.description;
  if (merged.prepMinutes !== undefined) draft.prepMinutes = merged.prepMinutes;
  if (merged.cookMinutes !== undefined) draft.cookMinutes = merged.cookMinutes;
  if (merged.cuisine !== undefined) draft.cuisine = merged.cuisine;
  if (opts.source !== undefined) draft.source = opts.source;
  draft.issues = computeIssues(draft);
  return draft;
}
