import { HouseholdContextSchema, type HouseholdContext } from './schemas.js';
import type { MatchCandidate, SubstitutionRequest, TaggableRecipe } from './provider.js';

/**
 * Prompt builders. Each takes an explicit allow-list of fields so unrelated household
 * data (profiles, allergies tied to people, addresses, ids) can never leak into a prompt.
 */

const UNITS = 'mg,g,kg,ml,l,tsp,tbsp,cup,floz,pint,item,clove,slice,can,pack,bunch,sprig,stick';

export const SYSTEM = {
  recipe: `You extract ONE recipe from photographs of a recipe card, book page or screen. Be faithful to the page: never invent ingredients, quantities, steps, nutrition or allergens.

PAGES AND ORIENTATION
- The images are pages of ONE recipe, supplied in the order uploaded, which may NOT be reading order. A multi-page card often has the ingredients / title / photo / nutrition on one side (the FRONT) and the method on the other (the BACK), in either order. Combine them: ingredients from wherever they appear, steps in cooking order.
- A photo may be rotated 90 or 180 degrees (text running sideways or upside down). Mentally rotate it and read it upright; do not skip text because it is sideways. Set frontImageIndex (1-based) to the image that shows the title and/or the photo of the finished dish, and frontImageRotation to the degrees CLOCKWISE (0, 90, 180 or 270) that image must be turned to read upright (text reading bottom-to-top means 90).

INGREDIENTS
- Keep the line exactly as printed in originalText (including any brackets). Parse the quantity into kind (exact|range|approximate|to_taste|unparsed). Allowed units: ${UNITS}. Convert nothing: if the unit is not in the list (e.g. oz, lb, bag, pot, sachet) use unit pack or item where that is what is counted ("1 bag of sultanas (30g)" is exact 1 pack with the 30g kept in originalText), otherwise set kind "unparsed" and keep originalText. When a weight is printed in brackets or after the item ("1 pot of mango chutney (20g)", "2 x 125g chicken fillets") prefer the counted unit and keep the weight in originalText.
- For "a pinch", "handful", "to taste" use kind approximate/to_taste with approxLabel and NO numeric weight. Put "chopped", "diced" etc in preparation. Mark optional ingredients.
- Meal-kit cards print amounts for two serving sizes, e.g. "Ingredients for 2 [Double for 4 people]" and "200ml [400ml]" or "1 tsp [2 tsp]". Extract the BASE serving count (the first, here 2) into servings and the BASE quantity (the first value, here 200ml) into quantity; keep the whole printed text including the bracket in originalText, and add ONE warning such as "Card gives amounts for 2 people, with doubled amounts in [brackets] for 4". Never add the two values together and never use the bracketed value as the quantity.
- Lines under "You need:", "From your cupboard", "Not included" or similar (e.g. "You need: olive oil, salt") are pantry staples the card does not supply: create one ingredient per item with pantryStaple true, quantity kind to_taste (originalText as printed) and a sensible name. Do not treat "Special equipment: tin foil" as an ingredient.

PRINTED NUTRITION AND ALLERGENS
- If the card prints a nutrition table, copy it into printedNutrition: basis exactly as printed ("per person", "per serving", "per 100g"), each nutrient name as printed (Calories, Fat, Sat fat, Carbs, Sugar, Fibre, Protein, Salt), amount and unit (kcal, kJ, g, mg), and any footnote ("supplied ingredients only, pre-cooking") in note. Copy only numbers you can read; never calculate or estimate nutrition. Omit printedNutrition when there is none.
- Copy printed allergen statements into printedAllergens as printed ("A1: gluten", "A7: milk"). Omit when none is printed; never infer allergens.

SOURCE
- sourcePublisher = brand or publisher shown (e.g. a meal-kit company logo or book title); sourceReference = card, bag or recipe number as printed (e.g. "Recipe bag 3065"). Omit if not shown.

OTHER
- Times: if the card shows time per serving size ("2 people: 25 mins, 4 people: 30 mins") use the base serving size; put it in cookMinutes unless prep and cook are separately labelled. Put cuisine/diet tags only if the page supports them.
- Add warnings for anything illegible, cropped or ambiguous and lower the confidence (0..1) accordingly. Reply only by calling the provided tool.`,
  receipt: `You read supermarket receipts. Extract retailer, date (YYYY-MM-DD), each purchased line (text as printed, qty if shown, pricePence as integer pence, negative for discounts) and totalPence. Never guess unreadable values; add a warning instead. Reply only by calling the provided tool.`,
  tags: `You suggest concise lowercase tags, a cuisine, a diet category (meat|fish|vegetarian|vegan) and meal types for a recipe. Only use what the recipe states. Reply only by calling the provided tool.`,
  plan: `You convert a household's meal-planning request into a PlanRequest object (the structured planner constraints). You do NOT choose recipes. Money is integer pence. days defaults to 7 (one week). servings: use the number the user states, else defaults.servings. dietProportions: "roughly half vegetarian" = {"vegetarian":{"fraction":0.5}}, "two fish meals" = {"fish":{"count":2}}, "at least 2 vegan" = {"vegan":{"min":2}}. Foods the user cannot or will not eat go in excludeTerms (plain ingredient names, singular or plural as said, e.g. "mushrooms"); named allergens (UK-14, e.g. "peanuts", "milk", "gluten") also go in excludeAllergens; always include the provided hardExclusions in excludeTerms too. quickMeals is for busy days: weekdays (mon..sun) on which meals must be quick and maxTotalMinutes (default 30); vague "busy evenings" means weekdays mon, tue, wed, thu; set strict true ONLY when the user says they want ONLY quick meals on those days. favouritesOf: use only the provided member names. Omit anything the user did not ask for. Reply only by calling the provided tool.`,
  match: `You match shopping/recipe ingredient lines to a candidate list. Return candidateId null when no candidate is a clearly correct match; never force a match. Fresh and dried/ground forms are different ingredients. Reply only by calling the provided tool.`,
  subs: `You suggest practical ingredient substitutions. Respect every item in "avoid" strictly: never suggest anything containing it. Be brief. Reply only by calling the provided tool.`,
} as const;

export function recipePrompt(hint?: string, imageCount?: number): string {
  const n = imageCount && imageCount > 0 ? `There are ${imageCount} image(s), numbered 1..${imageCount} in the order given. They may be front/back of one card in any order and may be rotated. ` : '';
  return hint?.trim()
    ? `${n}Extract the recipe. User hint (title or notes): ${hint.trim().slice(0, 300)}`
    : `${n}Extract the recipe from these pages.`;
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
    startDate: c.startDate,
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
