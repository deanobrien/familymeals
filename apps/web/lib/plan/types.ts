// Client-safe plan types (no server imports). Shared by the planner UI and the server actions.
import type { NutrientMap, RecipeGoalProfile, RecipeVarietyProfile } from '@fr/engine/nutrition';
import type { BusyDayView } from '../calendar/types';
import type { LeftoversView } from '../leftovers/types';
import type { ParsedPlanRequest, PlanProposal } from '@fr/plan-orchestrator';

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
  /** A leftovers night. With `batchId` it is a stored batch (P2-C, D417): `portions` come out of the ledger when eaten; no shopping. */
  | { kind: 'leftovers'; note?: string; batchId?: string; portions?: number };

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
  /** Per-serving fruit/veg portions, plants and protein kinds (estimate, D376); absent = not computed. */
  variety?: RecipeVarietyProfile | null;
  /** Per-serving oily fish portions and red / processed meat grams (estimate, D435); recipe data, not personal data. */
  goals?: RecipeGoalProfile | null;
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
  /** Soft dislikes per member (P1-B, D378), shown as read-only chips; edited in Settings. Never allergies. */
  memberDislikes?: { memberName: string; terms: string[] }[];
  /** Meals cooked this week (cooking log, P1-A). Absent until that data exists: the variety panel then shows planned meals only. */
  cooked?: { date: string; recipeId: string }[];
  /** Household member display names (the choices for the "favourites of" chip). */
  memberNames: string[];
  /** Busy evenings this week (manual toggles + calendars), derived flags only (P2-C, D410). */
  busy?: BusyDayView[];
  /** Stored leftover batches and slot suggestions (P2-C, D416). */
  leftovers?: LeftoversView;
  /** Plan slots (key `date|mealType`) whose leftover portions have been marked eaten. */
  eatenSlots?: string[];
}

export type ActionResult<T> = { ok: true; value: T } | { ok: false; message: string; violations?: string[] };

export interface ProposeFailure {
  message: string;
  code: string;
  gaps?: { date: string; mealType: MealType; reason: string }[];
  unmet?: { kind: string; detail: string }[];
}
/** Step 1 of the prompt flow (the AI call): the editable reading of the prompt, nothing solved yet. */
export type ParseResult = { ok: true; parsed: ParsedPlanRequest } | ({ ok: false } & ProposeFailure);
export type ProposeResult = { ok: true; proposal: PlanProposal } | ({ ok: false } & ProposeFailure);
