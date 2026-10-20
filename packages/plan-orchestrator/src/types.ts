import type { PlanConstraints, PlanRequest } from '@fr/domain';

/** The ONE canonical constraints schema (D130) and its editable, LLM-facing subset (D131). */
export type { PlanConstraints, PlanRequest };
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export type IsoDate = string;
export type Pence = number;

// ---------- data access (injected) ----------
export interface HardExclusion { ingredientName: string; kind: 'allergy' | 'dietary' | 'dislike'; }
export interface Member {
  id: string;
  displayName: string;
  /** Soft dislikes (lower-case terms): penalised by the solver, never excluded, never sent to the AI (P1-B, D378). */
  dislikes?: string[];
}
export interface Household {
  id: string;
  defaultServings?: number;
  weeklyBudgetPence?: number;
  /** Household-level hard exclusions (health data: never sent to the AI). */
  hardExclusions: HardExclusion[];
  members: Member[];
}
export interface HouseholdRepo {
  getHousehold(householdId: string): Promise<Household | null>;
  /** Recipe ids marked favourite by this member. */
  getFavouriteRecipeIds(householdId: string, memberId: string): Promise<string[]>;
}

export interface Candidate {
  id: string;
  title: string;
  ingredientNames: string[];
  tags: string[];
  mealTypes: MealType[];
  dietCategory?: 'meat' | 'fish' | 'vegetarian' | 'vegan';
  totalMinutes?: number;
  /** Member ids who favourite this recipe (set by orchestrator; matched against PlanConstraints.favouritesOf). */
  favouriteOf?: string[];
  /** Member ids who dislike something in this recipe (soft; set by the orchestrator from Member.dislikes). */
  dislikedBy?: string[];
  /** Canonical ingredient ids of the matched lines (unmatched lines are absent). */
  ingredientIds?: string[];
  /** Names + aliases of the matched canonical ingredients (secondary term safety net). */
  canonicalNames?: string[];
  /** Original text of ingredient lines with no canonical match (still checked against excluded terms). */
  unmatchedLines?: string[];
  /** UK-14 allergen groups derived from the matched ingredient ids. */
  allergens?: string[];
  /** Cost at the plan servings; null/undefined = unknown (never 0). */
  costPence?: Pence | null;
}
export interface CandidateFilter {
  excludeIngredients: string[];
  mealTypes: MealType[];
  includeTags: string[];
}
export interface RecipeRepo {
  tagVocabulary(householdId: string): Promise<string[]>;
  /** Must apply excludeIngredients as a hard filter in the query. Orchestrator re-filters defensively. */
  searchCandidates(householdId: string, filter: CandidateFilter): Promise<Candidate[]>;
  getRecipes(householdId: string, ids: string[]): Promise<Candidate[]>;
}

export interface MealRef { recipeId: string; servings: number; date: IsoDate; mealType: MealType; plannedMealId: string; }
export interface ShoppingRequirement { displayName: string; ingredientId?: string; quantityText: string; contributions: { recipeId: string; plannedMealId: string }[]; }
export interface CostService {
  /** Cost of cooking each recipe at `servings`; null = unknown. */
  costRecipes(householdId: string, recipeIds: string[], servings: number): Promise<Record<string, Pence | null>>;
  /** Only called from confirmShopping. */
  buildRequirements(householdId: string, meals: MealRef[]): Promise<ShoppingRequirement[]>;
}

// ---------- solver (injected; implemented by L9) ----------
export interface PlanSlot {
  date: IsoDate;
  mealType: MealType;
  /** null = unfilled (eating out / no viable recipe / needs new suggestion). */
  recipeId: string | null;
  servings: number;
  note?: string;
}
export interface ConstraintReportItem { constraint: string; met: boolean; detail: string; }
export interface SolveOptions {
  weekStart: IsoDate;
  servings: number;
  /** Member id -> display name, for explanations. */
  memberLabels?: Record<string, string>;
}

/**
 * Resolves exclusion NAMES to canonical data (refdata catalogue): free-text terms and allergen names become
 * ingredient ids and UK-14 allergen groups. Injected so the orchestrator stays pure; omitted = name-only matching.
 */
export interface ExclusionResolution {
  excludeIngredientIds: string[];
  allergenGroups: Record<string, string[]>;
  /** Allergen names to enforce (the requested ones plus any terms recognised as UK-14 groups). */
  excludeAllergens: string[];
}
export type ExclusionResolver = (input: { terms: string[]; allergens: string[] }) => ExclusionResolution;
export interface SolveResult {
  slots: PlanSlot[];
  report: ConstraintReportItem[];
  explanations: string[];
  totalCostPence: Pence | null;
  uncostedMeals: string[];
  /** Where the library cannot meet the request (engine gap suggestions): what kind of new recipe would help. */
  ideas?: RecipeIdeaNeed[];
}
export interface ValidationResult { ok: boolean; violations: string[]; }
export interface PlanSolver {
  solve(constraints: PlanConstraints, candidates: Candidate[], opts: SolveOptions): SolveResult | Promise<SolveResult>;
  validate(plan: { slots: PlanSlot[] }, constraints: PlanConstraints): ValidationResult | Promise<ValidationResult>;
}

// ---------- proposals ----------
export interface UnmetConstraint { kind: 'solver' | 'member_unknown' | 'member_ambiguous' | 'no_favourites'; detail: string; }
/** A need for new recipes (D171): criteria only, never ingredient ids or allergen lists (those are re-derived server-side). */
export interface RecipeIdeaNeed {
  reason: string;
  count: number;
  criteria: { dietCategory?: 'meat' | 'fish' | 'vegetarian' | 'vegan'; mealType?: MealType; maxTotalMinutes?: number; maxCostPerServingPence?: number };
}
export interface RecipeGap { date: IsoDate; mealType: MealType; reason: string; suggestionBrief: { tags: string[]; excludeIngredients: string[] }; }

export interface PlanProposal {
  id: string;
  status: 'proposed';
  householdId: string;
  weekStart: IsoDate;
  prompt: string;
  /** The canonical constraints the solver ran with (server-resolved ids, dates, member ids). */
  constraints: PlanConstraints;
  /** The editable request behind them (what the chips show); re-solving takes this, not a new AI call. */
  request: PlanRequest;
  /** Hard exclusions the AI omitted that the server re-imposed (transparency). */
  reimposedExclusions: string[];
  slots: PlanSlot[];
  explanations: string[];
  unmet: UnmetConstraint[];
  report: ConstraintReportItem[];
  gaps: RecipeGap[];
  /** Optional (D171): shortfalls the library cannot meet, each a candidate for "Find ideas". */
  ideas?: RecipeIdeaNeed[];
  totalCostPence: Pence | null;
  uncostedMeals: string[];
  createdAt: string;
}
export interface ProposalStore {
  save(p: PlanProposal): Promise<void>;
  get(id: string): Promise<PlanProposal | null>;
  markApproved(id: string): Promise<void>;
}

export interface MealPlan {
  id: string; householdId: string; startDate: IsoDate; endDate: IsoDate;
  budgetPence?: Pence; prompt: string; status: 'approved';
}
export interface PlannedMeal {
  id: string; mealPlanId: string; date: IsoDate; mealType: MealType;
  recipeId: string; servings: number; costPence: Pence | null;
}

export type OrchestratorError =
  | { code: 'AI_UNAVAILABLE'; userMessage: string; prompt: string }
  | { code: 'HOUSEHOLD_NOT_FOUND'; userMessage: string }
  | { code: 'NO_VIABLE_CANDIDATES'; userMessage: string; constraints: PlanConstraints; unmet: UnmetConstraint[]; gaps: RecipeGap[] }
  | { code: 'PROPOSAL_NOT_FOUND'; userMessage: string }
  | { code: 'INVALID_REQUEST'; userMessage: string; issues: string[] }
  | { code: 'VALIDATION_FAILED'; userMessage: string; violations: string[] };

export type Result<T> = { ok: true; value: T } | { ok: false; error: OrchestratorError };

export interface SlotEdit { date: IsoDate; mealType: MealType; recipeId: string | null; servings?: number; }
export interface PlanEdits { slotEdits?: SlotEdit[]; }

/** The AI's reading of a prompt, before anything is solved (D133): the user reviews and edits it as chips. */
export interface ParsedPlanRequest {
  prompt: string;
  weekStart: IsoDate;
  request: PlanRequest;
  /** Household hard exclusions: always applied, shown locked (cannot be edited away). */
  householdExclusions: string[];
  /** Problems with the request that are already known (unknown / ambiguous member names). */
  unmet: UnmetConstraint[];
}
