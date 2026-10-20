// P1-A (D367): what cooking feeds the planner. "Don't suggest again" keeps a recipe out of PROPOSALS (it can still be placed
// by hand); ratings given while cooking reach the solver as a soft preference.
import { beforeEach, describe, expect, it } from 'vitest';
import { createAiProvider } from '@fr/ai';
import * as h from './handlers';
import { MemoryCookingStore, resetMemoryCooking } from '../cooking/memory-store';
import { InMemoryPlanRecipeSource, withCookingSignals } from './recipe-source';
import { DEMO_HOUSEHOLD_ID, createPlanServices } from './services';

const WEEK = '2026-10-19';
const svc = () => createPlanServices({ ai: createAiProvider({ AI_PROVIDER: 'mock', NODE_ENV: 'test' }), recipes: new InMemoryPlanRecipeSource() });
const store = new MemoryCookingStore();

beforeEach(() => resetMemoryCooking());

describe('dont-suggest', () => {
  it('a flagged recipe is never proposed, but is still plannable by hand', async () => {
    const s = svc();
    const before = await h.proposePlan(s, h.EXAMPLE_PROMPT, WEEK);
    if (!before.ok) throw new Error('expected a proposal');
    const used = [...new Set(before.proposal.slots.map((x) => x.recipeId).filter((x): x is string => !!x))];
    expect(used.length).toBeGreaterThan(0);
    const flagged = used.slice(0, 1);
    for (const id of flagged) await store.setDontSuggest(DEMO_HOUSEHOLD_ID, 'u1', id, true);

    const after = await h.proposePlan(svc(), h.EXAMPLE_PROMPT, WEEK);
    if (!after.ok) throw new Error('expected a proposal');
    const nowUsed = after.proposal.slots.map((x) => x.recipeId).filter((x): x is string => !!x);
    for (const id of flagged) expect(nowUsed).not.toContain(id);

    // manual placement of a flagged recipe still validates (a soft hide, not an exclusion)
    const data = await h.getPlanPageData(s, WEEK);
    expect(data.recipes.some((r) => r.id === used[0])).toBe(true);
  });
});

describe('signals wrapper', () => {
  it('adds the cooking rating mean and the flag to plan recipes', async () => {
    const wrapped = withCookingSignals(new InMemoryPlanRecipeSource(), async () => ({ dontSuggest: new Set(['06-fish-pie']), ratings: new Map([['01-tomato-pasta', 4.5]]) }));
    const all = await wrapped.list('h');
    expect(all.find((r) => r.id === '06-fish-pie')?.dontSuggest).toBe(true);
    expect(all.find((r) => r.id === '01-tomato-pasta')?.rating).toBe(4.5);
    expect(all.find((r) => r.id === '05-blurry-curry')).not.toHaveProperty('dontSuggest');
  });

  it('memory ratings come from marking recipes cooked', async () => {
    await store.markCooked('hh', 'u1', 'r1', { servings: 2, rating: 4 });
    await store.markCooked('hh', 'u2', 'r1', { servings: 2, rating: 5 });
    expect((await store.ratingMeans('hh')).get('r1')).toBe(4.5);
  });
});
