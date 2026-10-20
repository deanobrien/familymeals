import type { PantryScan, PantryScanContext } from './pantry-scan.js';
import type { ShoppingListScan, ShoppingListScanContext } from './shopping-list-scan.js';
import type {
  HouseholdContext, IngredientMatches, PlanConstraints, ReceiptParse, RecipeExtraction, Substitutions, TagSuggestion,
} from './schemas.js';

/** Raw image bytes as uploaded; the provider preprocesses (limits, resize) itself. */
export type ImageInput = Uint8Array;

export interface CallContext {
  /** For usage tracking + limit checks only. Never placed in prompts. */
  householdId?: string;
}

/** Only the fields needed to tag a recipe. Extra properties are dropped before prompting. */
export interface TaggableRecipe {
  title: string;
  description?: string;
  ingredientNames: string[];
  cuisine?: string;
}

export interface MatchCandidate { id: string; name: string; }

export interface SubstitutionRequest {
  ingredient: string;
  recipeTitle?: string;
  /** Anonymised hard exclusions (ingredient/allergen names), no member identities. */
  avoid?: string[];
  otherIngredients?: string[];
  question?: string;
}

/** Provider-independent, server-only AI gateway. All outputs are zod-validated. */
export interface AiProvider {
  extractRecipe(images: ImageInput[], hint?: string, ctx?: CallContext): Promise<RecipeExtraction>;
  /** The visible text of a recipe web page (no structured data was found) -> one extracted recipe. The text is untrusted data. */
  extractRecipeFromText(text: string, hint?: string, ctx?: CallContext): Promise<RecipeExtraction>;
  parseReceipt(image: ImageInput, ctx?: CallContext): Promise<ReceiptParse>;
  suggestTags(recipe: TaggableRecipe, ctx?: CallContext): Promise<TagSuggestion>;
  parsePlanPrompt(prompt: string, householdContext: HouseholdContext, ctx?: CallContext): Promise<PlanConstraints>;
  suggestIngredientMatches(lines: string[], candidates: MatchCandidate[], ctx?: CallContext): Promise<IngredientMatches>;
  suggestSubstitutions(req: SubstitutionRequest, ctx?: CallContext): Promise<Substitutions>;
  /** Photos / video frames of a kitchen -> de-duplicated items with counts, pack sizes and (only if legible) dates. */
  scanPantry(images: ImageInput[], context?: PantryScanContext, ctx?: CallContext): Promise<PantryScan>;
  /** Photos of a HANDWRITTEN shopping list -> transcribed, parsed lines (never invents items or amounts; crossed-out lines flagged). */
  scanShoppingList(images: ImageInput[], context?: ShoppingListScanContext, ctx?: CallContext): Promise<ShoppingListScan>;
  /** Optional live connectivity check (credentials + endpoint + model) used by Settings > Test connection. */
  ping?(): Promise<{ model: string }>;
}
