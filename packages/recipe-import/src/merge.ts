import type { RecipeExtraction } from './extraction.js';
import { normText } from './util.js';

/** Merge multi-page extractions into one. Order preserved; ingredients/steps deduped across pages. */
export function mergeExtractions(pages: RecipeExtraction[]): RecipeExtraction {
  if (pages.length === 0) throw new Error('mergeExtractions: no pages');
  const first = pages[0]!;
  if (pages.length === 1) return first;

  const ingKeys = new Set<string>();
  const ingredients: RecipeExtraction['ingredients'] = [];
  const stepKeys = new Set<string>();
  const steps: string[] = [];
  const warnings: string[] = [];
  const tags: string[] = [];
  const confidence: Record<string, number> = {};

  pages.forEach((p, i) => {
    for (const ing of p.ingredients) {
      const k = normText(ing.originalText);
      if (ingKeys.has(k)) continue;
      ingKeys.add(k);
      ingredients.push(ing);
    }
    for (const s of p.steps) {
      const k = normText(s);
      if (stepKeys.has(k)) continue;
      stepKeys.add(k);
      steps.push(s);
    }
    for (const w of p.warnings) if (!warnings.includes(w)) warnings.push(w);
    for (const t of p.tags) if (!tags.some((x) => normText(x) === normText(t))) tags.push(t);
    for (const [k, v] of Object.entries(p.confidence)) confidence[k] = Math.min(confidence[k] ?? 1, v);
    if (i > 0 && normText(p.title) !== normText(first.title)) {
      warnings.push(`Page ${i + 1} has a different title ("${p.title}"); using the first page title.`);
    }
  });

  const pick = <K extends 'description' | 'servings' | 'prepMinutes' | 'cookMinutes' | 'cuisine'>(k: K) =>
    pages.find((p) => p[k] !== undefined)?.[k];

  const merged: RecipeExtraction = { title: first.title, ingredients, steps, tags, warnings, confidence };
  const description = pick('description'); if (description !== undefined) merged.description = description;
  const servings = pick('servings'); if (servings !== undefined) merged.servings = servings;
  const prep = pick('prepMinutes'); if (prep !== undefined) merged.prepMinutes = prep;
  const cook = pick('cookMinutes'); if (cook !== undefined) merged.cookMinutes = cook;
  const cuisine = pick('cuisine'); if (cuisine !== undefined) merged.cuisine = cuisine;
  return merged;
}
