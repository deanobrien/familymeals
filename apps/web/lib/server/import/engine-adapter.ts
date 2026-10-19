/**
 * Ingredient parser + matcher for the photo-import pipeline, backed by the real engine:
 *   parse  -> @fr/engine/parse parseIngredientLine (deterministic; never invents weights)
 *   match  -> @fr/engine/normalise IngredientMatcher over the @fr/refdata catalogue (exact name/alias or
 *             core+form only; ambiguous / near-miss results are offered as alternatives for the user to pick)
 * Keeps the @fr/recipe-import IngredientParser / IngredientMatcher shapes.
 */
import 'server-only';
import { parseIngredientLine } from '@fr/engine/parse';
import type { IngredientMatchAlternative, IngredientMatcher, IngredientParser, ParsedIngredientLine } from '@fr/recipe-import';
import { getIngredientCatalogue, type IngredientCatalogue } from '../refdata/catalogue';

export function createIngredientParser(): IngredientParser {
  return {
    parse(text: string): ParsedIngredientLine {
      const p = parseIngredientLine(text);
      return {
        quantity: p.quantity,
        name: p.name,
        ...(p.preparation ? { preparation: p.preparation } : {}),
        optional: p.optional,
      };
    },
  };
}

/** Confidence shown for candidates the engine refused to pick (the user must confirm one). */
const AMBIGUOUS_CONFIDENCE = 0.5;
const SUGGESTION_CONFIDENCE = 0.3;
const MAX_ALTERNATIVES = 4;

export function createIngredientMatcher(catalogue: () => IngredientCatalogue = getIngredientCatalogue): IngredientMatcher {
  return {
    match(name: string) {
      const cat = catalogue();
      const r = cat.matcher.match(name);
      const alts = (ids: string[], confidence: number): IngredientMatchAlternative[] =>
        ids.slice(0, MAX_ALTERNATIVES).map((id) => {
          const n = cat.get(id)?.name;
          return { ingredientId: id, ...(n ? { name: n } : {}), confidence };
        });
      if (r.status === 'matched' && r.ingredientId) return { ingredientId: r.ingredientId, confidence: r.confidence, alternatives: [] };
      if (r.status === 'ambiguous') return { confidence: 0, alternatives: alts(r.candidates, AMBIGUOUS_CONFIDENCE) };
      return { confidence: 0, alternatives: alts(r.suggestions, SUGGESTION_CONFIDENCE) };
    },
  };
}

export const ingredientParser: IngredientParser = createIngredientParser();
export const ingredientMatcher: IngredientMatcher = createIngredientMatcher();
