import { randomUUID } from 'node:crypto';
import type { AiProvider, HouseholdContext } from '@fr/ai';
import { PlanConstraintsSchema, PlanRequestSchema } from '@fr/domain';
import type {
  Candidate, CostService, ExclusionResolver, Household, HouseholdRepo, MealPlan, MealRef, ParsedPlanRequest, PlanConstraints, PlanEdits,
  PlannedMeal, PlanProposal, PlanRequest, PlanSlot, PlanSolver, ProposalStore, RecipeGap, RecipeRepo, Result, ShoppingRequirement,
  UnmetConstraint, Member, BusyResolution,
} from './types.js';

export interface OrchestratorDeps {
  ai: AiProvider; solver: PlanSolver; households: HouseholdRepo; recipes: RecipeRepo;
  costs: CostService; proposals: ProposalStore;
  /** Names -> ingredient ids / UK-14 groups (refdata catalogue). Omitted = name-only exclusions. */
  resolveExclusions?: ExclusionResolver;
  /** Busy evenings for the plan's dates (P2-C, D413): quick-meal and skip dates, resolved by the server. Omitted = none. */
  busy?: (householdId: string, weekStart: string, dates: string[]) => Promise<BusyResolution>;
  newId?: () => string; now?: () => Date;
}

const norm = (s: string) => s.trim().toLowerCase();
const uniq = (xs: string[]) => [...new Set(xs.map(norm).filter(Boolean))];

const householdExclusions = (hh: Household): string[] => uniq(hh.hardExclusions.map((x) => x.ingredientName));

/** Canonical constraints from the AI -> the editable request (household defaults filled in; server-only fields dropped). */
function toRequest(c: PlanConstraints, hh: Household): PlanRequest {
  const own = new Set(householdExclusions(hh));
  const fields = {
    days: c.days, mealTypes: c.mealTypes, servings: c.servings ?? hh.defaultServings, budgetPence: c.budgetPence ?? hh.weeklyBudgetPence,
    dietProportions: c.dietProportions, excludeDietCategories: c.excludeDietCategories, includeTags: c.includeTags,
    excludeAllergens: c.excludeAllergens,
    // household exclusions are shown separately (locked), not as editable request terms
    excludeTerms: c.excludeTerms.filter((t) => !own.has(norm(t))),
    favouritesOf: c.favouritesOf, quickMeals: c.quickMeals,
  };
  return PlanRequestSchema.parse(Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)));
}

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

/** Members who dislike something in this recipe (name, canonical name or unmatched line contains one of their terms). Soft only. */
export function dislikedByMembers(c: Pick<Candidate, 'ingredientNames' | 'canonicalNames' | 'unmatchedLines'>, members: readonly Member[]): string[] {
  const names = [...c.ingredientNames, ...(c.canonicalNames ?? []), ...(c.unmatchedLines ?? [])];
  return members.filter((m) => (m.dislikes?.length ?? 0) > 0 && violatesExclusions(names, m.dislikes!).length > 0).map((m) => m.id);
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
   * Step 1 (the ONLY AI call, D133): prompt -> the editable PlanRequest, nothing solved yet.
   * Data minimisation choice: the AI sees ONLY the prompt plus
   *  - non-sensitive defaults (servings, weekly budget) and the plan start date,
   *  - display names of members whose first name literally appears in the prompt,
   *  - the tag vocabulary.
   * It never sees recipes, allergies/exclusions (health data) or unrelated member names.
   * Hard exclusions are re-imposed server-side from the DB, so the AI does not need them.
   */
  async parseRequest(householdId: string, prompt: string, weekStart: string): Promise<Result<ParsedPlanRequest>> {
    const hh = await this.d.households.getHousehold(householdId);
    if (!hh) return { ok: false, error: { code: 'HOUSEHOLD_NOT_FOUND', userMessage: 'We could not find that household.' } };

    const lower = norm(prompt);
    const mentioned = hh.members.filter((m) => lower.includes(norm(m.displayName).split(/\s+/)[0] ?? '\u0000'));
    const tags = await this.d.recipes.tagVocabulary(householdId);
    const context: HouseholdContext = {
      startDate: weekStart, defaultServings: hh.defaultServings, weeklyBudgetPence: hh.weeklyBudgetPence,
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

    const request = toRequest(parsed, hh);
    const busy = await this.busyFor(householdId, weekStart, request.days ?? 7);
    return { ok: true, value: { prompt, weekStart, request, householdExclusions: householdExclusions(hh), unmet: this.resolveFavourites(hh, request.favouritesOf).unmet, ...(busy.days.length ? { busy: busy.days } : {}) } };
  }

  /**
   * Step 2 (no AI): solve a PlanRequest the user has reviewed or edited. The request is untrusted input: it is
   * re-validated, household hard exclusions are re-imposed whatever it says, and names are resolved to ids here.
   */
  async solveRequest(householdId: string, input: { prompt: string; weekStart: string; request: unknown }): Promise<Result<PlanProposal>> {
    const hh = await this.d.households.getHousehold(householdId);
    if (!hh) return { ok: false, error: { code: 'HOUSEHOLD_NOT_FOUND', userMessage: 'We could not find that household.' } };
    const checked = PlanRequestSchema.safeParse(input.request);
    if (!checked.success) {
      return { ok: false, error: { code: 'INVALID_REQUEST', userMessage: 'Some of the plan settings are not valid. Please check them and try again.', issues: checked.error.issues.map((i) => `${i.path.join('.') || 'request'}: ${i.message}`) } };
    }
    const request = checked.data;
    const { weekStart, prompt } = input;

    // merge defaults + re-impose hard exclusions from DB regardless of what the request says
    const dbExclusions = householdExclusions(hh);
    const requested = uniq(request.excludeTerms);
    const reimposedExclusions = dbExclusions.filter((x) => !requested.includes(x));

    // favourites
    const { unmet, memberIds, memberLabels } = this.resolveFavourites(hh, request.favouritesOf);
    const favRecipes = new Map<string, string[]>();
    for (const id of memberIds) {
      const recipeIds = await this.d.households.getFavouriteRecipeIds(householdId, id);
      if (recipeIds.length === 0) unmet.push({ kind: 'no_favourites', detail: `${memberLabels[id] ?? id} has no saved favourites yet.` });
      for (const rid of recipeIds) favRecipes.set(rid, [...(favRecipes.get(rid) ?? []), id]);
    }

    // Busy evenings (manual toggles, device calendar, ICS): server-owned, applied whatever the request says. They add quick-meal
    // dates (keeping the request's own minutes / strictness) and skip the dinner on evenings with almost no free time.
    const planDays = request.days ?? 7;
    const busy = await this.busyFor(householdId, weekStart, planDays);
    const dinnerPlanned = request.mealTypes.includes('dinner');
    const quickDates = [...new Set([...(request.quickMeals?.dates ?? []), ...busy.quickDates])];
    const quickMeals = busy.quickDates.length || request.quickMeals
      ? { dates: quickDates, weekdays: request.quickMeals?.weekdays ?? [], maxTotalMinutes: request.quickMeals?.maxTotalMinutes ?? 30, strict: request.quickMeals?.strict ?? false }
      : undefined;
    const skip = dinnerPlanned ? busy.skipDates.map((date) => ({ date, mealType: 'dinner' as const, reason: 'other' as const, note: 'Busy evening' })) : [];

    const terms = uniq([...requested, ...dbExclusions]);
    const resolved = this.d.resolveExclusions?.({ terms, allergens: uniq(request.excludeAllergens) });
    const servings = request.servings;
    const constraints: PlanConstraints = PlanConstraintsSchema.parse({
      ...request,
      startDate: weekStart,
      days: request.days ?? 7,
      budgetPence: request.budgetPence ?? hh.weeklyBudgetPence,
      excludeTerms: terms,
      excludeAllergens: resolved?.excludeAllergens ?? uniq(request.excludeAllergens),
      excludeIngredientIds: resolved?.excludeIngredientIds ?? [],
      allergenGroups: resolved?.allergenGroups ?? {},
      // Unmatched ingredient lines are checked against the terms; with exclusions set they are otherwise unverifiable.
      allowUnverifiedIngredients: false,
      favouritesOf: memberIds,
      ...(quickMeals ? { quickMeals } : {}),
      skip,
    });
    const days = constraints.days ?? 7;

    // candidates: hard filter in repo AND re-filtered here, before anything else
    const raw = await this.d.recipes.searchCandidates(householdId, {
      excludeIngredients: terms, mealTypes: constraints.mealTypes, includeTags: constraints.includeTags,
    });
    const candidates: Candidate[] = raw
      .filter((c) => violatesExclusions(c.ingredientNames, terms).length === 0)
      // "Don't suggest again" (P1-A): a soft hide, so only proposals skip it; the user can still place the recipe by hand.
      .filter((c) => c.dontSuggest !== true)
      .map((c) => ({ ...c, favouriteOf: favRecipes.get(c.id), dislikedBy: dislikedByMembers(c, hh.members) }));

    const brief = { tags: constraints.includeTags, excludeIngredients: terms };
    if (candidates.length === 0) {
      const gaps = this.allGaps(weekStart, days, constraints, brief, 'No saved recipe satisfies your constraints.');
      return { ok: false, error: {
        code: 'NO_VIABLE_CANDIDATES',
        userMessage: 'No saved recipes match this request. Try relaxing a constraint or add some recipes; we can suggest new ones to fill the gaps.',
        constraints, unmet, gaps,
      } };
    }

    // costs (unknown stays null, never 0)
    const costs = await this.d.costs.costRecipes(householdId, candidates.map((c) => c.id), servings);
    for (const c of candidates) c.costPence = costs[c.id] ?? null;

    // Names for the report: members who have dislikes are labelled too (ids never reach a user-facing sentence).
    const labelled = { ...Object.fromEntries(hh.members.filter((m) => m.dislikes?.length).map((m) => [m.id, m.displayName])), ...memberLabels };
    const res = await this.d.solver.solve(constraints, candidates, { weekStart, servings, memberLabels: labelled });
    for (const r of res.report) if (!r.met) unmet.push({ kind: 'solver', detail: `${r.constraint}: ${r.detail}` });
    const gaps: RecipeGap[] = res.slots.filter((s) => s.recipeId === null).map((s) => ({
      date: s.date, mealType: s.mealType, reason: s.note ?? 'No suitable saved recipe for this slot.', suggestionBrief: brief,
    }));

    const proposal: PlanProposal = {
      id: this.newId(), status: 'proposed', householdId, weekStart, prompt, constraints, request, reimposedExclusions,
      ...(busy.days.length ? { busyApplied: busy.days } : {}),
      slots: res.slots, explanations: res.explanations, unmet, report: res.report, gaps,
      ...(res.ideas?.length ? { ideas: res.ideas } : {}),
      totalCostPence: res.totalCostPence, uncostedMeals: res.uncostedMeals, createdAt: this.now().toISOString(),
    };
    await this.d.proposals.save(proposal);
    return { ok: true, value: proposal };
  }

  /** Prompt -> proposal in one go (parse with the AI, then solve). */
  async proposePlan(householdId: string, prompt: string, weekStart: string): Promise<Result<PlanProposal>> {
    const parsed = await this.parseRequest(householdId, prompt, weekStart);
    if (!parsed.ok) return parsed;
    return this.solveRequest(householdId, { prompt, weekStart, request: parsed.value.request });
  }

  private async busyFor(householdId: string, weekStart: string, days: number): Promise<BusyResolution> {
    const none: BusyResolution = { quickDates: [], skipDates: [], days: [] };
    if (!this.d.busy) return none;
    try {
      return await this.d.busy(householdId, weekStart, Array.from({ length: days }, (_, i) => addDays(weekStart, i)));
    } catch {
      return none; // advisory input: a failure never blocks a plan
    }
  }

  /** Member display names (as the AI / the chips give them) -> member ids; unknown and ambiguous names are reported, never guessed. */
  private resolveFavourites(hh: Household, names: string[]): { unmet: UnmetConstraint[]; memberIds: string[]; memberLabels: Record<string, string> } {
    const unmet: UnmetConstraint[] = [];
    const memberIds: string[] = [];
    const memberLabels: Record<string, string> = {};
    for (const name of names) {
      const r = resolveMember(name, hh.members);
      if (r.status === 'unknown') {
        unmet.push({ kind: 'member_unknown', detail: `We could not find a household member called "${name}", so their favourites were not used.` });
      } else if (r.status === 'ambiguous') {
        unmet.push({ kind: 'member_ambiguous', detail: `"${name}" matches more than one member (${r.matches.map((m) => m.displayName).join(', ')}). Please say which one.` });
      } else if (!memberIds.includes(r.member.id)) {
        memberIds.push(r.member.id);
        memberLabels[r.member.id] = r.member.displayName;
      }
    }
    return { unmet, memberIds, memberLabels };
  }

  private allGaps(weekStart: string, days: number, c: PlanConstraints, brief: RecipeGap['suggestionBrief'], reason: string): RecipeGap[] {
    const out: RecipeGap[] = [];
    for (let i = 0; i < days; i++) for (const mealType of c.mealTypes) out.push({ date: addDays(weekStart, i), mealType, reason, suggestionBrief: brief });
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
      const hits = violatesExclusions(r.ingredientNames, p.constraints.excludeTerms);
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
      id: planId, householdId, startDate: p.weekStart, endDate: addDays(p.weekStart, (p.constraints.days ?? 7) - 1),
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
