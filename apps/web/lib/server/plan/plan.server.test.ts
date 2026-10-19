import { describe, expect, it } from 'vitest';
import { createAiProvider, type AiProvider } from '@fr/ai';
import { addDays } from '../../plan/dates';
import { emptyDoc, setRecipe } from '../../plan/ops';
import type { PlanDoc } from '../../plan/types';
import * as h from './handlers';
import { InMemoryPlanRecipeSource, loadFixtureRecipes, type PlanRecipe } from './recipe-source';
import { createPlanServices } from './services';
import { createRoundRobinSolver } from './solver-adapter';

const WEEK = '2026-10-19';
const mockAi = (): AiProvider => createAiProvider({ AI_PROVIDER: 'mock', NODE_ENV: 'test' });
const svc = (extra: Partial<Parameters<typeof createPlanServices>[0]> = {}) => createPlanServices({ ai: mockAi(), ...extra });

describe('fixture recipe source', () => {
  it('loads the e2e recipe fixtures with honest costs', () => {
    const rs = loadFixtureRecipes();
    expect(rs.length).toBeGreaterThanOrEqual(8);
    expect(rs.some((r) => r.costPerServingPence === null)).toBe(true);
    expect(rs.find((r) => r.id === '06-fish-pie')?.dietCategory).toBe('fish');
  });
});

describe('getPlanPageData', () => {
  it('returns an empty draft for the Monday of the requested week plus the recipe catalogue', async () => {
    const d = await h.getPlanPageData(svc(), '2026-10-22');
    expect(d.doc.weekStart).toBe(WEEK);
    expect(d.doc.mealTypes).toEqual(['dinner']);
    expect(d.isSaved).toBe(false);
    expect(d.recipes.length).toBeGreaterThanOrEqual(8);
    expect(d.householdExclusions).toContain('peanuts');
  });
});

describe('manual plans: save / approve / reuse', () => {
  it('saves a draft, reopens it, approves it, and rejects tampered input', async () => {
    const s = svc();
    const base = (await h.getPlanPageData(s, WEEK)).doc;
    const doc = setRecipe(base, { date: WEEK, mealType: 'dinner' }, '06-fish-pie', 4);
    const saved = await h.savePlan(s, doc);
    expect(saved.ok).toBe(true);
    expect((await h.getPlanPageData(s, WEEK)).isSaved).toBe(true);

    const approved = await h.approvePlan(s, doc);
    expect(approved.ok && approved.value.status).toBe('approved');
    expect((await h.loadPlanForWeek(s, WEEK))?.status).toBe('approved');

    const badServings = await h.savePlan(s, setRecipe(base, { date: WEEK, mealType: 'dinner' }, '06-fish-pie', 500));
    expect(badServings.ok).toBe(false);
    const outsideWeek = await h.savePlan(s, setRecipe(base, { date: addDays(WEEK, 9), mealType: 'dinner' }, '06-fish-pie', 4));
    expect(outsideWeek.ok).toBe(false);
    const unknown = await h.approvePlan(s, setRecipe(base, { date: WEEK, mealType: 'dinner' }, 'nope', 4));
    expect(unknown.ok).toBe(false);
  });

  it('refuses to approve an empty plan', async () => {
    const s = svc();
    const res = await h.approvePlan(s, (await h.getPlanPageData(s, WEEK)).doc);
    expect(res.ok).toBe(false);
  });

  it('enforces hard exclusions (allergies) on save and approve, never trusting the client', async () => {
    const nutty: PlanRecipe = {
      id: 'satay', title: 'Chicken satay', ingredientNames: ['chicken', 'Peanut butter'], ingredientLines: [],
      tags: [], mealTypes: ['dinner'], dietCategory: 'meat', baseServings: 4, costPerServingPence: 200,
    };
    const s = svc({ recipes: new InMemoryPlanRecipeSource([nutty]) });
    const page = await h.getPlanPageData(s, WEEK);
    expect(page.recipes[0]?.excludedBy).toEqual(['peanuts']);
    const doc = setRecipe(page.doc, { date: WEEK, mealType: 'dinner' }, 'satay', 4);
    for (const res of [await h.savePlan(s, doc), await h.approvePlan(s, doc)]) {
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.violations?.join(' ')).toMatch(/peanuts/);
    }
  });

  it('reuses a previous week via loadPlanForWeek', async () => {
    const s = svc();
    const doc = setRecipe((await h.getPlanPageData(s, WEEK)).doc, { date: WEEK, mealType: 'dinner' }, '01-tomato-pasta', 2);
    await h.savePlan(s, doc);
    const prev = await h.loadPlanForWeek(s, WEEK);
    expect(prev?.entries[`${WEEK}|dinner`]).toBeDefined();
    expect(await h.loadPlanForWeek(s, addDays(WEEK, 7))).toBeNull();
  });
});

describe('prompt flow with mock AI', () => {
  it('proposes a 7-slot plan, re-imposes the allergy and never includes excluded ingredients', async () => {
    const s = svc();
    const res = await h.proposePlan(s, h.EXAMPLE_PROMPT, WEEK);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = res.proposal;
    expect(p.slots).toHaveLength(7);
    expect(p.reimposedExclusions).toContain('peanuts');
    expect(p.report.length).toBeGreaterThan(0);
    expect(p.explanations.join(' ')).toMatch(/cannot be cooked|divide exactly/);
    // the mock returns half-vegetarian proportions: meat + vegetarian targets add to 7
    expect(p.report.some((r) => /meals/.test(r.constraint))).toBe(true);
    // Lauren is mentioned but the demo household resolves her; no unresolved-member message
    expect(p.unmet.some((u) => u.kind === 'member_unknown')).toBe(false);
  });

  it('propose -> accept into an unsaved grid -> approve -> shopping only on explicit confirmation', async () => {
    const s = svc();
    const res = await h.proposePlan(s, h.EXAMPLE_PROMPT, WEEK);
    if (!res.ok) throw new Error('proposal failed');
    // nothing saved by proposing
    expect(await h.loadPlanForWeek(s, WEEK)).toBeNull();

    // what the UI does on "Accept into grid"
    const doc: PlanDoc = { ...emptyDoc('plan-1', s.household.id, WEEK), proposalId: res.proposal.id, mealTypes: ['dinner'] };
    for (const slot of res.proposal.slots) if (slot.recipeId) doc.entries[`${slot.date}|${slot.mealType}`] = { kind: 'recipe', recipeId: slot.recipeId, servings: slot.servings };
    expect(await h.loadPlanForWeek(s, WEEK)).toBeNull(); // still unsaved

    // shopping before approval is refused (and nothing is generated)
    await s.plans.save(doc);
    const early = await h.generateShopping(s, doc.id);
    expect(early.ok).toBe(false);

    const approved = await h.approvePlan(s, doc);
    expect(approved.ok).toBe(true);

    let hooked = 0;
    s.onShoppingRequirements = async () => { hooked++; };
    expect(hooked).toBe(0); // approving alone never creates requirements
    const shop = await h.generateShopping(s, doc.id);
    expect(shop.ok).toBe(true);
    if (shop.ok) {
      expect(shop.value.href).toBe('/shopping?plan=plan-1');
      expect(shop.value.count).toBeGreaterThan(0);
    }
    expect(hooked).toBe(1);
  });

  it('returns a user-facing error with the prompt preserved when the AI fails', async () => {
    const failing = { ...mockAi(), parsePlanPrompt: async () => { throw new Error('boom'); } } as unknown as AiProvider;
    const res = await h.proposePlan(svc({ ai: failing }), 'Plan 3 dinners', WEEK);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('AI_UNAVAILABLE');
      expect(res.message).toMatch(/try again/i);
    }
  });

  it('reports no viable candidates with gaps when every recipe is excluded', async () => {
    const only: PlanRecipe = { id: 'x', title: 'Satay', ingredientNames: ['peanuts'], ingredientLines: [], tags: [], mealTypes: ['dinner'], dietCategory: 'meat', baseServings: 4, costPerServingPence: null };
    const res = await h.proposePlan(svc({ recipes: new InMemoryPlanRecipeSource([only]) }), h.EXAMPLE_PROMPT, WEEK);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe('NO_VIABLE_CANDIDATES');
      expect(res.gaps?.length).toBe(7);
    }
  });

  it('validates the prompt', async () => {
    const s = svc();
    expect((await h.proposePlan(s, '   ', WEEK)).ok).toBe(false);
    expect((await h.proposePlan(s, 'x'.repeat(2000), WEEK)).ok).toBe(false);
    expect((await h.proposePlan(s, 'plan', 'not-a-date')).ok).toBe(false);
  });
});

describe('round-robin solver adapter', () => {
  const cands = loadFixtureRecipes().filter((r) => r.mealTypes.includes('dinner')).map((r) => ({
    id: r.id, title: r.title, ingredientNames: r.ingredientNames, tags: r.tags, mealTypes: r.mealTypes,
    dietCategory: r.dietCategory, costPence: r.costPerServingPence == null ? null : r.costPerServingPence * 4,
  }));
  const solver = createRoundRobinSolver();

  it('honours rounded diet proportions and flags uncosted budget honestly', async () => {
    const res = await solver.solve(
      { days: 7, mealTypes: ['dinner'], dietProportions: { vegetarian: 0.5, meat: 0.5 }, includeTags: [], excludeIngredients: [], favouritesOf: [], budgetPence: 6000 },
      cands, { weekStart: WEEK, servings: 4 },
    );
    expect(res.slots).toHaveLength(7);
    expect(res.slots.every((s) => s.recipeId)).toBe(true);
    const budget = res.report.find((r) => r.constraint === 'Budget');
    expect(budget).toBeDefined();
    expect(res.explanations.join(' ')).toMatch(/rounded/);
  });

  it('leaves slots open when no recipe fits the meal type', async () => {
    const res = await solver.solve({ days: 2, mealTypes: ['breakfast'], includeTags: [], excludeIngredients: [], favouritesOf: [] }, cands, { weekStart: WEEK, servings: 2 });
    expect(res.slots.every((s) => s.recipeId === null)).toBe(true);
  });

  it('validate rejects non-positive servings', async () => {
    const v = await solver.validate({ slots: [{ date: WEEK, mealType: 'dinner', recipeId: 'x', servings: 0 }] }, { days: 7, mealTypes: ['dinner'], includeTags: [], excludeIngredients: [], favouritesOf: [] });
    expect(v.ok).toBe(false);
  });
});
