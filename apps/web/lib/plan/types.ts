// Client-safe plan types (no server imports). Shared by the planner UI and the server actions.
import type { NutrientMap } from '@fr/engine/nutrition';
import type { PlanProposal } from '@fr/plan-orchestrator';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const MEAL_LABEL: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

export type DietCategory = 'meat' | 'fish' | 'vegetarian' | 'vegan';

export type PlanEntry =
  | { kind: 'recipe'; recipeId: string; servings: number; note?: string }
  | { kind: 'eating_out'; note?: string }
  | { kind: 'leftovers'; note?: string };

export interface SlotRef {
  date: string;
  mealType: MealType;
}

/** A saved/in-progress plan for one week. Keys are `${date}|${mealType}`. */
export interface PlanDoc {
  id: string;
  householdId: string;
  weekStart: string;
  mealTypes: MealType[];
  entries: Record<string, PlanEntry>;
  status: 'draft' | 'approved';
  budgetPence?: number;
  prompt?: string;
  /** Set when the grid was filled from an AI proposal that has not yet been approved. */
  proposalId?: string;
  updatedAt: string;
}

export interface RecipeLite {
  id: string;
  title: string;
  dietCategory?: DietCategory;
  tags: string[];
  mealTypes: MealType[];
  baseServings: number;
  totalMinutes?: number;
  /** null = unknown; never 0. */
  costPerServingPence: number | null;
  costKind: 'estimate' | null;
  /** true when some of the recipe's ingredients are unpriced, so the cost is a lower bound. */
  costPartial?: boolean;
  /** Calculated per-serving nutrition (CoFID, D61); null/undefined = not calculated. Unknown values stay unknown. */
  nutritionPerServing?: NutrientMap | null;
  /** Household hard exclusions this recipe hits (blocks planning it). */
  excludedBy: string[];
}

export interface PlanPageData {
  doc: PlanDoc;
  isSaved: boolean;
  recipes: RecipeLite[];
  saved: { id: string; weekStart: string; status: 'draft' | 'approved' }[];
  householdExclusions: string[];
  defaultServings: number;
  examplePrompt: string;
}

export type ActionResult<T> = { ok: true; value: T } | { ok: false; message: string; violations?: string[] };

export interface ProposeFailure {
  message: string;
  code: string;
  gaps?: { date: string; mealType: MealType; reason: string }[];
  unmet?: { kind: string; detail: string }[];
}
export type ProposeResult = { ok: true; proposal: PlanProposal } | ({ ok: false } & ProposeFailure);
