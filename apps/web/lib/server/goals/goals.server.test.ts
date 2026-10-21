// P3-B (D430-D439): nutrition goals through the shared service (mock-mode memory store) and the real planner stack.
// Consent gating (no consent -> nothing stored or shown), withdrawal deletes, kid seam, anonymous planner ids, the soft nudge,
// and goals never reaching an AI provider.
import { afterEach, describe, expect, it } from 'vitest';
import { createAiProvider, type AiProvider } from '@fr/ai';
import { calculateRecipeNutrition, type NutrientProfile } from '@fr/engine/nutrition';
import * as h from '../plan/handlers';
import { createPlanServices, demoHousehold, getPlanServicesFor, loadPlanServices, resetPlanServices } from '../plan/services';
import { InMemoryPlanRecipeSource, type PlanRecipe } from '../plan/recipe-source';
import { resetMemoryGoals } from './memory-store';
import { loadGoalNudge, loadGoals, saveGoals, withdrawGoals, type GoalsCaller } from './service';

const caller = (over: Partial<GoalsCaller> = {}): GoalsCaller => ({ householdId: 'h-goals', userId: 'u1', client: null, readOnly: false, ...over });
const input = { consent: true, adultConfirmed: true, goals: ['more_fibre', 'less_salt'], portionShare: 1, nudgePlan: false };

afterEach(() => {
  resetMemoryGoals();
  resetPlanServices();
});

describe('consent gating', () => {
  it('opening the screen stores nothing: a fresh member has no consent and no goals', async () => {
    expect(await loadGoals(caller())).toEqual({ ok: true, state: { consentActive: false, goals: [], portionShare: 1, nudgePlan: false, adultConfirmed: false, wordingVersion: null } });
  });

  it('goals without consent are refused and NOTHING is stored (no consent record either)', async () => {
    expect(await saveGoals(caller(), { ...input, consent: false })).toEqual({ ok: false, error: 'consent_required' });
    expect(await loadGoals(caller())).toMatchObject({ ok: true, state: { consentActive: false, goals: [] } });
  });

  it('an empty save without consent is a harmless no-op that creates no consent', async () => {
    expect(await saveGoals(caller(), { ...input, consent: false, goals: [] })).toMatchObject({ ok: true, state: { consentActive: false, goals: [] } });
  });

  it('consent needs the adult confirmation: without it nothing is stored', async () => {
    expect(await saveGoals(caller(), { ...input, adultConfirmed: false })).toEqual({ ok: false, error: 'invalid_input' });
    expect(await loadGoals(caller())).toMatchObject({ state: { consentActive: false } });
  });

  it('with consent and adult confirmation the goals are stored and returned in a fixed order, with the wording version', async () => {
    const r = await saveGoals(caller(), { ...input, goals: ['less_salt', 'more_fibre'], portionShare: 0.5, nudgePlan: true });
    expect(r).toMatchObject({ ok: true, state: { consentActive: true, goals: ['more_fibre', 'less_salt'], portionShare: 0.5, nudgePlan: true, adultConfirmed: true, wordingVersion: 'g1' } });
    // later edits do not need to repeat the consent boxes
    expect(await saveGoals(caller(), { ...input, consent: false, adultConfirmed: false, goals: ['less_sugar'] })).toMatchObject({ ok: true, state: { goals: ['less_sugar'] } });
  });

  it('withdrawing deletes the goals, the portion and the nudge, and writing is refused again', async () => {
    await saveGoals(caller(), { ...input, nudgePlan: true });
    expect(await withdrawGoals(caller())).toMatchObject({ ok: true, state: { consentActive: false, goals: [], nudgePlan: false, adultConfirmed: false } });
    expect(await loadGoalNudge('h-goals', null)).toEqual([]);
    expect(await saveGoals(caller(), { ...input, consent: false })).toEqual({ ok: false, error: 'consent_required' });
  });

  it('rejects unknown goals, weight-loss style goals and silly portions', async () => {
    for (const bad of [{ goals: ['lose_weight'] }, { goals: ['calories'] }, { portionShare: 9 }, { portionShare: 0 }]) {
      expect(await saveGoals(caller(), { ...input, ...bad })).toMatchObject({ ok: false, error: 'invalid_input' });
    }
  });

  it('is read-only while the household is pending deletion, but withdrawing (deleting data) is still allowed', async () => {
    await saveGoals(caller(), input);
    expect(await saveGoals(caller({ readOnly: true }), input)).toEqual({ ok: false, error: 'read_only' });
    expect(await withdrawGoals(caller({ readOnly: true }))).toMatchObject({ ok: true, state: { consentActive: false } });
  });

  it('a child profile can never hold goals (kids mode seam, P3-A)', async () => {
    expect(await saveGoals(caller({ isChild: true }), input)).toEqual({ ok: false, error: 'forbidden' });
    expect(await loadGoals(caller({ isChild: true }))).toEqual({ ok: false, error: 'forbidden' });
    expect(await withdrawGoals(caller({ isChild: true }))).toEqual({ ok: false, error: 'forbidden' });
  });

  it('goals are per person: another member sees none of them', async () => {
    await saveGoals(caller(), input);
    expect(await loadGoals(caller({ userId: 'u2' }))).toMatchObject({ ok: true, state: { consentActive: false, goals: [] } });
  });
});

describe('planner nudge input is anonymous and opt-in', () => {
  it('only consenting members who opted in contribute, as a deduplicated list of ids', async () => {
    await saveGoals(caller({ userId: 'u1' }), { ...input, goals: ['more_fibre', 'less_salt'], nudgePlan: true });
    await saveGoals(caller({ userId: 'u2' }), { ...input, goals: ['more_fibre', 'less_sugar'], nudgePlan: true });
    await saveGoals(caller({ userId: 'u3' }), { ...input, goals: ['more_oily_fish'], nudgePlan: false }); // not opted in
    expect(await loadGoalNudge('h-goals', null)).toEqual(['more_fibre', 'less_salt', 'less_sugar']);
    expect(await loadGoalNudge('h-other', null)).toEqual([]);
    await withdrawGoals(caller({ userId: 'u2' }));
    expect(await loadGoalNudge('h-goals', null)).toEqual(['more_fibre', 'less_salt']);
  });

  it('is off by default: nobody opted in means an empty list', async () => {
    await saveGoals(caller(), input);
    expect(await loadGoalNudge('h-goals', null)).toEqual([]);
  });

  it('loadPlanServices carries it on the services for the request (and clears it again)', async () => {
    await saveGoals(caller({ householdId: 'h-svc' }), { ...input, nudgePlan: true });
    expect((await loadPlanServices('h-svc')).goalNudge).toEqual(['more_fibre', 'less_salt']);
    await withdrawGoals(caller({ householdId: 'h-svc' }));
    expect((await loadPlanServices('h-svc')).goalNudge).toEqual([]);
    expect(getPlanServicesFor('h-svc').goalNudge).toEqual([]);
  });
});

// ---- the planner, with the real orchestrator + engine solver ----
const conv = { toGrams: (_id: string | undefined, q: { value?: number; unit: string }) => (q.value !== undefined && q.unit === 'g' ? { grams: q.value, estimate: false } : null) };
const profile = (fibre: number): NutrientProfile => ({
  source: 'CoFID',
  per100g: Object.fromEntries(Object.entries({ energy_kcal: 100, protein: 5, carbohydrate: 10, sugars: 2, fat: 2, saturates: 1, fibre, sodium: 100 }).map(([k, value]) => [k, { status: 'known' as const, value }])),
});
const nutritionFor = (fibre: number) =>
  calculateRecipeNutrition([{ id: 'x', name: 'x', ingredientId: 'x', quantity: { kind: 'exact', value: 100, unit: 'g', originalText: '100g' }, optional: false, profile: profile(fibre) }], 1, conv as never).perServing;

const recipe = (id: string, title: string, fibre: number): PlanRecipe => ({
  id, title, ingredientNames: [title.toLowerCase()], ingredientLines: [], tags: [], mealTypes: ['dinner'], dietCategory: 'vegetarian', baseServings: 4, costPerServingPence: 200, nutritionPerServing: nutritionFor(fibre),
});
const lib = [recipe('w1', 'White pasta', 1), recipe('w2', 'Plain rice', 1), recipe('w3', 'Cheese toastie', 1), recipe('h1', 'Lentil dhal', 12), recipe('h2', 'Bean chilli', 12), recipe('h3', 'Chickpea curry', 12)];
const WEEK = '2026-10-19';
const mockAi = (): AiProvider => createAiProvider({ AI_PROVIDER: 'mock', NODE_ENV: 'test' });
const used = (res: Awaited<ReturnType<typeof h.proposePlan>>) => (res.ok ? res.proposal.slots.map((s) => s.recipeId) : []);

describe('planner: the goal nudge is soft and off by default', () => {
  const make = (nudge: string[]) => {
    const svc = createPlanServices({ ai: mockAi(), recipes: new InMemoryPlanRecipeSource(lib), household: { ...demoHousehold('h-nudge'), hardExclusions: [] } });
    svc.goalNudge = nudge as never;
    return svc;
  };

  it('off: no goals, no nudge item in the report', async () => {
    const res = await h.proposePlan(make([]), 'Plan 3 dinners', WEEK);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.proposal.report.find((r) => r.constraint === 'Nutrition goals')).toBeUndefined();
  });

  it('on: prefers the higher-fibre recipes when everything else is equal, and reports it as a gentle preference', async () => {
    const res = await h.proposePlan(make(['more_fibre']), 'Plan 3 dinners', WEEK);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(used(res).sort()).toEqual(['h1', 'h2', 'h3']);
    const item = res.proposal.report.find((r) => r.constraint === 'Nutrition goals');
    expect(item?.detail).toMatch(/gentle preference/);
  });

  it('is only a preference: a poorly fitting recipe is still used when the plan needs it', async () => {
    const res = await h.proposePlan(make(['more_fibre']), 'Plan 5 dinners', WEEK);
    expect(res.ok).toBe(true);
    expect(used(res)).toHaveLength(5);
  });

  it('goals never reach the AI request (the household context is an allow-list)', async () => {
    let seen = '';
    const ai = new Proxy(mockAi(), {
      get(t, p, r) {
        if (p === 'parsePlanPrompt') return (prompt: string, ctx: unknown, c?: unknown) => { seen = JSON.stringify(ctx); return (t as AiProvider).parsePlanPrompt(prompt, ctx as never, c as never); };
        return Reflect.get(t, p, r);
      },
    }) as AiProvider;
    const svc = createPlanServices({ ai, recipes: new InMemoryPlanRecipeSource(lib), household: { ...demoHousehold('h-ai'), hardExclusions: [] } });
    svc.goalNudge = ['more_fibre', 'less_salt'];
    await h.proposePlan(svc, 'Plan 3 dinners', WEEK);
    expect(seen).not.toBe('');
    expect(seen).not.toMatch(/fibre|salt|goal|nudge/i);
  });
});

describe('data export (D434)', () => {
  it('includes the goals in both scopes, own rows only (an owner never exports another members goals)', async () => {
    const { EXPORT_TABLES } = await import('../export/tables');
    for (const t of ['nutrition_goal_profiles', 'nutrition_goals']) {
      const spec = EXPORT_TABLES.find((x) => x.table === t);
      expect(spec, t).toBeDefined();
      expect(spec!.member).toEqual({ kind: 'self', col: 'user_id' });
      expect(spec!.household).toEqual({ kind: 'self', col: 'user_id' });
    }
  });
});
