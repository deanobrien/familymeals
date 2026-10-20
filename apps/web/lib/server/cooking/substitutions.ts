import 'server-only';
import { AiError, type AiProvider } from '@fr/ai';
import { checkRecipe } from '@fr/recipe-sources';
import type { Household } from '@fr/plan-orchestrator';
import type { RecipeView } from '../../recipes/types';
import { buildRules } from '../discover/service';
import { getIngredientCatalogue, type IngredientCatalogue } from '../refdata/catalogue';

/**
 * "Out of X?" substitutions (P1-A, D364). The AI proposes; the SERVER decides what the household may see:
 *  - every suggestion is re-checked against the household's hard exclusions and allergen groups, exactly as discovered
 *    recipes are (the same rules, the same fail-safe): a substitute (or a word in its guidance) that names an excluded
 *    ingredient or allergen is dropped, and a substitute that cannot be matched to a known ingredient is dropped too,
 *    because it cannot be proven safe while any exclusion is active;
 *  - the household's exclusion names are sent to the model only as anonymous avoid terms (no member identities);
 *  - the original recipe is never changed here: applying a swap is a temporary cook-mode choice, or a saved copy.
 * The checks over-include on purpose (oat milk is withheld for a dairy exclusion): a missed allergen is the worse error.
 */

export interface SubstitutionSuggestion {
  substitute: string;
  /** How much to use, in words ("Use about 3/4 of the amount."). */
  quantityGuidance: string;
  /** What changes in the dish. */
  effect: string;
  /** The model's own claim about the recipe's diet; informational only, never trusted for safety. */
  dietSafe: boolean | null;
}

export type SubstitutionOutcome =
  | {
      ok: true;
      ingredient: { lineId: string; name: string };
      suggestions: SubstitutionSuggestion[];
      /** Suggestions removed by the household exclusions (count only: the names could themselves be the allergen). */
      withheld: number;
      /** Of those, how many only because they could not be checked. */
      withheldUnverifiable: number;
      exclusionsActive: boolean;
    }
  | { ok: false; code: 'NOT_FOUND' | 'AI_UNAVAILABLE' | 'INVALID_INPUT'; message: string };

const MAX_SUGGESTIONS = 6;
const clip = (s: string | undefined, n: number): string => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Is this (free-text) substitute acceptable to the household? Same rules and fail-safe as discovered recipes. */
export function checkSubstitute(
  substitute: string,
  guidance: string,
  household: Pick<Household, 'hardExclusions'>,
  catalogue: IngredientCatalogue = getIngredientCatalogue(),
): { ok: true } | { ok: false; reason: 'exclusion' | 'unverifiable' } {
  const { rules, active } = buildRules(household, {}, catalogue);
  const v = checkRecipe({ title: '', ingredients: [{ name: substitute, measure: '' }], instructions: guidance }, rules, 'vegan', active);
  return v.ok ? v : { ok: false, reason: v.reason === 'unverifiable' ? 'unverifiable' : 'exclusion' };
}

export async function suggestSubstitutionsFor(args: {
  recipe: RecipeView;
  lineId: string;
  household: Pick<Household, 'hardExclusions'>;
  ai: AiProvider;
  householdId?: string | undefined;
  catalogue?: IngredientCatalogue | undefined;
}): Promise<SubstitutionOutcome> {
  const { recipe, household, ai } = args;
  const catalogue = args.catalogue ?? getIngredientCatalogue();
  const line = recipe.ingredients.find((i) => i.id === args.lineId);
  if (!line) return { ok: false, code: 'NOT_FOUND', message: 'That ingredient is not in this recipe.' };

  const avoid = [...new Set(household.hardExclusions.map((x) => x.ingredientName.trim()).filter(Boolean))];
  let raw;
  try {
    raw = await ai.suggestSubstitutions(
      {
        ingredient: line.name,
        recipeTitle: recipe.title,
        avoid,
        otherIngredients: recipe.ingredients.filter((i) => i.id !== line.id).map((i) => i.name).slice(0, 40),
      },
      args.householdId ? { householdId: args.householdId } : undefined,
    );
  } catch (e) {
    if (e instanceof AiError) return { ok: false, code: 'AI_UNAVAILABLE', message: e.userMessage };
    return { ok: false, code: 'AI_UNAVAILABLE', message: 'Suggestions are not available right now. Please try again shortly.' };
  }

  const { rules, active } = buildRules(household, {}, catalogue);
  const seen = new Set<string>([line.name.trim().toLowerCase()]);
  const kept: SubstitutionSuggestion[] = [];
  let withheld = 0;
  let withheldUnverifiable = 0;
  for (const s of raw.suggestions) {
    const substitute = clip(s.substitute, 80);
    const key = substitute.toLowerCase();
    if (!substitute || seen.has(key)) continue;
    seen.add(key);
    const guidance = clip(s.ratioNote, 200);
    const effect = clip(s.effect, 200);
    const v = checkRecipe({ title: '', ingredients: [{ name: substitute, measure: '' }], instructions: `${guidance}\n${effect}` }, rules, 'vegan', active);
    if (!v.ok) {
      withheld++;
      if (v.reason === 'unverifiable') withheldUnverifiable++;
      continue;
    }
    if (kept.length < MAX_SUGGESTIONS) kept.push({ substitute, quantityGuidance: guidance || 'Use about the same amount.', effect: effect || 'No notable change expected.', dietSafe: s.dietSafe ?? null });
  }
  return { ok: true, ingredient: { lineId: line.id, name: line.name }, suggestions: kept, withheld, withheldUnverifiable, exclusionsActive: active };
}
