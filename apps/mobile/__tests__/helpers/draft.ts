import type { RecipeDraft } from '@fr/recipe-import';

const field = <T,>(value: T, status: 'ok' | 'low_confidence' | 'needs_clarification' | 'unparsed' = 'ok') => ({ value, status, warnings: [] as string[] });

/** makeDraft with a usable quantity on the milk line, so there is no blocking issue (and none reappears when issues are recomputed). */
export function cleanDraft(over: Partial<RecipeDraft> = {}): RecipeDraft {
  const d = makeDraft(over);
  d.ingredients[1]!.quantity = { value: { kind: 'exact', value: 100, unit: 'ml', originalText: '100ml' } as never, status: 'ok', warnings: [] };
  d.ingredients[1]!.affectsCost = false;
  d.issues = [];
  return d;
}

/** A complete RecipeDraft (the shape the server returns), small enough to reason about in a test. */
export function makeDraft(over: Partial<RecipeDraft> = {}): RecipeDraft {
  return {
    title: field('Pancakes'),
    titleProposed: false,
    servings: field<number | undefined>(4),
    tags: [],
    ingredients: [
      {
        key: 'ing-1',
        originalText: '200g flour',
        name: field('flour'),
        quantity: field({ kind: 'exact', value: 200, unit: 'g', originalText: '200g' } as never, 'low_confidence'),
        optional: false,
        ingredientId: field<string | undefined>('flour-id'),
        matchAlternatives: [],
        confidence: 0.6,
        affectsCost: false,
      },
      {
        key: 'ing-2',
        originalText: 'some milk',
        name: field('milk'),
        quantity: field({ kind: 'unparsed', originalText: 'some' } as never, 'unparsed'),
        optional: false,
        ingredientId: field<string | undefined>(undefined, 'needs_clarification'),
        matchAlternatives: [],
        confidence: 0.5,
        affectsCost: true,
      },
    ],
    steps: [
      { key: 'step-1', text: 'Whisk.' },
      { key: 'step-2', text: 'Fry.' },
    ],
    warnings: [],
    issues: [
      { code: 'ingredient_unparsed_quantity', blocking: true, ingredientKey: 'ing-2', message: '"some milk" has no usable quantity, so its cost cannot be estimated. Enter a quantity or mark it optional.' },
    ],
    sourceImageRefs: [],
    original: { pages: [] } as never,
    extractedAt: '2026-10-20T10:00:00Z',
    ...over,
  };
}
