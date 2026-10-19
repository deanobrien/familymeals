import type { InferredDiet } from './diet.js';
import type { SourceRecipe } from './types.js';

/**
 * Household exclusions applied to discovered recipes BEFORE they are shown (never client-side, never advisory).
 * Fail-safe by design: when any exclusion is active, a line we cannot match to a known ingredient cannot be proven
 * safe, so the recipe is withheld rather than shown with a caveat.
 */
export interface ExclusionRules {
  /** Free-text terms ("mushroom", "peanuts"). Matched against ingredient names, the title and the instructions. */
  terms: string[];
  /** Canonical ingredient ids that must not appear (already expanded from allergen groups by the server). */
  excludeIngredientIds: ReadonlySet<string>;
  /** Diet labels that must not be offered (e.g. 'meat' for a vegetarian request). */
  excludeDiets: readonly InferredDiet[];
  /** Resolve an ingredient name to a canonical id (undefined = not matched). */
  resolveIngredientId(name: string): string | undefined;
  /** True when the text names an allergen group member by keyword (over-inclusive net, D132). */
  textHitsAllergen(text: string): boolean;
  /** Term matcher (the planner's `termMatches`); defaults to a lower-case substring test. */
  termMatches?(text: string, term: string): boolean;
}

export type SafetyVerdict = { ok: true } | { ok: false; reason: 'exclusion' | 'unverifiable' | 'diet'; detail: string };

/** Lines that are safe to leave unmatched (they cannot carry an allergen). */
const SAFE_UNMATCHED = new Set(['water', 'ice', 'ice cubes', 'boiling water', 'cold water', 'warm water']);

const substr = (text: string, term: string): boolean => text.toLowerCase().includes(term.trim().toLowerCase());

export function isActive(rules: Pick<ExclusionRules, 'terms' | 'excludeIngredientIds'> & { allergensActive?: boolean }): boolean {
  return rules.terms.length > 0 || rules.excludeIngredientIds.size > 0 || rules.allergensActive === true;
}

export function checkRecipe(r: Pick<SourceRecipe, 'title' | 'ingredients' | 'instructions'>, rules: ExclusionRules, diet: InferredDiet, active: boolean): SafetyVerdict {
  const match = rules.termMatches ?? substr;
  if (rules.excludeDiets.includes(diet)) return { ok: false, reason: 'diet', detail: `looks ${diet}` };
  const termHit = (text: string): string | undefined => rules.terms.find((t) => t.trim().length >= 2 && (match(text, t) || substr(text, t)));
  const wholeText = `${r.title}\n${r.instructions}`;
  const t0 = termHit(wholeText);
  if (t0) return { ok: false, reason: 'exclusion', detail: `mentions "${t0}"` };
  if (active && rules.textHitsAllergen(wholeText)) return { ok: false, reason: 'exclusion', detail: 'mentions an excluded allergen' };
  for (const line of r.ingredients) {
    const t = termHit(line.name);
    if (t) return { ok: false, reason: 'exclusion', detail: `contains "${t}"` };
    if (active && rules.textHitsAllergen(line.name)) return { ok: false, reason: 'exclusion', detail: `"${line.name}" is in an excluded allergen group` };
    const id = rules.resolveIngredientId(line.name);
    if (id !== undefined) {
      if (rules.excludeIngredientIds.has(id)) return { ok: false, reason: 'exclusion', detail: `contains an excluded ingredient ("${line.name}")` };
    } else if (active && !SAFE_UNMATCHED.has(line.name.trim().toLowerCase())) {
      return { ok: false, reason: 'unverifiable', detail: `"${line.name}" could not be checked against your exclusions` };
    }
  }
  return { ok: true };
}

export interface FilteredRecipes<T> { kept: T[]; withheld: number; withheldUnverifiable: number }

/** Keep only recipes that pass; report how many were withheld (and how many only because they could not be checked). */
export function filterByExclusions<T extends SourceRecipe>(
  recipes: readonly T[], rules: ExclusionRules, dietOf: (r: T) => InferredDiet, active: boolean,
): FilteredRecipes<T> {
  const kept: T[] = [];
  let withheld = 0;
  let withheldUnverifiable = 0;
  for (const r of recipes) {
    const v = checkRecipe(r, rules, dietOf(r), active);
    if (v.ok) kept.push(r);
    else { withheld++; if (v.reason === 'unverifiable') withheldUnverifiable++; }
  }
  return { kept, withheld, withheldUnverifiable };
}
