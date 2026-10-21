// P2-C (D410-D419) through the real planner: busy evenings become quick-meal / skip constraints, leftover slots are validated
// against the ledger, and nothing but derived flags is ever involved.
import { beforeEach, describe, expect, it } from 'vitest';
import { createAiProvider } from '@fr/ai';
import { MemoryCalendarStore, resetMemoryCalendar } from '../calendar/store';
import { MemoryLeftoverStore, resetMemoryLeftovers } from '../leftovers/store';
import { markPlannedEaten, takePortions } from '../leftovers/service';
import { setLeftover, setRecipe } from '../../plan/ops';
import * as h from './handlers';
import { InMemoryPlanRecipeSource, type PlanRecipe } from './recipe-source';
import { DEMO_HOUSEHOLD_ID, createPlanServices } from './services';

const WEEK = '2026-10-19';
const svc = () => createPlanServices({ ai: createAiProvider({ AI_PROVIDER: 'mock', NODE_ENV: 'test' }), recipes: new InMemoryPlanRecipeSource() });
const cal = new MemoryCalendarStore();
const left = new MemoryLeftoverStore();
const caller = { householdId: DEMO_HOUSEHOLD_ID, userId: 'u1', client: null, readOnly: false };

beforeEach(() => {
  resetMemoryCalendar();
  resetMemoryLeftovers();
});

describe('busy evenings feed the solver', () => {
  it('a manual busy day adds a quick-meal date and is reported on the proposal', async () => {
    await cal.setManual(DEMO_HOUSEHOLD_ID, 'u1', '2026-10-21', true);
    const s = svc();
    const res = await h.proposePlan(s, h.EXAMPLE_PROMPT, WEEK);
    if (!res.ok) throw new Error('expected a proposal');
    expect(res.proposal.constraints.quickMeals?.dates).toContain('2026-10-21');
    expect(res.proposal.busyApplied).toEqual([{ date: '2026-10-21', skip: false, minutesAvailable: null, sources: ['manual'] }]);
  });

  it('prefers a quick recipe on the busy evening (the library has exactly one)', async () => {
    const recipe = (id: string, minutes: number): PlanRecipe => ({
      id, title: id, ingredientNames: ['rice'], ingredientLines: [], tags: [], mealTypes: ['dinner'], dietCategory: 'vegetarian', baseServings: 4, costPerServingPence: 100, totalMinutes: minutes,
    });
    const recipes = [...['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => recipe(`slow-${id}`, 90)), recipe('quick-one', 15)];
    await cal.setManual(DEMO_HOUSEHOLD_ID, 'u1', '2026-10-22', true);
    const s = createPlanServices({ ai: createAiProvider({ AI_PROVIDER: 'mock', NODE_ENV: 'test' }), recipes: new InMemoryPlanRecipeSource(recipes) });
    const parsed = await h.parsePlanRequest(s, 'Plan seven dinners for four people', WEEK);
    if (!parsed.ok) throw new Error('expected a parse');
    const res = await h.solvePlanRequest(s, 'Plan seven dinners for four people', WEEK, { ...parsed.parsed.request, quickMeals: undefined });
    if (!res.ok) throw new Error('expected a proposal');
    expect(res.proposal.constraints.quickMeals).toMatchObject({ dates: ['2026-10-22'], maxTotalMinutes: 30, strict: false });
    expect(res.proposal.slots.find((x) => x.date === '2026-10-22')?.recipeId).toBe('quick-one');
  });

  it('keeps the request\'s own quick-meal minutes and strictness, and unions the dates', async () => {
    await cal.replaceOwn(DEMO_HOUSEHOLD_ID, 'u1', 'device', '2026-10-19', '2026-10-25', [{ date: '2026-10-22', minutesAvailable: 60 }]);
    const s = svc();
    const parsed = await h.parsePlanRequest(s, h.EXAMPLE_PROMPT, WEEK);
    if (!parsed.ok) throw new Error('expected a parse');
    expect(parsed.parsed.busy).toEqual([{ date: '2026-10-22', skip: false, minutesAvailable: 60, sources: ['device'] }]);
    const request = { ...parsed.parsed.request, quickMeals: { weekdays: ['mon'], dates: [], maxTotalMinutes: 25, strict: false } };
    const res = await h.solvePlanRequest(s, h.EXAMPLE_PROMPT, WEEK, request);
    if (!res.ok) throw new Error('expected a proposal');
    expect(res.proposal.constraints.quickMeals).toMatchObject({ weekdays: ['mon'], dates: ['2026-10-22'], maxTotalMinutes: 25 });
  });

  it('an evening with almost no free time skips the dinner', async () => {
    await cal.replaceOwn(DEMO_HOUSEHOLD_ID, 'u1', 'ics', '2026-10-19', '2026-10-25', [{ date: '2026-10-23', minutesAvailable: 5 }]);
    const res = await h.proposePlan(svc(), h.EXAMPLE_PROMPT, WEEK);
    if (!res.ok) throw new Error('expected a proposal');
    expect(res.proposal.constraints.skip).toEqual([{ date: '2026-10-23', mealType: 'dinner', reason: 'other', note: 'Busy evening' }]);
    expect(res.proposal.busyApplied?.[0]).toMatchObject({ date: '2026-10-23', skip: true });
    expect(res.proposal.slots.some((x) => x.date === '2026-10-23' && x.recipeId)).toBe(false);
  });

  it('flags outside the plan week are ignored; no flags means no change', async () => {
    await cal.setManual(DEMO_HOUSEHOLD_ID, 'u1', '2026-11-30', true);
    const res = await h.proposePlan(svc(), h.EXAMPLE_PROMPT, WEEK);
    if (!res.ok) throw new Error('expected a proposal');
    expect(res.proposal.busyApplied).toBeUndefined();
    expect(res.proposal.constraints.skip).toEqual([]);
  });

  it('page data lists the week\'s busy evenings as labelled flags (no titles)', async () => {
    await cal.setManual(DEMO_HOUSEHOLD_ID, 'u1', '2026-10-20', true);
    await cal.replaceOwn(DEMO_HOUSEHOLD_ID, 'u1', 'device', '2026-10-19', '2026-10-25', [{ date: '2026-10-20', minutesAvailable: 45 }, { date: '2026-10-24', minutesAvailable: 10 }]);
    const data = await h.getPlanPageData(svc(), WEEK);
    expect(data.busy).toEqual([
      { date: '2026-10-20', sources: ['device', 'manual'], minutesAvailable: 45, skip: false, label: 'Busy (about 45 min free)' },
      { date: '2026-10-24', sources: ['device'], minutesAvailable: 10, skip: true, label: 'Dinner skipped (about 10 min free)' },
    ]);
  });
});

describe('leftover slots in a plan', () => {
  const batch = (portions = 4) => left.createBatch(DEMO_HOUSEHOLD_ID, 'u1', { id: crypto.randomUUID(), title: 'Chilli', portionsMade: portions, storedIn: 'freezer', cookedOn: '2026-10-19', useBy: '2027-01-19' });

  it('places a stored batch with no shopping requirement, and refuses more portions than remain', async () => {
    const { batch: b } = await batch(4);
    const s = svc();
    const base = (await h.getPlanPageData(s, WEEK)).doc;
    const ok = await h.savePlan(s, setLeftover(base, { date: '2026-10-21', mealType: 'dinner' }, b.id, 2));
    expect(ok.ok).toBe(true);
    const tooMany = await h.savePlan(s, setLeftover(setLeftover(base, { date: '2026-10-21', mealType: 'dinner' }, b.id, 3), { date: '2026-10-22', mealType: 'dinner' }, b.id, 2));
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.violations?.join(' ')).toMatch(/Only 1 portion of Chilli/);
    const missing = await h.savePlan(s, setLeftover(base, { date: '2026-10-21', mealType: 'dinner' }, 'not-there', 1));
    expect(missing.ok).toBe(false);
  });

  it('approving a plan with a leftover meal generates no requirement for it', async () => {
    const { batch: b } = await batch(4);
    const s = svc();
    const base = (await h.getPlanPageData(s, WEEK)).doc;
    const withRecipe = setRecipe(setLeftover(base, { date: '2026-10-21', mealType: 'dinner' }, b.id, 2), { date: '2026-10-20', mealType: 'dinner' }, '06-fish-pie', 4);
    const approved = await h.approvePlan(s, withRecipe);
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    const shop = await h.generateShopping(s, approved.value.id);
    expect(shop.ok).toBe(true);
    if (shop.ok) expect(shop.value.preview.map((p) => p.name).join(' ')).not.toMatch(/chilli/i);
  });

  it('marking the planned meal eaten takes its portions once; a replay applies nothing', async () => {
    const { batch: b } = await batch(4);
    const s = svc();
    const base = (await h.getPlanPageData(s, WEEK)).doc;
    const saved = await h.savePlan(s, setLeftover(base, { date: '2026-10-21', mealType: 'dinner' }, b.id, 2));
    if (!saved.ok) throw new Error('expected save');
    const first = await markPlannedEaten(caller, s.plans, saved.value.id, '2026-10-21', 'dinner');
    expect(first).toMatchObject({ ok: true, applied: true, portionsLeft: 2 });
    const again = await markPlannedEaten(caller, s.plans, saved.value.id, '2026-10-21', 'dinner');
    expect(again).toMatchObject({ ok: true, applied: false, portionsLeft: 2 });
    // the eaten slot no longer counts as "promised", so a manual take of the rest still works exactly once
    expect(await takePortions(caller, b.id, 2, 'eaten', 'tap-1')).toMatchObject({ ok: true, portionsLeft: 0 });
    expect(await takePortions(caller, b.id, 2, 'eaten', 'tap-1')).toMatchObject({ ok: true, portionsLeft: 0 }); // retried tap: same key
    expect(await takePortions(caller, b.id, 1, 'eaten', 'tap-2')).toMatchObject({ ok: false, error: 'not_enough' });
    const page = await h.getPlanPageData(s, WEEK);
    expect(page.eatenSlots).toEqual(['2026-10-21|dinner']);
  });

  it('refuses to mark a recipe slot eaten', async () => {
    const s = svc();
    const base = (await h.getPlanPageData(s, WEEK)).doc;
    const saved = await h.savePlan(s, setRecipe(base, { date: '2026-10-21', mealType: 'dinner' }, '06-fish-pie', 4));
    if (!saved.ok) throw new Error('expected save');
    expect(await markPlannedEaten(caller, s.plans, saved.value.id, '2026-10-21', 'dinner')).toMatchObject({ ok: false, error: 'not_found' });
  });
});
