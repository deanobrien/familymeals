// Cooking history, ratings, notes and "don't suggest again" (P1-A, D360-D369). One module, two callers: the web server
// actions and the bearer JSON routes the Android app uses. Nothing here is client code.

export interface CookNote {
  text: string;
  /** Private notes are only ever returned to their author. */
  isPrivate: boolean;
}

export interface CookEntry {
  id: string;
  recipeId: string;
  /** ISO timestamp. */
  cookedAt: string;
  servings: number;
  rating: number | null;
  /** Display name of the cook ("You" for the caller), null when unknown. */
  cookedBy: string | null;
  mine: boolean;
  note: CookNote | null;
}

export interface CookSummary {
  cookedCount: number;
  /** ISO timestamp of the most recent cook by anyone in the household; null = never cooked. */
  lastCookedAt: string | null;
}

export interface RecipeCookingView extends CookSummary {
  /** Newest first, at most HISTORY_LIMIT. */
  history: CookEntry[];
  /** The caller's current rating of this recipe (1-5). */
  myRating: number | null;
  /** The caller has asked the planner not to suggest this recipe again. */
  dontSuggest: boolean;
  /** How many household members have (the planner skips the recipe if any has). */
  dontSuggestCount: number;
}

export const HISTORY_LIMIT = 20;

export interface MarkCookedInput {
  servings: number;
  rating?: number | null | undefined;
  note?: string | null | undefined;
  /** Default true: a note is private unless the cook shares it with the household. */
  notePrivate?: boolean | undefined;
}

export type CookingErrorCode = 'not_found' | 'forbidden' | 'invalid_input' | 'unknown';

export class CookingError extends Error {
  constructor(
    readonly code: CookingErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'CookingError';
  }
}

/** Storage port: Supabase (as the signed-in user, RLS decides) or the in-memory demo store. */
export interface CookingStore {
  markCooked(householdId: string, userId: string, recipeId: string, input: Required<Pick<MarkCookedInput, 'servings'>> & MarkCookedInput): Promise<CookEntry>;
  view(householdId: string, userId: string, recipeId: string): Promise<RecipeCookingView>;
  /** Cook count and last cooked per recipe, household-wide. Recipes never cooked are absent. */
  summaries(householdId: string): Promise<Map<string, CookSummary>>;
  setDontSuggest(householdId: string, userId: string, recipeId: string, value: boolean): Promise<void>;
  /** Recipes any active member asked the planner to skip. */
  dontSuggestIds(householdId: string): Promise<Set<string>>;
  /**
   * Household mean rating per recipe, only for stores that own ratings themselves (the in-memory demo: its recipe repository
   * has no rating column). Supabase returns an empty map: `recipes.rating` already carries the mean of recipe_ratings.
   */
  ratingMeans(householdId: string): Promise<Map<string, number>>;
}
