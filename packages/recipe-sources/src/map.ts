import type { IngredientParser, RecipeExtraction } from '@fr/recipe-import';
import { dietTags, type DietInference } from './diet.js';
import type { SourceRecipe } from './types.js';

const BARE_STAPLES = new Set(['salt', 'black pepper', 'pepper', 'white pepper', 'water', 'ice', 'oil', 'olive oil', 'vegetable oil', 'sunflower oil']);

/** "STEP 1" / "1." / "Step 2:" style markers published on their own line or as a prefix. */
const MARKER_ONLY = /^(?:step\s*\d+|\d+)\s*[.:)\-]?$/i;
const MARKER_PREFIX = /^(?:step\s*\d+\s*[.:)\-]?\s*|\d+\s*[.)]\s+)/i;

/** Instructions text -> reviewable steps (one per paragraph; a single wall of text is split into sentence groups). */
export function splitInstructions(text: string): string[] {
  const lines = text
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter((l) => l && !MARKER_ONLY.test(l))
    .map((l) => l.replace(MARKER_PREFIX, '').trim())
    .filter(Boolean);
  if (lines.length === 1 && lines[0]!.length > 350) {
    const sentences = lines[0]!.split(/(?<=[.!?])\s+(?=[A-Z0-9])/);
    const steps: string[] = [];
    let cur = '';
    for (const s of sentences) {
      cur = cur ? `${cur} ${s}` : s;
      if (cur.length >= 120) { steps.push(cur); cur = ''; }
    }
    if (cur) steps.push(cur);
    return steps;
  }
  return lines;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);

/**
 * SourceRecipe -> the extraction shape @fr/recipe-import's buildDraft expects, so a discovered recipe goes through the
 * SAME review screen as a photo import. No AI is involved: quantities come from the deterministic engine parser applied
 * to the publisher's own "measure + ingredient" text, which is kept verbatim as the line's original text.
 */
export function toExtraction(r: SourceRecipe, parser: Pick<IngredientParser, 'parse'>, diet?: DietInference): RecipeExtraction {
  const ingredients: RecipeExtraction['ingredients'] = r.ingredients.map((i) => {
    const originalText = [i.measure, i.name].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    let quantity: RecipeExtraction['ingredients'][number]['quantity'] | undefined;
    let optional = false;
    let preparation: string | undefined;
    try {
      const p = parser.parse(originalText);
      quantity = p.quantity;
      optional = p.optional;
      preparation = p.preparation;
    } catch { /* fall through to unparsed */ }
    let pantryStaple: boolean | undefined;
    if (!quantity || quantity.kind === 'unparsed') {
      if (!i.measure && BARE_STAPLES.has(i.name.toLowerCase())) {
        quantity = { kind: 'to_taste', originalText };
        pantryStaple = true;
      } else {
        quantity = { kind: 'unparsed', originalText };
      }
    }
    return {
      originalText,
      name: i.name,
      quantity,
      ...(preparation ? { preparation } : {}),
      optional,
      ...(pantryStaple ? { pantryStaple } : {}),
      confidence: quantity.kind === 'unparsed' ? 0.5 : 0.9,
    };
  });

  const tags = [
    ...(r.category ? [r.category.toLowerCase()] : []),
    ...r.tags.map((t) => t.toLowerCase()),
    ...(diet ? dietTags(diet) : []),
  ];
  const warnings = [
    'Servings are not given by the recipe source; set them before saving.',
    ...(diet ? [`Dietary label is worked out from the ingredient list and is not verified: ${diet.reason}.`] : []),
  ];
  return {
    title: clip(r.title, 160),
    description: `${r.category ? `${r.category} recipe` : 'Recipe'} from ${r.attribution.publisher}.`,
    ingredients,
    steps: splitInstructions(r.instructions).map((s) => clip(s, 1500)),
    tags: [...new Set(tags.map((t) => clip(t, 40)).filter(Boolean))].slice(0, 30),
    ...(r.area ? { cuisine: clip(r.area, 60) } : {}),
    warnings,
    confidence: {},
    sourcePublisher: r.attribution.publisher,
    sourceReference: r.attribution.url,
  };
}
