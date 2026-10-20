import { describe, expect, it } from 'vitest';
import type { AiProvider, HouseholdContext } from '@fr/ai';
import { PlanConstraintsSchema, type PlanConstraints } from '@fr/domain';
import {
  InMemoryProposalStore, PlanOrchestrator, addDays, resolveMember,
  type Candidate, type CostService, type Household, type HouseholdRepo, type PlanSlot, type PlanSolver, type RecipeRepo,
} from '../src/index.js';

// ---------- fakes ----------
const BRIEF_PROMPT = "Plan seven dinners for four people. Make roughly half vegetarian, include two fish meals, keep the shopping spend below £100, use Lauren's favourites where possible, avoid mushrooms and include quick meals on busy evenings.";

const aiConstraints: PlanConstraints = PlanConstraintsSchema.parse({
  startDate: '2026-10-19', days: 7, mealTypes: ['dinner'], servings: 4, budgetPence: 10000,
  dietProportions: { vegetarian: { fraction: 0.5 } }, includeTags: ['fish'], excludeTerms: ['mushrooms'],
  favouritesOf: ['Lauren'], quickMeals: { weekdays: ['mon', 'tue'], maxTotalMinutes: 30 },
});

class FakeAi implements AiProvider {
  calls: { prompt: string; ctx: HouseholdContext }[] = [];
  constructor(private out: PlanConstraints | Error) {}
  async parsePlanPrompt(prompt: string, ctx: HouseholdContext) {
    this.calls.push({ prompt, ctx });
    if (this.out instanceof Error) throw this.out;
    return structuredClone(this.out);
  }
  extractRecipe(): never { throw new Error('unused'); }
  parseReceipt(): never { throw new Error('unused'); }
  suggestTags(): never { throw new Error('unused'); }
  suggestIngredientMatches(): never { throw new Error('unused'); }
  suggestSubstitutions(): never { throw new Error('unused'); }
  scanPantry(): never { throw new Error('unused'); }
  scanShoppingList(): never { throw new Error('unused'); }
}

const recipes: Candidate[] = [
  { id: 'r1', title: 'Salmon traybake', ingredientNames: ['salmon', 'potatoes'], tags: ['fish'], mealTypes: ['dinner'], dietCategory: 'fish' },
  { id: 'r2', title: 'Veg chilli', ingredientNames: ['kidney beans', 'peppers'], tags: ['quick'], mealTypes: ['dinner'], dietCategory: 'vegetarian' },
  { id: 'r3', title: 'Mushroom risotto', ingredientNames: ['arborio rice', 'Chestnut Mushrooms'], tags: [], mealTypes: ['dinner'], dietCategory: 'vegetarian' },
  { id: 'r4', title: 'Peanut noodles', ingredientNames: ['noodles', 'peanut butter'], tags: [], mealTypes: ['dinner'], dietCategory: 'vegan' },
  { id: 'r5', title: 'Lasagne', ingredientNames: ['beef mince', 'pasta'], tags: [], mealTypes: ['dinner'], dietCategory: 'meat' },
];

const household = (over: Partial<Household> = {}): Household => ({
  id: 'h1', defaultServings: 4, weeklyBudgetPence: 12000,
  hardExclusions: [{ ingredientName: 'Peanuts', kind: 'allergy' }],
  members: [{ id: 'm1', displayName: 'Lauren Smith' }, { id: 'm2', displayName: 'Sam Smith' }, { id: 'm3', displayName: 'Sam Jones' }],
  ...over,
});

function build(opts: { ai?: AiProvider; hh?: Household | null; repoRecipes?: Candidate[]; solver?: PlanSolver } = {}) {
  const hh = opts.hh === undefined ? household() : opts.hh;
  const calls = { shopping: 0, searchFilter: undefined as unknown };
  const households: HouseholdRepo = {
    getHousehold: async () => hh,
    getFavouriteRecipeIds: async (_h, m) => (m === 'm1' ? ['r2'] : []),
  };
  // Deliberately leaky repo: ignores the exclusion filter so the orchestrator's own re-filter is proven.
  const all = opts.repoRecipes ?? recipes;
  const recipeRepo: RecipeRepo = {
    tagVocabulary: async () => ['fish', 'quick', 'vegetarian'],
    searchCandidates: async (_h, f) => { calls.searchFilter = f; return structuredClone(all); },
    getRecipes: async (_h, ids) => structuredClone(recipes.filter((r) => ids.includes(r.id))),
  };
  const costs: CostService = {
    costRecipes: async (_h, ids) => Object.fromEntries(ids.map((i) => [i, i === 'r4' ? null : 800])),
    buildRequirements: async (_h, meals) => { calls.shopping++; return [{ displayName: 'salmon', quantityText: '4 fillets', contributions: meals.map((m) => ({ recipeId: m.recipeId, plannedMealId: m.plannedMealId })) }]; },
  };
  const solver: PlanSolver = opts.solver ?? new TestSolver();
  let n = 0;
  const orch = new PlanOrchestrator({
    ai: opts.ai ?? new FakeAi(aiConstraints), solver, households, recipes: recipeRepo, costs,
    proposals: new InMemoryProposalStore(), newId: () => `id${++n}`, now: () => new Date('2026-10-19T09:00:00Z'),
  });
  return { orch, calls };
}

/** Simple solver double: fills slots round-robin from candidates, leaves slots empty when none. */
class TestSolver implements PlanSolver {
  validateFails: string[] = [];
  solve(c: PlanConstraints, cands: Candidate[], o: { weekStart: string; servings: number }) {
    const slots: PlanSlot[] = [];
    let i = 0;
    for (let d = 0; d < (c.days ?? 7); d++) for (const mealType of c.mealTypes) {
      const cand = cands[i++ % cands.length]!;
      slots.push({ date: addDays(o.weekStart, d), mealType, recipeId: cand.id, servings: o.servings });
    }
    const uncosted = [...new Set(slots.map((s) => s.recipeId!))].filter((id) => cands.find((x) => x.id === id)?.costPence == null);
    return {
      slots,
      report: [{ constraint: 'two fish meals', met: false, detail: 'only one fish recipe saved' }],
      explanations: ['Proportions rounded for 7 days.'],
      totalCostPence: uncosted.length ? null : 5600, uncostedMeals: uncosted,
    };
  }
  validate() { return { ok: this.validateFails.length === 0, violations: this.validateFails }; }
}

// ---------- tests ----------
describe('proposePlan', () => {
  it("handles the brief's example prompt end to end", async () => {
    const ai = new FakeAi(aiConstraints);
    const { orch } = build({ ai });
    const r = await orch.proposePlan('h1', BRIEF_PROMPT, '2026-10-19');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const p = r.value;
    expect(p.status).toBe('proposed');
    expect(p.slots).toHaveLength(7);
    expect(p.constraints.servings).toBe(4);
    expect(p.constraints.budgetPence).toBe(10000);
    expect(p.constraints.startDate).toBe('2026-10-19');
    expect(p.request).toMatchObject({ servings: 4, favouritesOf: ['Lauren'], excludeTerms: ['mushrooms'] });
    expect(p.unmet.some((u) => u.kind === 'solver' && u.detail.includes('two fish meals'))).toBe(true);
    expect(p.explanations.length).toBeGreaterThan(0);
    // mushroom recipe filtered before the solver; favourites resolved to member ids
    expect(p.slots.map((s) => s.recipeId)).not.toContain('r3');
    expect(p.uncostedMeals).toEqual(['r4'].filter(() => false)); // r4 is excluded (peanut), so nothing uncosted
    // data minimisation: AI sees only the mentioned member, tags, no exclusions or recipes
    const ctx = ai.calls[0]!.ctx;
    expect(ctx.memberNames).toEqual(['Lauren Smith']);
    expect(ctx.exclusions ?? []).toEqual([]);
    expect(JSON.stringify(ctx)).not.toMatch(/peanut|salmon/i);
  });

  it('re-imposes an allergy the AI omitted and filters candidates', async () => {
    const { orch, calls } = build();
    const r = await orch.proposePlan('h1', BRIEF_PROMPT, '2026-10-19');
    if (!r.ok) throw new Error('expected ok');
    expect(r.value.constraints.excludeTerms).toEqual(expect.arrayContaining(['mushrooms', 'peanuts']));
    expect(r.value.constraints.favouritesOf).toEqual(['m1']);
    expect(r.value.reimposedExclusions).toEqual(['peanuts']);
    expect((calls.searchFilter as { excludeIngredients: string[] }).excludeIngredients).toContain('peanuts');
    expect(r.value.slots.map((s) => s.recipeId)).not.toContain('r4'); // peanut butter
  });

  it('reports an unknown member and an ambiguous member without guessing', async () => {
    const ai = new FakeAi({ ...aiConstraints, favouritesOf: ['Zed', 'Sam'] });
    const { orch } = build({ ai });
    const r = await orch.proposePlan('h1', 'plan dinners with Zed and Sam favourites', '2026-10-19');
    if (!r.ok) throw new Error('expected ok');
    const kinds = r.value.unmet.map((u) => u.kind);
    expect(kinds).toContain('member_unknown');
    expect(kinds).toContain('member_ambiguous');
    expect(r.value.unmet.find((u) => u.kind === 'member_ambiguous')!.detail).toMatch(/Sam Smith, Sam Jones/);
  });

  it('returns a user-visible message when the AI fails and keeps the prompt', async () => {
    const err = Object.assign(new Error('boom'), { userMessage: 'The AI service is temporarily unavailable. Your data is safe; please try again shortly.' });
    const { orch } = build({ ai: new FakeAi(err) });
    const r = await orch.proposePlan('h1', BRIEF_PROMPT, '2026-10-19');
    expect(r).toMatchObject({ ok: false, error: { code: 'AI_UNAVAILABLE', prompt: BRIEF_PROMPT } });
    if (!r.ok) expect(r.error.userMessage).toMatch(/Your data is safe/);
  });

  it('reports zero viable candidates with gaps for new-recipe suggestions', async () => {
    const { orch } = build({ repoRecipes: [recipes[2]!, recipes[3]!] }); // mushroom + peanut only
    const r = await orch.proposePlan('h1', BRIEF_PROMPT, '2026-10-19');
    expect(r.ok).toBe(false);
    if (r.ok || r.error.code !== 'NO_VIABLE_CANDIDATES') throw new Error('expected NO_VIABLE_CANDIDATES');
    expect(r.error.gaps).toHaveLength(7);
    expect(r.error.gaps[0]!.suggestionBrief.excludeIngredients).toEqual(expect.arrayContaining(['mushrooms', 'peanuts']));
  });

  it('turns unfilled solver slots into new-recipe gaps', async () => {
    const solver = new TestSolver();
    const orig = solver.solve.bind(solver);
    solver.solve = (c, cands, o) => { const r = orig(c, cands, o); r.slots[3] = { ...r.slots[3]!, recipeId: null, note: 'no quick vegan recipe' }; return r; };
    const { orch } = build({ solver });
    const r = await orch.proposePlan('h1', BRIEF_PROMPT, '2026-10-19');
    if (!r.ok) throw new Error('expected ok');
    expect(r.value.gaps).toHaveLength(1);
    expect(r.value.gaps[0]).toMatchObject({ date: '2026-10-22', reason: 'no quick vegan recipe' });
  });
});

describe('approvePlan / confirmShopping', () => {
  it('approves a valid plan, returns payloads, and does NOT generate shopping', async () => {
    const { orch, calls } = build();
    const p = await orch.proposePlan('h1', BRIEF_PROMPT, '2026-10-19');
    if (!p.ok) throw new Error('x');
    const a = await orch.approvePlan('h1', p.value.id);
    if (!a.ok) throw new Error(JSON.stringify(a.error));
    expect(a.value.plan).toMatchObject({ status: 'approved', startDate: '2026-10-19', endDate: '2026-10-25' });
    expect(a.value.meals).toHaveLength(7);
    expect(calls.shopping).toBe(0);
    const reqs = await orch.confirmShopping('h1', a.value.meals);
    expect(calls.shopping).toBe(1);
    expect(reqs[0]!.contributions).toHaveLength(7);
  });

  it('rejects an edited plan containing an excluded ingredient (even if the solver would pass it)', async () => {
    const { orch } = build();
    const p = await orch.proposePlan('h1', BRIEF_PROMPT, '2026-10-19');
    if (!p.ok) throw new Error('x');
    const a = await orch.approvePlan('h1', p.value.id, { slotEdits: [{ date: '2026-10-20', mealType: 'dinner', recipeId: 'r3' }] });
    expect(a.ok).toBe(false);
    if (a.ok || a.error.code !== 'VALIDATION_FAILED') throw new Error('expected VALIDATION_FAILED');
    expect(a.error.violations.join(' ')).toMatch(/Mushroom risotto.*mushrooms/);
  });

  it("rejects when the solver's validate fails and for unknown proposals", async () => {
    const solver = new TestSolver();
    const { orch } = build({ solver });
    const p = await orch.proposePlan('h1', BRIEF_PROMPT, '2026-10-19');
    if (!p.ok) throw new Error('x');
    solver.validateFails = ['too many meat meals'];
    const a = await orch.approvePlan('h1', p.value.id);
    expect(a).toMatchObject({ ok: false, error: { code: 'VALIDATION_FAILED', violations: ['too many meat meals'] } });
    expect(await orch.approvePlan('h1', 'nope')).toMatchObject({ ok: false, error: { code: 'PROPOSAL_NOT_FOUND' } });
  });
});

describe('resolveMember', () => {
  const ms = household().members;
  it('matches possessive, first name and exact', () => {
    expect(resolveMember("Lauren's", ms).status).toBe('ok');
    expect(resolveMember('sam smith', ms).status).toBe('ok');
    expect(resolveMember('Sam', ms).status).toBe('ambiguous');
    expect(resolveMember('Bob', ms).status).toBe('unknown');
  });
});

describe('parseRequest / solveRequest (no second AI call on edit, D133)', () => {
  it('parseRequest reads the prompt into an editable request and solves nothing', async () => {
    const ai = new FakeAi(aiConstraints);
    const { orch, calls } = build({ ai });
    const r = await orch.parseRequest('h1', BRIEF_PROMPT, '2026-10-19');
    if (!r.ok) throw new Error('expected ok');
    expect(calls.searchFilter).toBeUndefined();
    expect(r.value.request).toMatchObject({ servings: 4, days: 7, budgetPence: 10000, excludeTerms: ['mushrooms'], favouritesOf: ['Lauren'] });
    expect(r.value.request).not.toHaveProperty('startDate');
    expect(r.value.householdExclusions).toEqual(['peanuts']); // shown locked, not an editable term
    expect(ai.calls[0]!.ctx.startDate).toBe('2026-10-19');
  });

  it('solveRequest re-solves an edited request without calling the AI, and re-imposes household exclusions', async () => {
    const ai = new FakeAi(aiConstraints);
    const { orch } = build({ ai });
    const parsed = await orch.parseRequest('h1', BRIEF_PROMPT, '2026-10-19');
    if (!parsed.ok) throw new Error('x');
    expect(ai.calls).toHaveLength(1);
    // the user removes the mushroom chip, bumps servings and sets a budget; "peanuts" cannot be edited away
    const edited = { ...parsed.value.request, excludeTerms: [], servings: 6, budgetPence: 5000, favouritesOf: [] };
    const r = await orch.solveRequest('h1', { prompt: BRIEF_PROMPT, weekStart: '2026-10-19', request: edited });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(ai.calls).toHaveLength(1);
    expect(r.value.constraints).toMatchObject({ servings: 6, budgetPence: 5000, excludeTerms: ['peanuts'] });
    expect(r.value.request).toMatchObject({ servings: 6, excludeTerms: [] });
    expect(r.value.slots.map((x) => x.recipeId)).toContain('r3'); // mushrooms are allowed again
    expect(r.value.slots.map((x) => x.recipeId)).not.toContain('r4'); // peanut butter never
    expect(r.value.reimposedExclusions).toEqual(['peanuts']);
  });

  it('solveRequest rejects an invalid (client-supplied) request instead of trusting it', async () => {
    const { orch } = build();
    const r = await orch.solveRequest('h1', { prompt: 'x', weekStart: '2026-10-19', request: { servings: 0, mealTypes: [] } });
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
    // server-only fields cannot be smuggled in
    const r2 = await orch.solveRequest('h1', { prompt: 'x', weekStart: '2026-10-19', request: { servings: 2, mealTypes: ['dinner'], allowUnverifiedIngredients: true } });
    expect(r2).toMatchObject({ ok: false, error: { code: 'INVALID_REQUEST' } });
  });

  it('passes resolver output (ingredient ids, allergen groups) into the canonical constraints', async () => {
    let seen: { terms: string[]; allergens: string[] } | undefined;
    const hh = household();
    const { orch } = (() => {
      const households: HouseholdRepo = { getHousehold: async () => hh, getFavouriteRecipeIds: async () => [] };
      const recipeRepo: RecipeRepo = {
        tagVocabulary: async () => [], searchCandidates: async () => structuredClone(recipes), getRecipes: async () => [],
      };
      const costs: CostService = { costRecipes: async () => ({}), buildRequirements: async () => [] };
      let solved: PlanConstraints | undefined;
      const solver: PlanSolver = {
        solve: (c) => { solved = c; return { slots: [], report: [], explanations: [], totalCostPence: null, uncostedMeals: [] }; },
        validate: () => ({ ok: true, violations: [] }),
      };
      const orch = new PlanOrchestrator({
        ai: new FakeAi(aiConstraints), solver, households, recipes: recipeRepo, costs, proposals: new InMemoryProposalStore(),
        resolveExclusions: (i) => { seen = i; return { excludeIngredientIds: ['ing-peanut', 'ing-mushroom'], allergenGroups: { peanuts: ['ing-peanut'] }, excludeAllergens: ['peanuts'] }; },
      });
      return { orch, get solved() { return solved; } };
    })();
    const r = await orch.proposePlan('h1', BRIEF_PROMPT, '2026-10-19');
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(seen).toEqual({ terms: ['mushrooms', 'peanuts'], allergens: [] });
    expect(r.value.constraints).toMatchObject({
      excludeIngredientIds: ['ing-peanut', 'ing-mushroom'], allergenGroups: { peanuts: ['ing-peanut'] }, excludeAllergens: ['peanuts'],
      allowUnverifiedIngredients: false,
    });
  });
});
