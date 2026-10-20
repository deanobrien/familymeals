import type { RecipeExtraction } from '../extraction.js';
import type { IngredientParser } from '../types.js';
import type { StructuredRecipe } from './structured.js';

const BARE_STAPLES = new Set(['salt', 'black pepper', 'pepper', 'white pepper', 'water', 'ice', 'oil', 'olive oil', 'vegetable oil', 'sunflower oil']);

export interface WebExtractionOptions {
  /** Site name for attribution ("Example Kitchen"); falls back to the host. */
  publisher: string;
  /** The page URL kept as the source reference. */
  sourceUrl: string;
}

/**
 * StructuredRecipe (a publisher's own schema.org data) -> the extraction shape buildDraft expects, with quantities from the
 * deterministic engine parser applied to each line, which is kept verbatim as originalText. No AI is involved.
 */
export function structuredToExtraction(r: StructuredRecipe, parser: Pick<IngredientParser, 'parse'>, o: WebExtractionOptions): RecipeExtraction {
  const ingredients: RecipeExtraction['ingredients'] = r.ingredients.map((line) => {
    const originalText = line.replace(/\s+/g, ' ').trim();
    let quantity: RecipeExtraction['ingredients'][number]['quantity'] | undefined;
    let name = originalText;
    let optional = false;
    let preparation: string | undefined;
    try {
      const p = parser.parse(originalText);
      quantity = p.quantity;
      name = p.name || originalText;
      optional = p.optional;
      preparation = p.preparation;
    } catch { /* unparsed below */ }
    let pantryStaple: boolean | undefined;
    if (!quantity || quantity.kind === 'unparsed') {
      if (BARE_STAPLES.has(originalText.toLowerCase())) {
        quantity = { kind: 'to_taste', originalText };
        pantryStaple = true;
      } else {
        quantity = { kind: 'unparsed', originalText };
      }
    }
    return {
      originalText,
      name: name.slice(0, 160) || originalText.slice(0, 160),
      quantity,
      ...(preparation ? { preparation } : {}),
      optional,
      ...(pantryStaple ? { pantryStaple } : {}),
      confidence: quantity.kind === 'unparsed' ? 0.5 : 0.9,
    };
  });

  const tags = [...(r.category ? [r.category.toLowerCase()] : []), ...r.keywords].map((t) => t.slice(0, 40)).filter(Boolean);
  const warnings = [
    'Read from the recipe data published on the page. Check it against the page (open the link) before saving.',
    ...(r.servings === undefined ? ['The page does not say how many it serves; set servings before saving.'] : []),
  ];
  const cook = r.cookMinutes ?? (r.prepMinutes === undefined ? r.totalMinutes : undefined);
  return {
    title: r.name.slice(0, 160),
    ...(r.description ? { description: r.description } : {}),
    ingredients,
    steps: r.steps,
    ...(r.servings !== undefined ? { servings: r.servings } : {}),
    ...(r.prepMinutes !== undefined ? { prepMinutes: r.prepMinutes } : {}),
    ...(cook !== undefined ? { cookMinutes: cook } : {}),
    tags: [...new Set(tags)].slice(0, 30),
    ...(r.cuisine ? { cuisine: r.cuisine } : {}),
    warnings,
    confidence: {},
    sourcePublisher: o.publisher.slice(0, 120),
    sourceReference: o.sourceUrl.slice(0, 500),
  };
}
