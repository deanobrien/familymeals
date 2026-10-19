import { describe, expect, it } from 'vitest';
import { createAiProvider, type AiProvider } from '@fr/ai';
import { PlanConstraintsSchema } from '@fr/domain';
import type { Candidate, SolveResult } from '@fr/plan-orchestrator';
import { withCanonicalIngredients } from '../../recipes/factory';
import { InMemoryRecipeRepository } from '../../recipes/memory-repository';
import { loadSeedRecipes } from '../../recipes/seed';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { createEngineSolver } from './engine-solver';
import { allergensForIngredients, createExclusionResolver, groupsForName, ingredientIdsForGroup } from './exclusions';
import * as h from './handlers';
import { RepositoryPlanRecipeSource } from './recipe-source';
import { createPlanServices } from './services';

const WEEK = '2026-10-19'; // Monday
const mockAi = (): AiProvider => createAiProvider({ AI_PROVIDER: 'mock', NODE_ENV: 'test' });
const cat = getIngredientCatalogue();
const idOf = (frag: string): string => {
  const i = cat.all.find((x) => x.name.toLowerCase().includes(frag));
  if (!i) throw new Error(`no catalogue ingredient like ${frag}`);
  return i.id;
};
const k = (over: Record<string, unknown> = {}) => PlanConstraintsSchema.parse({ startDate: WEEK, servings: 4, mealTypes: ['dinner'], days: 7, ...over });
const cand = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id, title: id, ingredientNames: [], tags: [], mealTypes: ['dinner'], dietCategory: 'meat', totalMinutes: 60, ...over,
});

describe('exclusion resolution (refdata catalogue, D132)', () => {
  it('maps what people type to UK-14 groups', () => {
    expect(groupsForName('Dairy')).toEqual(['milk']);
    expect(groupsForName('peanuts')).toEqual(['peanuts']);
    expect(groupsForName('tree nuts')).toEqual(['tree_nuts']);
    expect(groupsForName('nuts').sort()).toEqual(['peanuts', 'tree_nuts']);
    expect(groupsForName('mushrooms')).toEqual([]);
  });

  it('resolves terms to every matching ingredient id and allergens to groups with ids', () => {
    const r = createExclusionResolver()({ terms: ['mushrooms', 'peanuts'], allergens: ['gluten'] });
    expect(r.excludeIngredientIds.length).toBeGreaterThan(0);
    expect(r.excludeAllergens).toEqual(expect.arrayContaining(['peanuts', 'cereals_gluten']));
    expect(Object.keys(r.allergenGroups)).toEqual(expect.arrayContaining(['peanuts', 'cereals_gluten']));
    expect(r.allergenGroups.cereals_gluten!.length).toBeGreaterThan(0);
    // an allergen name nobody recognises is kept so the term net still sees it
    expect(createExclusionResolver()({ terms: [], allergens: ['kiwi'] }).excludeAllergens).toEqual(['kiwi']);
  });

  it('derives a recipe\'s allergens from its matched ingredient ids', () => {
    const flour = cat.all.find((i) => /flour/i.test(i.name))!;
    expect(allergensForIngredients([flour.id])).toContain('cereals_gluten');
    expect(ingredientIdsForGroup('cereals_gluten')).toContain(flour.id);
  });
});

describe('ID-based exclusions in the solver (allowUnverifiedIngredients = false)', () => {
  const solve = (c: ReturnType<typeof k>, cands: Candidate[]) => createEngineSolver().solve(c, cands, { weekStart: WEEK, servings: 4 }) as SolveResult;
  const used = (r: { slots: { recipeId: string | null }[] }) => new Set(r.slots.map((s) => s.recipeId));

  it('drops a recipe whose canonical id is excluded even when its name gives nothing away', () => {
    const resolved = createExclusionResolver()({ terms: ['mushrooms'], allergens: [] });
    const mushroomId = resolved.excludeIngredientIds[0]!;
    const res = solve(
      k({ days: 2, excludeTerms: ['mushrooms'], excludeIngredientIds: resolved.excludeIngredientIds }),
      [cand('funghi', { ingredientNames: ['the house special'], ingredientIds: [mushroomId] }), cand('plain', { ingredientIds: [idOf('onion')] })],
    );
    expect(used(res).has('funghi')).toBe(false);
    expect(used(res).has('plain')).toBe(true);
  });

  it('enforces UK-14 allergen groups by id and by declared allergens', () => {
    const r = createExclusionResolver()({ terms: [], allergens: ['peanuts'] });
    const peanutId = r.allergenGroups.peanuts![0]!;
    const c = k({ days: 3, excludeAllergens: r.excludeAllergens, allergenGroups: r.allergenGroups });
    const res = solve(c, [
      cand('byId', { ingredientIds: [peanutId] }),
      cand('declared', { allergens: ['peanuts'] }),
      cand('safe', { ingredientIds: [idOf('onion')] }),
    ]);
    expect([...used(res)].filter(Boolean)).toEqual(['safe']);
  });

  it('fails safe on unmatched lines: unverifiable under an exclusion, and always when they name an excluded term', () => {
    const c = k({ days: 3, excludeTerms: ['peanuts'] });
    const res = solve(c, [
      cand('mystery', { ingredientIds: [idOf('onion')], unmatchedLines: ['2 tbsp mystery paste'] }),
      cand('satay', { ingredientIds: [idOf('onion')], unmatchedLines: ['100g crunchy peanut sauce'] }),
      cand('verified', { ingredientIds: [idOf('onion')] }),
    ]);
    expect([...used(res)].filter(Boolean)).toEqual(['verified']);
    // with no exclusion at all, an unmatched line is not a problem
    const open = solve(k({ days: 3 }), [cand('mystery', { unmatchedLines: ['2 tbsp mystery paste'] })]);
    expect(used(open).has('mystery')).toBe(true);
  });

  it('re-validates at approval by id, not just by name', async () => {
    const resolved = createExclusionResolver()({ terms: ['mushrooms'], allergens: [] });
    const funghi = cand('funghi', { ingredientNames: ['the house special'], ingredientIds: [resolved.excludeIngredientIds[0]!] });
    const solver = createEngineSolver({ loadCandidates: async () => [funghi] });
    const v = await solver.validate({ slots: [{ date: WEEK, mealType: 'dinner', recipeId: 'funghi', servings: 4 }] }, k({ excludeTerms: ['mushrooms'], excludeIngredientIds: resolved.excludeIngredientIds }));
    expect(v.ok).toBe(false);
  });
});

describe('quick-meal days (soft with a strong weight; hard when "only quick")', () => {
  const quick = (id: string, minutes = 20): Candidate => cand(id, { totalMinutes: minutes, tags: ['quick'] });
  const slow = (id: string): Candidate => cand(id, { totalMinutes: 90 });
  const lib = [slow('s1'), slow('s2'), slow('s3'), slow('s4'), slow('s5'), slow('s6'), quick('q1'), quick('q2'), quick('q3')];
  const solve = (c: ReturnType<typeof k>, cands = lib) => createEngineSolver().solve(c, cands, { weekStart: WEEK, servings: 4 }) as SolveResult;
  const byDate = (r: { slots: { date: string; recipeId: string | null }[] }) => Object.fromEntries(r.slots.map((s) => [s.date, s.recipeId]));

  it('puts quick recipes on the busy weekdays when the library has enough', () => {
    const res = solve(k({ quickMeals: { weekdays: ['mon', 'tue', 'wed'], maxTotalMinutes: 30 } }));
    const d = byDate(res);
    for (const day of ['2026-10-19', '2026-10-20', '2026-10-21']) expect(d[day]).toMatch(/^q/);
    expect(res.report.find((r) => r.constraint === 'Quick meals')?.met).toBe(true);
  });

  it('is soft: with too few quick recipes it still fills every slot and reports the miss', () => {
    const res = solve(k({ quickMeals: { weekdays: ['mon', 'tue', 'wed', 'thu'], maxTotalMinutes: 30 } }), [slow('s1'), slow('s2'), slow('s3'), quick('q1')]);
    expect(res.slots.every((s) => s.recipeId)).toBe(true);
    expect(Object.values(byDate(res)).filter((x) => x === 'q1').length).toBeGreaterThanOrEqual(1);
    expect(res.report.find((r) => r.constraint === 'Quick meals')?.met).toBe(false);
  });

  it('strict ("only quick meals on Monday") is hard: slow recipes never land there, and validation rejects them', async () => {
    const strict = k({ quickMeals: { dates: [WEEK], maxTotalMinutes: 30, strict: true } });
    const res = solve(strict, [slow('s1'), slow('s2'), slow('s3'), slow('s4'), slow('s5'), slow('s6'), slow('s7')]);
    expect(byDate(res)[WEEK]).toBeNull(); // no quick recipe exists: the slot stays empty rather than break the rule
    const solver = createEngineSolver({ loadCandidates: async (ids) => lib.filter((c) => ids.includes(c.id)) });
    const bad = await solver.validate({ slots: [{ date: WEEK, mealType: 'dinner', recipeId: 's1', servings: 4 }] }, strict);
    expect(bad.ok).toBe(false);
    expect(bad.violations.join(' ')).toMatch(/only quick meals/);
    const good = await solver.validate({ slots: [{ date: WEEK, mealType: 'dinner', recipeId: 'q1', servings: 4 }] }, strict);
    expect(good.ok).toBe(true);
    const res2 = solve(strict);
    expect(byDate(res2)[WEEK]).toMatch(/^q/);
  });

  it("the brief's example prompt (mock AI, shared library store): household exclusions resolve to ids, quick days are reported", async () => {
    const source = new RepositoryPlanRecipeSource(new InMemoryRecipeRepository(withCanonicalIngredients(loadSeedRecipes())));
    const svc = createPlanServices({ ai: mockAi(), recipes: source });
    const res = await h.proposePlan(svc, h.EXAMPLE_PROMPT, WEEK);
    if (!res.ok) throw new Error(res.message);
    const c = res.proposal.constraints;
    expect(c.quickMeals).toMatchObject({ weekdays: ['mon', 'tue', 'wed', 'thu'], maxTotalMinutes: 30, strict: false });
    expect(c.allowUnverifiedIngredients).toBe(false);
    expect(c.excludeTerms).toContain('peanuts');
    expect(c.allergenGroups.peanuts?.length).toBeGreaterThan(0);
    expect(c.excludeIngredientIds.length).toBeGreaterThan(0);
    expect(res.proposal.report.map((r) => r.constraint)).toContain('Quick meals');
    // the only <= 30 min dinner in the seed library is Quick Veg Curry: it goes on one of the busy days
    const curry = (await source.list()).find((r) => r.title === 'Quick Veg Curry')!;
    const busy = res.proposal.slots.filter((s) => ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'].includes(s.date));
    expect(busy.some((s) => s.recipeId === curry.id)).toBe(true);
    expect(res.proposal.request).not.toHaveProperty('allergenGroups');
  });
});
