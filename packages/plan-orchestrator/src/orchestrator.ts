import { randomUUID } from 'node:crypto';
import type { AiProvider, HouseholdContext } from '@fr/ai';
import type {
  Candidate, CostService, HouseholdRepo, MealPlan, MealRef, PlanConstraints, PlanEdits, PlannedMeal, PlanProposal,
  PlanSlot, PlanSolver, ProposalStore, RecipeGap, RecipeRepo, Result, ShoppingRequirement, UnmetConstraint, Member,
} from './types.js';

export interface OrchestratorDeps {
  ai: AiProvider; solver: PlanSolver; households: HouseholdRepo; recipes: RecipeRepo;
  costs: CostService; proposals: ProposalStore;
  newId?: () => string; now?: () => Date;
}

const norm = (s: string) => s.trim().toLowerCase();
const uniq = (xs: string[]) => [...new Set(xs.map(norm).filter(Boolean))];

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Returns the exclusions hit (case-insensitive substring, singular-stemmed so "mushrooms" hits "chestnut mushroom"). */
export function violatesExclusions(ingredientNames: string[], exclusions: string[]): string[] {
  const hits: string[] = [];
  for (const ex of exclusions.map(norm)) {
    const stem = ex.replace(/e?s$/, '');
    const hit = ingredientNames.some((i) => {
      const n = norm(i);
      return n.includes(ex) || (stem.length > 2 && n.includes(stem));
    });
    if (hit) hits.push(ex);
  }
  return hits;
}

export type MemberResolution =
  | { name: string; status: 'ok'; member: Member }
  | { name: string; status: 'unknown' }
  | { name: string; status: 'ambiguous'; matches: Member[] };

/** Resolve by exact display name first, then by first name; >1 hit = ambiguous (never guess). */
export function resolveMember(name: string, members: Member[]): MemberResolution {
  const n = norm(name).replace(/('|’)s$/, '');
  const exact = members.filter((m) => norm(m.displayName) === n);
  if (exact.length === 1) return { name, status: 'ok', member: exact[0]! };
  if (exact.length > 1) return { name, status: 'ambiguous', matches: exact };
  const partial = members.filter((m) => norm(m.displayName).split(/\s+/)[0] === n);
  if (partial.length === 1) return { name, status: 'ok', member: partial[0]! };
  if (partial.length > 1) return { name, status: 'ambiguous', matches: partial };
  return { name, status: 'unknown' };
}

export class PlanOrchestrator {
  private readonly newId: () => string;
  private readonly now: () => Date;
  constructor(private readonly d: OrchestratorDeps) {
    this.newId = d.newId ?? randomUUID;
    this.now = d.now ?? (() => new Date());
  }

  /**
   * Data minimisation choice: the AI sees ONLY the prompt plus
   *  - non-sensitive defaults (servings, weekly budget),
   *  - display names of members whose first name literally appears in the prompt,
   *  - the tag vocabulary.
   * It never sees recipes, allergies/exclusions (health data) or unrelated member names.
   * Hard exclusions are re-imposed server-side from the DB, so the AI does not need them.
   */
  async proposePlan(householdId: string, prompt: string, weekStart: string): Promise<Result<PlanProposal>> {
    const hh = await this.d.households.getHousehold(householdId);
    if (!hh) return { ok: false, error: { code: 'HOUSEHOLD_NOT_FOUND', userMessage: 'We could not find that household.' } };

    const lower = norm(prompt);
    const mentioned = hh.members.filter((m) => lower.includes(norm(m.displayName).split(/\s+/)[0] ?? '\u0000'));
    const tags = await this.d.recipes.tagVocabulary(householdId);
    const context: HouseholdContext = {
      defaultServings: hh.defaultServings, weeklyBudgetPence: hh.weeklyBudgetPence,
      memberNames: mentioned.map((m) => m.displayName), availableTags: tags,
    };

    let parsed: PlanConstraints;
    try {
      parsed = await this.d.ai.parsePlanPrompt(prompt, context, { householdId });
    } catch (e) {
      const userMessage = (e as { userMessage?: string }).userMessage
        ?? 'We could not process your planning request right now. Your prompt has been kept; please try again.';
      return { ok: false, error: { code: 'AI_UNAVAILABLE', userMessage, prompt } };
    }

    // merge defaults + re-impose hard exclusions from DB regardless of AI output
    const dbExclusions = uniq(hh.hardExclusions.map((x) => x.ingredientName));
    const aiExclusions = uniq(parsed.excludeIngredients ?? []);
    const constraints: PlanConstraints = {
      ...parsed,
      servings: parsed.servings ?? hh.defaultServings,
      budgetPence: parsed.budgetPence ?? hh.weeklyBudgetPence,
      excludeIngredients: uniq([...aiExclusions, ...dbExclusions]),
    };
    const reimposedExclusions = dbExclusions.filter((x) => !aiExclusions.includes(x));
    const servings = constraints.servings ?? 2;

    // favourites
    const unmet: UnmetConstraint[] = [];
    const favRecipes = new Map<string, string[]>();
    for (const name of parsed.favouritesOf ?? []) {
      const r = resolveMember(name, hh.members);
      if (r.status === 'unknown') {
        unmet.push({ kind: 'member_unknown', detail: `We could not find a household member called "${name}", so their favourites were not used.` });
      } else if (r.status === 'ambiguous') {
        unmet.push({ kind: 'member_ambiguous', detail: `"${name}" matches more than one member (${r.matches.map((m) => m.displayName).join(', ')}). Please say which one.` });
      } else {
        const ids = await this.d.households.getFavouriteRecipeIds(householdId, r.member.id);
        if (ids.length === 0) unmet.push({ kind: 'no_favourites', detail: `${r.member.displayName} has no saved favourites yet.` });
        for (const id of ids) favRecipes.set(id, [...(favRecipes.get(id) ?? []), r.member.displayName]);
      }
    }

    // candidates: hard filter in repo AND re-filtered here, before anything else
    const raw = await this.d.recipes.searchCandidates(householdId, {
      excludeIngredients: constraints.excludeIngredients, mealTypes: constraints.mealTypes, includeTags: constraints.includeTags,
    });
    const candidates: Candidate[] = raw
      .filter((c) => violatesExclusions(c.ingredientNames, constraints.excludeIngredients).length === 0)
      .map((c) => ({ ...c, favouriteOf: favRecipes.get(c.id) }));

    const brief = { tags: constraints.includeTags, excludeIngredients: constraints.excludeIngredients };
    if (candidates.length === 0) {
      const gaps = this.allGaps(weekStart, constraints, brief, 'No saved recipe satisfies your constraints.');
      return { ok: false, error: {
        code: 'NO_VIABLE_CANDIDATES',
        userMessage: 'No saved recipes match this request. Try relaxing a constraint or add some recipes; we can suggest new ones to fill the gaps.',
        constraints, unmet, gaps,
      } };
    }

    // costs (unknown stays null, never 0)
    const costs = await this.d.costs.costRecipes(householdId, candidates.map((c) => c.id), servings);
    for (const c of candidates) c.costPence = costs[c.id] ?? null;

    const res = await this.d.solver.solve(constraints, candidates, { weekStart, servings });
    for (const r of res.report) if (!r.met) unmet.push({ kind: 'solver', detail: `${r.constraint}: ${r.detail}` });
    const gaps: RecipeGap[] = res.slots.filter((s) => s.recipeId === null).map((s) => ({
      date: s.date, mealType: s.mealType, reason: s.note ?? 'No suitable saved recipe for this slot.', suggestionBrief: brief,
    }));

    const proposal: PlanProposal = {
      id: this.newId(), status: 'proposed', householdId, weekStart, prompt, constraints, reimposedExclusions,
      slots: res.slots, explanations: res.explanations, unmet, report: res.report, gaps,
      totalCostPence: res.totalCostPence, uncostedMeals: res.uncostedMeals, createdAt: this.now().toISOString(),
    };
    await this.d.proposals.save(proposal);
    return { ok: true, value: proposal };
  }

  private allGaps(weekStart: string, c: PlanConstraints, brief: RecipeGap['suggestionBrief'], reason: string): RecipeGap[] {
    const out: RecipeGap[] = [];
    for (let i = 0; i < c.days; i++) for (const mealType of c.mealTypes) out.push({ date: addDays(weekStart, i), mealType, reason, suggestionBrief: brief });
    return out;
  }

  /**
   * Re-validates hard constraints (independently of the solver from DB recipe data, and via solver.validate),
   * then returns payloads for the caller to persist. Does NOT generate shopping requirements.
   */
  async approvePlan(householdId: string, proposalId: string, edits: PlanEdits = {}): Promise<Result<{ plan: MealPlan; meals: PlannedMeal[] }>> {
    const p = await this.d.proposals.get(proposalId);
    if (!p || p.householdId !== householdId) return { ok: false, error: { code: 'PROPOSAL_NOT_FOUND', userMessage: 'That proposal no longer exists.' } };

    const slots: PlanSlot[] = p.slots.map((s) => ({ ...s }));
    for (const e of edits.slotEdits ?? []) {
      const i = slots.findIndex((s) => s.date === e.date && s.mealType === e.mealType);
      const next: PlanSlot = { date: e.date, mealType: e.mealType, recipeId: e.recipeId, servings: e.servings ?? slots[i]?.servings ?? p.constraints.servings ?? 2 };
      if (i >= 0) slots[i] = next; else slots.push(next);
    }

    const violations: string[] = [];
    const ids = [...new Set(slots.map((s) => s.recipeId).filter((x): x is string => !!x))];
    const recipes = await this.d.recipes.getRecipes(householdId, ids);
    const byId = new Map(recipes.map((r) => [r.id, r]));
    for (const id of ids) {
      const r = byId.get(id);
      if (!r) { violations.push(`Recipe ${id} was not found in this household.`); continue; }
      const hits = violatesExclusions(r.ingredientNames, p.constraints.excludeIngredients);
      if (hits.length) violations.push(`"${r.title}" contains excluded ingredient(s): ${hits.join(', ')}.`);
    }
    const v = await this.d.solver.validate({ slots }, p.constraints);
    if (!v.ok) violations.push(...v.violations);
    if (violations.length) {
      return { ok: false, error: { code: 'VALIDATION_FAILED', userMessage: 'This plan breaks a hard constraint and cannot be approved.', violations: [...new Set(violations)] } };
    }

    const servings = p.constraints.servings ?? 2;
    const costs = await this.d.costs.costRecipes(householdId, ids, servings);
    const planId = this.newId();
    const meals: PlannedMeal[] = slots
      .filter((s): s is PlanSlot & { recipeId: string } => s.recipeId !== null)
      .map((s) => ({
        id: this.newId(), mealPlanId: planId, date: s.date, mealType: s.mealType, recipeId: s.recipeId, servings: s.servings,
        costPence: costs[s.recipeId] ?? null,
      }));
    const plan: MealPlan = {
      id: planId, householdId, startDate: p.weekStart, endDate: addDays(p.weekStart, p.constraints.days - 1),
      budgetPence: p.constraints.budgetPence, prompt: p.prompt, status: 'approved',
    };
    await this.d.proposals.markApproved(proposalId);
    return { ok: true, value: { plan, meals } };
  }

  /** Step 10: only on explicit user confirmation. */
  async confirmShopping(householdId: string, meals: PlannedMeal[]): Promise<ShoppingRequirement[]> {
    const refs: MealRef[] = meals.map((m) => ({ recipeId: m.recipeId, servings: m.servings, date: m.date, mealType: m.mealType, plannedMealId: m.id }));
    return this.d.costs.buildRequirements(householdId, refs);
  }
}

export class InMemoryProposalStore implements ProposalStore {
  private m = new Map<string, PlanProposal>();
  async save(p: PlanProposal) { this.m.set(p.id, structuredClone(p)); }
  async get(id: string) { const p = this.m.get(id); return p ? structuredClone(p) : null; }
  async markApproved(id: string) { this.m.delete(id); }
}
