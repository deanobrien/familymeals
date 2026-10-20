// P1-B (D378/D379): soft per-person dislikes through the real planner stack (orchestrator + engine solver) and Discover.
import { describe, expect, it } from 'vitest';
import { createAiProvider, type AiProvider } from '@fr/ai';
import { dislikedByMembers, type Household } from '@fr/plan-orchestrator';
import { MockRecipeSource } from '@fr/recipe-sources';
import * as h from './handlers';
import { createPlanServices, demoHousehold } from './services';
import { InMemoryPlanRecipeSource, type PlanRecipe } from './recipe-source';
import { toEngineCandidate } from './engine-solver';
import { discoverSearch } from '../discover/service';

const WEEK = '2026-10-19';
const mockAi = (): AiProvider => createAiProvider({ AI_PROVIDER: 'mock', NODE_ENV: 'test' });

const recipe = (id: string, title: string, ingredientNames: string[], over: Partial<PlanRecipe> = {}): PlanRecipe => ({
  id, title, ingredientNames, ingredientLines: [], tags: [], mealTypes: ['dinner'], dietCategory: 'vegetarian', baseServings: 4, costPerServingPence: 200, ...over,
});

function services(dislikes: Record<string, string[]>, recipes: PlanRecipe[]) {
  const base = demoHousehold('h-dis');
  const household: Household = { ...base, hardExclusions: [], members: base.members.map((m) => (dislikes[m.id] ? { ...m, dislikes: dislikes[m.id]! } : m)) };
  return createPlanServices({ ai: mockAi(), recipes: new InMemoryPlanRecipeSource(recipes), household });
}

describe('dislikedByMembers', () => {
  const members = [
    { id: 'a', displayName: 'Ann', dislikes: ['mushrooms'] },
    { id: 'b', displayName: 'Bo', dislikes: ['olive', 'blue cheese'] },
    { id: 'c', displayName: 'Cy' },
  ];
  it('matches ingredient names, canonical names and unmatched lines; stems plurals; ignores members without dislikes', () => {
    expect(dislikedByMembers({ ingredientNames: ['chestnut mushroom', 'onion'] }, members)).toEqual(['a']);
    expect(dislikedByMembers({ ingredientNames: ['pasta'], canonicalNames: ['Olive oil'] }, members)).toEqual(['b']);
    expect(dislikedByMembers({ ingredientNames: ['salad'], unmatchedLines: ['100g crumbled blue cheese'] }, members)).toEqual(['b']);
    expect(dislikedByMembers({ ingredientNames: ['mushroom', 'olives'] }, members)).toEqual(['a', 'b']);
    expect(dislikedByMembers({ ingredientNames: ['rice'] }, members)).toEqual([]);
  });
  it('is carried to the engine candidate', () => {
    const c = toEngineCandidate({ id: 'x', title: 'X', ingredientNames: [], tags: [], mealTypes: ['dinner'], dietCategory: 'meat', dislikedBy: ['a'] }, 4);
    expect(c?.dislikedBy).toEqual(['a']);
  });
});

describe('planner: dislikes are soft', () => {
  const lib = [
    recipe('mush', 'Mushroom stroganoff', ['mushrooms', 'cream']),
    recipe('pie', 'Mushroom pie', ['mushrooms', 'pastry']),
    recipe('dhal', 'Lentil dhal', ['lentils', 'onion']),
    recipe('chilli', 'Bean chilli', ['beans', 'rice']),
    recipe('curry', 'Chickpea curry', ['chickpeas', 'rice']),
    recipe('pizza', 'Margherita pizza', ['dough', 'cheese']),
  ];

  it('avoids the recipes a member dislikes when there are enough others, and says so in the report', async () => {
    const s = services({ 'm-sam': ['mushrooms'] }, lib);
    const res = await h.proposePlan(s, 'Plan 4 dinners', WEEK);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const used = res.proposal.slots.map((x) => x.recipeId);
    expect(used.filter((id) => id === 'mush' || id === 'pie')).toEqual([]);
    expect(res.proposal.report.find((r) => r.constraint === 'Dislikes')?.met).toBe(true);
  });

  it('still plans a disliked recipe when nothing else fits (never a hard exclusion), flagged as only a preference', async () => {
    const s = services({ 'm-sam': ['mushrooms'] }, [recipe('mush', 'Mushroom stroganoff', ['mushrooms', 'cream'])]);
    const res = await h.proposePlan(s, 'Plan 1 dinner', WEEK);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.proposal.slots.some((x) => x.recipeId === 'mush')).toBe(true);
    const item = res.proposal.report.find((r) => r.constraint === 'Dislikes');
    expect(item?.met).toBe(false);
    expect(item?.detail).toMatch(/only a preference/i);
  });

  it('page data carries the members\' dislikes for the chips, and nothing when nobody has any', async () => {
    const page = await h.getPlanPageData(services({ 'm-sam': ['mushrooms', 'olives'] }, lib), WEEK);
    expect(page.memberDislikes).toEqual([{ memberName: 'Sam', terms: ['mushrooms', 'olives'] }]);
    expect((await h.getPlanPageData(services({}, lib), WEEK)).memberDislikes).toEqual([]);
  });

  it('dislikes never reach the AI request (the household context is an allow-list)', async () => {
    let seen = '';
    const ai = new Proxy(mockAi(), {
      get(t, p, r) {
        if (p === 'parsePlanPrompt') return (prompt: string, ctx: unknown, c?: unknown) => { seen = JSON.stringify(ctx); return (t as AiProvider).parsePlanPrompt(prompt, ctx as never, c as never); };
        return Reflect.get(t, p, r);
      },
    }) as AiProvider;
    const base = services({ 'm-sam': ['mushrooms'] }, lib);
    const s = createPlanServices({ ai, recipes: new InMemoryPlanRecipeSource(lib), household: base.household });
    await h.proposePlan(s, 'Plan 3 dinners', WEEK);
    expect(seen).not.toBe('');
    expect(seen).not.toMatch(/mushroom/i);
  });
});

describe('discover: dislikes sort lower, never hide', () => {
  const household = {
    hardExclusions: [],
    members: [{ id: 'm1', displayName: 'Sam', dislikes: ['salmon'] }],
  };
  it('puts recipes with a disliked ingredient after the others and marks them', async () => {
    const source = new MockRecipeSource();
    const plain = await discoverSearch({ q: 'salmon' }, { hardExclusions: [] }, {}, source);
    const withDislike = await discoverSearch({ q: 'salmon' }, household, {}, source);
    if (!plain.ok || !withDislike.ok) throw new Error('search failed');
    // nothing is hidden: same recipes, same count
    expect(withDislike.cards.map((c) => c.id).sort()).toEqual(plain.cards.map((c) => c.id).sort());
    expect(withDislike.withheld).toBe(plain.withheld);
    const flagged = withDislike.cards.filter((c) => c.dislikedBy?.length);
    expect(flagged.length).toBeGreaterThan(0);
    expect(flagged[0]!.dislikedBy).toEqual(['Sam']);
    // every flagged card comes after every unflagged one
    const firstFlagged = withDislike.cards.findIndex((c) => c.dislikedBy?.length);
    expect(withDislike.cards.slice(firstFlagged).every((c) => c.dislikedBy?.length)).toBe(true);
  });

  it('is unchanged when nobody dislikes anything', async () => {
    const source = new MockRecipeSource();
    const a = await discoverSearch({ q: 'a' }, { hardExclusions: [] }, {}, source);
    const b = await discoverSearch({ q: 'a' }, { hardExclusions: [], members: [{ id: 'm', displayName: 'X' }] }, {}, source);
    if (!a.ok || !b.ok) throw new Error('search failed');
    expect(b.cards.map((c) => c.id)).toEqual(a.cards.map((c) => c.id));
    expect(b.cards.every((c) => c.dislikedBy === undefined)).toBe(true);
  });
});
