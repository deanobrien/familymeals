// P3-A kids' mode (D425-D429): the service on the in-memory backend and, through the real planner, how a CLOSED round becomes a soft
// preference (and only a preference).
import { beforeEach, describe, expect, it } from 'vitest';
import { createAiProvider } from '@fr/ai';
import * as h from '../plan/handlers';
import { InMemoryPlanRecipeSource, type PlanRecipe } from '../plan/recipe-source';
import { DEMO_HOUSEHOLD_ID, createPlanServices } from '../plan/services';
import { addKid, castVote, closeRound, openRound, removeKid, votePreference, type KidsCaller } from './service';
import { memoryKidsRoundForTest, resetMemoryKids } from './store';

const WEEK = '2026-10-19';
const caller: KidsCaller = { householdId: DEMO_HOUSEHOLD_ID, userId: 'u1', client: null, readOnly: false };
const U = (n: number) => `99999999-0000-4000-8000-${String(n).padStart(12, '0')}`;
const dates = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];

const recipe = (id: string): PlanRecipe => ({
  id, title: id, ingredientNames: ['rice'], ingredientLines: [], tags: [], mealTypes: ['dinner'], dietCategory: 'vegetarian', baseServings: 4, costPerServingPence: 100, totalMinutes: 30,
});

beforeEach(() => resetMemoryKids());

async function closedRound(recipeIds: string[], forDate = '2026-10-21', days = 1) {
  const r = await openRound(caller, { recipeIds, forDate, days });
  if (!r.ok) throw new Error(r.message);
  return r.roundId;
}

describe('the service rules', () => {
  it('kid profiles are a name, an emoji and a colour, capped at 8, removable (their votes go with them)', async () => {
    const added = await addKid(caller, { displayName: 'Mia', avatar: '🦊', colour: 'blue' });
    if (!added.ok) throw new Error('add');
    expect(added.kid).toEqual({ id: expect.any(String), displayName: 'Mia', avatar: '🦊', colour: 'blue' });
    expect(await addKid(caller, { displayName: 'Mia', avatar: '🦊', colour: 'blue', email: 'x@y.z', dob: '2018-01-01' })).toMatchObject({ ok: true }); // extra fields are ignored
    for (let i = 0; i < 6; i++) await addKid(caller, { displayName: `Kid${i}`, avatar: '🐼', colour: 'red' });
    expect(await addKid(caller, { displayName: 'Ninth', avatar: '🐼', colour: 'red' })).toMatchObject({ ok: false, error: 'invalid_input' });
    expect(await removeKid({ ...caller, readOnly: true }, added.kid.id)).toMatchObject({ ok: false, error: 'read_only' });
    expect((await removeKid(caller, added.kid.id)).ok).toBe(true);
  });

  it('a kid vote needs a kid of this household; a closed round takes no more votes', async () => {
    const ids = [U(1), U(2), U(3)];
    // memory mode checks the recipes exist in this household: use the library's own
    const lib = await (await import('../../recipes/factory')).getRecipeRepositoryFor(DEMO_HOUSEHOLD_ID).list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 6 });
    const real = lib.items.slice(0, 3).map((r) => r.id);
    expect(await openRound(caller, { recipeIds: ids })).toMatchObject({ ok: false }); // unknown recipes
    const roundId = await closedRound(real);
    expect(await castVote(caller, { roundId, recipeId: real[0], kidId: U(9), value: 'up' })).toMatchObject({ ok: false, error: 'not_found' });
    const kid = await addKid(caller, { displayName: 'Mia', avatar: '🦊', colour: 'blue' });
    if (!kid.ok) throw new Error('add');
    expect((await castVote(caller, { roundId, recipeId: real[0], kidId: kid.kid.id, value: 'heart' })).ok).toBe(true);
    expect((await closeRound(caller, roundId)).ok).toBe(true);
    expect(await castVote(caller, { roundId, recipeId: real[0], kidId: kid.kid.id, value: 'up' })).toMatchObject({ ok: false, error: 'round_closed' });
    memoryKidsRoundForTest(DEMO_HOUSEHOLD_ID, roundId)!.votes = [];
  });
});

describe('votePreference', () => {
  async function seeded() {
    const lib = await (await import('../../recipes/factory')).getRecipeRepositoryFor(DEMO_HOUSEHOLD_ID).list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 6 });
    return lib.items.slice(0, 4).map((r) => r.id);
  }

  it('lists liked recipes of CLOSED rounds that overlap the dates, best first', async () => {
    const ids = await seeded();
    const roundId = await closedRound(ids.slice(0, 3), '2026-10-21');
    await castVote(caller, { roundId, recipeId: ids[1], value: 'up' });
    await castVote(caller, { roundId, recipeId: ids[2], value: 'heart' });
    expect(await votePreference(caller, dates)).toEqual([]); // still open: no effect yet
    await closeRound(caller, roundId);
    expect(await votePreference(caller, dates)).toEqual([ids[2], ids[1]]);
    expect(await votePreference(caller, ['2026-11-02', '2026-11-03'])).toEqual([]); // another week
    expect(await votePreference({ ...caller, householdId: 'someone-else' }, dates)).toEqual([]);
  });

  it('a week-long round covers the whole week; no votes means no preference', async () => {
    const ids = await seeded();
    const roundId = await closedRound(ids.slice(0, 3), '2026-10-19', 7);
    await closeRound(caller, roundId);
    expect(await votePreference(caller, dates)).toEqual([]);
  });
});

describe('through the real planner', () => {
  const recipes = Array.from({ length: 14 }, (_, i) => recipe(`dish-${String(i).padStart(2, '0')}`));
  const plan = async () => {
    const svc = createPlanServices({ ai: createAiProvider({ AI_PROVIDER: 'mock', NODE_ENV: 'test' }), recipes: new InMemoryPlanRecipeSource(recipes) });
    const parsed = await h.parsePlanRequest(svc, 'Plan seven dinners for four people', WEEK);
    if (!parsed.ok) throw new Error('parse');
    const res = await h.solvePlanRequest(svc, 'Plan seven dinners for four people', WEEK, { ...parsed.parsed.request, favouritesOf: [], quickMeals: undefined });
    if (!res.ok) throw new Error('solve');
    return res.proposal;
  };

  it('a closed round nudges the liked meals into the plan; without it they are not there', async () => {
    const without = await plan();
    const left = recipes.map((r) => r.id).filter((id) => !without.slots.some((s) => s.recipeId === id));
    expect(left.length).toBeGreaterThan(0);
    const liked = left[0]!;

    // The planner's recipe source is the in-memory plan source, so give the round the same ids through the store directly.
    const { MemoryKidsStore } = await import('./store');
    const store = new MemoryKidsStore();
    const roundId = await store.createRound(DEMO_HOUSEHOLD_ID, 'u1', { forDate: '2026-10-21', days: 1, title: null, recipeIds: [liked, left[1]!, left[2]!], closesAt: null });
    await store.castVote(DEMO_HOUSEHOLD_ID, 'u1', { roundId, recipeId: liked, kidId: null, value: 'heart' });
    expect(without.slots.some((s) => s.recipeId === liked)).toBe(false);
    expect((await plan()).slots.some((s) => s.recipeId === liked)).toBe(false); // an OPEN round changes nothing

    await store.closeRound(DEMO_HOUSEHOLD_ID, roundId);
    const withVote = await plan();
    expect(withVote.slots.some((s) => s.recipeId === liked)).toBe(true);
    expect(withVote.report.some((r) => /Family vote/.test(r.detail))).toBe(true);
  });

  it('is only a preference: an excluded ingredient still wins', async () => {
    const { MemoryKidsStore } = await import('./store');
    const store = new MemoryKidsStore();
    const liked = 'dish-03';
    const roundId = await store.createRound(DEMO_HOUSEHOLD_ID, 'u1', { forDate: '2026-10-21', days: 1, title: null, recipeIds: [liked, 'dish-04', 'dish-05'], closesAt: null });
    await store.castVote(DEMO_HOUSEHOLD_ID, 'u1', { roundId, recipeId: liked, kidId: null, value: 'heart' });
    await store.closeRound(DEMO_HOUSEHOLD_ID, roundId);
    const svc = createPlanServices({
      ai: createAiProvider({ AI_PROVIDER: 'mock', NODE_ENV: 'test' }),
      recipes: new InMemoryPlanRecipeSource(recipes.map((r) => (r.id === liked ? { ...r, ingredientNames: ['peanuts'] } : r))),
    });
    const parsed = await h.parsePlanRequest(svc, 'Plan seven dinners for four people', WEEK);
    if (!parsed.ok) throw new Error('parse');
    const res = await h.solvePlanRequest(svc, 'Plan seven dinners for four people', WEEK, { ...parsed.parsed.request, excludeTerms: ['peanuts'], favouritesOf: [], quickMeals: undefined });
    if (!res.ok) throw new Error('solve');
    expect(res.proposal.slots.some((s) => s.recipeId === liked)).toBe(false);
  });
});
