import type { Quantity, RecipeExtraction } from './extraction.js';

export type FieldStatus = 'ok' | 'low_confidence' | 'needs_clarification' | 'unparsed';

/** A reviewable value. `alternative` holds the competing value on disagreement (never silently overwritten). */
export interface Field<T> {
  value: T;
  status: FieldStatus;
  alternative?: T;
  warnings: string[];
  edited?: boolean;
}

// ---- injected dependencies (mirror forthcoming @fr/engine parse/normalise) ----
export interface ParsedIngredientLine { quantity: Quantity; name: string; preparation?: string; optional: boolean; }
export interface IngredientParser { parse(text: string): ParsedIngredientLine; }
export interface IngredientMatchAlternative { ingredientId: string; name?: string; confidence: number; }
export interface IngredientMatchResult { ingredientId?: string; confidence: number; alternatives: IngredientMatchAlternative[]; }
export interface IngredientMatcher { match(name: string): IngredientMatchResult; }

export interface BuildDraftDeps {
  parser: IngredientParser;
  matcher: IngredientMatcher;
  /** Confidence below this => low_confidence. Default 0.7. */
  lowConfidenceThreshold?: number;
  /** Match confidence below this => ingredient match flagged. Default 0.6. */
  matchThreshold?: number;
  now?: () => Date;
}

export interface BuildDraftOptions {
  /** Title typed by the user; if absent the AI title becomes a proposal. */
  userTitle?: string;
  /** Storage refs of the uploaded page images, in page order. */
  sourceImageRefs?: string[];
  /** Source/attribution text (e.g. a recipe card owner). */
  source?: string;
}

export interface DraftIngredient {
  key: string; // stable id within the draft (used by edits)
  originalText: string;
  name: Field<string>;
  quantity: Field<Quantity>;
  preparation?: string;
  optional: boolean;
  ingredientId: Field<string | undefined>;
  matchAlternatives: IngredientMatchAlternative[];
  confidence: number;
  /** Non-optional line whose cost can't be computed without a usable quantity. */
  affectsCost: boolean;
}

export interface DraftStep { key: string; text: string; edited?: boolean; }

export type IssueCode =
  | 'missing_title' | 'no_ingredients' | 'no_steps' | 'ingredient_unparsed_quantity'
  | 'missing_servings' | 'unmatched_ingredient' | 'parse_disagreement' | 'low_confidence';
export interface DraftIssue { code: IssueCode; blocking: boolean; message: string; ingredientKey?: string; }

export interface RecipeDraft {
  title: Field<string>;
  titleProposed: boolean;
  description?: string;
  servings: Field<number | undefined>;
  prepMinutes?: number;
  cookMinutes?: number;
  tags: string[];
  cuisine?: string;
  ingredients: DraftIngredient[];
  steps: DraftStep[];
  warnings: string[];
  issues: DraftIssue[];
  source?: string;
  sourceImageRefs: string[];
  /** Raw extraction(s) as received, for RecipeVersion.original. */
  original: RecipeExtraction | { pages: RecipeExtraction[] };
  extractedAt: string;
}

export interface RecipeSummary { id: string; title: string; ingredientNames?: string[]; ingredientIds?: string[]; }
