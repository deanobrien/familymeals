/**
 * Wire contract of the web app's cooking routes (P1-A, D366): /api/recipes/[id]/{cooking,cooked,dont-suggest,substitutions,variant}.
 * Mirrors apps/web/lib/server/cooking/types.ts and substitutions.ts; change them together. The server owns every rule
 * (private notes, exclusion re-checks, planner signals): the app only shows what it is given.
 */

export interface CookNote {
  text: string;
  isPrivate: boolean;
}

export interface CookEntry {
  id: string;
  recipeId: string;
  cookedAt: string;
  servings: number;
  rating: number | null;
  cookedBy: string | null;
  mine: boolean;
  note: CookNote | null;
}

export interface CookSummary {
  cookedCount: number;
  lastCookedAt: string | null;
}

export interface RecipeCooking extends CookSummary {
  history: CookEntry[];
  myRating: number | null;
  dontSuggest: boolean;
  dontSuggestCount: number;
}

export interface MarkCookedInput {
  servings: number;
  rating?: number | null;
  note?: string | null;
  /** Default true: private to the author. */
  notePrivate?: boolean;
}

export type MarkCookedResult =
  | { ok: true; entry: CookEntry; cooking: RecipeCooking }
  | { ok: false; message: string; fieldErrors: Record<string, string> };

export interface SubstitutionSuggestion {
  substitute: string;
  quantityGuidance: string;
  effect: string;
  dietSafe: boolean | null;
}

export type SubstitutionResult =
  | { ok: true; ingredient: { lineId: string; name: string }; suggestions: SubstitutionSuggestion[]; withheld: number; withheldUnverifiable: number; exclusionsActive: boolean }
  | { ok: false; message: string };

export interface SwapInput {
  lineId: string;
  name: string;
  guidance?: string;
}

export type VariantResult = { ok: true; id: string; title: string } | { ok: false; message: string };
