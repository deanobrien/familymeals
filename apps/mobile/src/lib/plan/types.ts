// App-side types for the planner JSON contract (apps/web /api/plan, D341). The app never imports @fr/ai or
// @fr/plan-orchestrator at runtime, so the shapes are declared here and every server payload is parsed defensively
// (see src/lib/planApi.ts): unknown or malformed parts are dropped, never trusted.
import type { NutrientMap, RecipeGoalProfile, RecipeVarietyProfile } from '@fr/engine/nutrition';

export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export const MEAL_TYPES: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const MEAL_LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack' };
export type DietCategory = 'meat' | 'fish' | 'vegetarian' | 'vegan';

export type PlanEntry =
  | { kind: 'recipe'; recipeId: string; servings: number; note?: string }
  | { kind: 'eating_out'; note?: string }
  /** With `batchId` a stored leftover / freezer batch (P2-C, D417): `portions` leave the ledger when it is eaten. */
  | { kind: 'leftovers'; note?: string; batchId?: string; portions?: number };

export interface SlotRef { date: string; mealType: MealType }

/** One week. Entry keys are `${date}|${mealType}`. */
export interface PlanDoc {
  id: string;
  householdId: string;
  weekStart: string;
  mealTypes: MealType[];
  entries: Record<string, PlanEntry>;
  status: 'draft' | 'approved';
  budgetPence?: number;
  prompt?: string;
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
  costPartial?: boolean;
  nutritionPerServing?: NutrientMap | null;
  /** Per-serving fruit/veg portions, plants and protein kinds (estimate, D376); absent = server did not send it. */
  variety?: RecipeVarietyProfile | null;
  /** Oily fish portions and red / processed meat grams per serving (P3-B, D435); recipe data, not personal data. */
  goals?: RecipeGoalProfile | null;
  /** Household hard exclusions this recipe hits (it cannot be planned). */
  excludedBy: string[];
}

export interface PlanPage {
  doc: PlanDoc;
  isSaved: boolean;
  recipes: RecipeLite[];
  saved: { id: string; weekStart: string; status: 'draft' | 'approved' }[];
  householdExclusions: string[];
  defaultServings: number;
  examplePrompt: string;
  memberNames: string[];
  /** Soft dislikes per member (P1-B, D378): read-only chips; edited in Settings. */
  memberDislikes?: { memberName: string; terms: string[] }[];
  /** Meals cooked this week (cooking log, P1-A); absent until that data exists. */
  cooked?: { date: string; recipeId: string }[];
  /** Allergy exclusions withheld for lack of consent: drives the consent notice (D242). */
  withheldExclusions: number;
  /** Busy evenings this week (manual toggles + calendars): derived flags only (P2-C, D410). */
  busy: BusyDay[];
  /** Stored leftover batches and slot suggestions (P2-C, D416). */
  leftovers: LeftoversView;
  /** Slots (key `date|mealType`) whose leftover portions have been marked eaten. */
  eatenSlots: string[];
}

/** One busy evening, merged across sources. */
export interface BusyDay {
  date: string;
  sources: string[];
  /** null = unknown (manual toggle only). */
  minutesAvailable: number | null;
  skip: boolean;
  label: string;
}

export type StoredIn = 'fridge' | 'freezer';
export interface BatchView {
  id: string;
  title: string;
  storedIn: StoredIn;
  portionsMade: number;
  portionsLeft: number;
  portionsPlanned: number;
  portionsFree: number;
  cookedOn: string;
  useBy: string;
  status: 'ok' | 'use_soon' | 'past_use_by';
  useByLabel: string;
}
export interface LeftoverSuggestion {
  batchId: string;
  title: string;
  storedIn: StoredIn;
  portions: number;
  date: string;
  mealType: MealType;
  label: string;
  reason: string;
}
export interface LeftoversView {
  batches: BatchView[];
  suggestions: LeftoverSuggestion[];
  titles: Record<string, string>;
}

/** A busy evening the plan honoured (parse step and proposal). */
export interface BusyApplied { date: string; skip: boolean; minutesAvailable: number | null; sources: string[] }

/** The editable, AI-facing reading of a prompt (the web's PlanRequest). Unknown extra keys survive a round trip. */
export type DietTarget = { fraction: number } | { count: number } | { min?: number; max?: number };
export interface PlanRequest {
  days?: number;
  mealTypes: MealType[];
  servings: number;
  budgetPence?: number;
  dietProportions?: Partial<Record<DietCategory, DietTarget>>;
  excludeDietCategories: DietCategory[];
  includeTags: string[];
  excludeAllergens: string[];
  excludeTerms: string[];
  favouritesOf: string[];
  quickMeals?: { dates: string[]; weekdays: string[]; maxTotalMinutes: number; strict: boolean };
  [extra: string]: unknown;
}

export interface ParsedRequest {
  prompt: string;
  weekStart: string;
  request: PlanRequest;
  /** Household hard exclusions: always applied, shown locked. */
  householdExclusions: string[];
  /** Problems already known (unknown or ambiguous member names). */
  notes: string[];
  /** Busy evenings the solve will honour (P2-C). */
  busy: BusyApplied[];
}

export interface ProposalSlot { date: string; mealType: MealType; recipeId: string | null; servings: number; note?: string }
export interface IdeaNeed {
  reason: string;
  count: number;
  criteria: { dietCategory?: DietCategory; mealType?: MealType; maxTotalMinutes?: number; maxCostPerServingPence?: number };
}
export interface Proposal {
  id: string;
  prompt: string;
  weekStart: string;
  mealTypes: MealType[];
  budgetPence?: number;
  slots: ProposalSlot[];
  reimposedExclusions: string[];
  explanations: string[];
  unmet: { kind: string; detail: string }[];
  report: { constraint: string; met: boolean; detail: string }[];
  gaps: { date: string; mealType: MealType; reason: string }[];
  ideas: IdeaNeed[];
  /** null = unknown, never 0. */
  totalCostPence: number | null;
  uncostedMeals: string[];
  request?: PlanRequest;
  /** Busy evenings applied as quick-meal / skip constraints (P2-C). */
  busyApplied: BusyApplied[];
}

export interface ShoppingHandoff { count: number; href: string; preview: { name: string; quantity: string }[] }

export interface IdeaCard {
  id: string;
  title: string;
  area?: string;
  category?: string;
  diet: 'meat' | 'fish' | 'vegetarian' | 'vegan';
  dietNote: string;
  ingredients: { name: string; measure: string }[];
  steps: string[];
  publisher: string;
}
export interface IdeasResult { cards: IdeaCard[]; withheld: number; sourceLabel: string }
