import { HouseholdContextSchema, type HouseholdContext } from './schemas.js';
import type { MatchCandidate, SubstitutionRequest, TaggableRecipe } from './provider.js';

/**
 * Prompt builders. Each takes an explicit allow-list of fields so unrelated household
 * data (profiles, allergies tied to people, addresses, ids) can never leak into a prompt.
 */

const UNITS = 'mg,g,kg,ml,l,tsp,tbsp,cup,floz,pint,item,clove,slice,can,pack,bunch,sprig,stick';

export const SYSTEM = {
  recipe: `You extract recipes from photographs. Be faithful to the page: never invent ingredients, quantities or steps. Ingredients: keep the original line in originalText; parse quantity into kind (exact|range|approximate|to_taste|unparsed). Allowed units: ${UNITS}. Convert nothing: if the unit is not in the list (e.g. oz, lb) set kind "unparsed" and keep originalText. For "a pinch", "handful", "to taste" use kind approximate/to_taste with approxLabel and NO numeric weight. Put "chopped", "diced" etc in preparation. Mark optional ingredients. Add warnings for anything illegible or ambiguous and lower the confidence (0..1) accordingly. Images are pages of ONE recipe in order. Reply only by calling the provided tool.`,
  receipt: `You read supermarket receipts. Extract retailer, date (YYYY-MM-DD), each purchased line (text as printed, qty if shown, pricePence as integer pence, negative for discounts) and totalPence. Never guess unreadable values; add a warning instead. Reply only by calling the provided tool.`,
  tags: `You suggest concise lowercase tags, a cuisine, a diet category (meat|fish|vegetarian|vegan) and meal types for a recipe. Only use what the recipe states. Reply only by calling the provided tool.`,
  plan: `You convert a household's meal-planning request into a structured PlanConstraints object. You do NOT choose recipes. Money is integer pence. Anything the user says they cannot or will not eat goes in excludeIngredients (these are hard exclusions); always include the provided hard exclusions too. Use only the provided member names in favouritesOf. Reply only by calling the provided tool.`,
  match: `You match shopping/recipe ingredient lines to a candidate list. Return candidateId null when no candidate is a clearly correct match; never force a match. Fresh and dried/ground forms are different ingredients. Reply only by calling the provided tool.`,
  subs: `You suggest practical ingredient substitutions. Respect every item in "avoid" strictly: never suggest anything containing it. Be brief. Reply only by calling the provided tool.`,
} as const;

export function recipePrompt(hint?: string): string {
  return hint?.trim() ? `Extract the recipe. User hint (title or notes): ${hint.trim().slice(0, 300)}` : 'Extract the recipe from these pages.';
}

export function tagsPrompt(r: TaggableRecipe): string {
  return JSON.stringify({
    title: r.title,
    description: r.description?.slice(0, 500),
    ingredients: r.ingredientNames.slice(0, 60),
    cuisine: r.cuisine,
  });
}

export function planPrompt(prompt: string, ctx: HouseholdContext): string {
  // Parsing strips any unknown keys: only the allow-listed fields below can reach the model.
  const c = HouseholdContextSchema.parse(ctx);
  return JSON.stringify({
    request: prompt.slice(0, 2000),
    defaults: { servings: c.defaultServings, weeklyBudgetPence: c.weeklyBudgetPence },
    hardExclusions: c.exclusions,
    memberNames: c.memberNames,
    availableTags: c.availableTags.slice(0, 100),
  });
}

export function matchPrompt(lines: string[], candidates: MatchCandidate[]): string {
  return JSON.stringify({
    lines: lines.slice(0, 100),
    candidates: candidates.slice(0, 300).map((c) => ({ id: c.id, name: c.name })),
  });
}

export function subsPrompt(r: SubstitutionRequest): string {
  return JSON.stringify({
    ingredient: r.ingredient,
    recipeTitle: r.recipeTitle,
    avoid: r.avoid ?? [],
    otherIngredients: r.otherIngredients?.slice(0, 40),
    question: r.question?.slice(0, 300),
  });
}
