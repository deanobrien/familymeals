import { consentNoticeText, createPlanClient, describeError, parseDoc, parseIdeas, parsePage, parseProposal, parseRequest } from '@/lib/planApi';
import { ServerApiError } from '@/lib/serverApi';
import { addDays, dateShort, dayShort, mondayOf, weekDates, weekLabel } from '@/lib/plan/dates';
import {
  formatPence, markSlot, mealCost, moveEntry, removeEntry, setNote, setRecipe, setServings, shiftToWeek, slotKey, swapRecipe, weekCost, weekCostLabel, weekNutrition,
} from '@/lib/plan/ops';
import {
  addFavourite, addTerm, describeTarget, quickWeekdays, removeDietTarget, removeFavourite, removeTerm, setBudgetPounds, setDietTarget, setQuickMinutes,
  setQuickStrict, setServings as setReqServings, toggleQuickDay,
} from '@/lib/plan/requestChips';
import type { PlanDoc, PlanRequest, RecipeLite } from '@/lib/plan/types';
import { IDEAS, PARSED, PROPOSAL, WEEK, err, fakePlanApi, pageJson } from './helpers/planFixtures';

const empty = (): PlanDoc => ({ id: 'p1', householdId: 'h', weekStart: WEEK, mealTypes: ['dinner'], entries: {}, status: 'draft', updatedAt: '' });
const lite = (id: string, cost: number | null): RecipeLite => ({ id, title: id, tags: [], mealTypes: ['dinner'], baseServings: 4, costPerServingPence: cost, excludedBy: [] });
const R = new Map([lite('a', 100), lite('b', null)].map((r) => [r.id, r]));
const mon = { date: '2026-10-19', mealType: 'dinner' as const };
const tue = { date: '2026-10-20', mealType: 'dinner' as const };

describe('ported dates and plan ops (same cases as the web unit tests)', () => {
  it('finds the Monday and the week', () => {
    expect(mondayOf('2026-10-25')).toBe(WEEK);
    expect(mondayOf(WEEK)).toBe(WEEK);
    expect(weekDates(WEEK)).toHaveLength(7);
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(dayShort(WEEK)).toBe('Mon');
    expect(dateShort(WEEK)).toBe('19 Oct');
    expect(weekLabel(WEEK)).toBe('19 Oct to 25 Oct');
  });

  it('adds, swaps keeping servings, and reopens approved plans as drafts', () => {
    const a = setRecipe({ ...empty(), status: 'approved' }, mon, 'a', 4);
    expect(a.status).toBe('draft');
    expect(swapRecipe(setServings(a, mon, 6), mon, 'b').entries[slotKey(mon)]).toEqual({ kind: 'recipe', recipeId: 'b', servings: 6 });
  });

  it('moves, swaps on an occupied target, duplicates', () => {
    const d = setRecipe(setRecipe(empty(), mon, 'a', 4), tue, 'b', 2);
    const moved = moveEntry(d, mon, tue, 'move');
    expect(moved.entries[slotKey(tue)]).toMatchObject({ recipeId: 'a' });
    expect(moved.entries[slotKey(mon)]).toMatchObject({ recipeId: 'b' });
    expect(Object.keys(moveEntry(setRecipe(empty(), mon, 'a', 4), mon, tue, 'duplicate').entries)).toHaveLength(2);
    expect(moveEntry(setRecipe(empty(), mon, 'a', 4), mon, tue, 'move').entries[slotKey(mon)]).toBeUndefined();
  });

  it('marks eating out, keeps notes, removes, clamps servings', () => {
    const d = markSlot(setNote(setRecipe(empty(), mon, 'a', 4), mon, 'late shift'), mon, 'eating_out');
    expect(d.entries[slotKey(mon)]).toEqual({ kind: 'eating_out', note: 'late shift' });
    expect(removeEntry(d, mon).entries).toEqual({});
    expect(setServings(setRecipe(empty(), mon, 'a', 4), mon, 500).entries[slotKey(mon)]).toMatchObject({ servings: 99 });
  });

  it('reuses a previous week shifted onto a new one', () => {
    const next = shiftToWeek(setRecipe(empty(), tue, 'a', 3), '2026-10-26', 'p2');
    expect(next.id).toBe('p2');
    expect(next.entries['2026-10-27|dinner']).toMatchObject({ recipeId: 'a', servings: 3 });
    expect(next.status).toBe('draft');
  });

  it('never treats unknown cost as zero', () => {
    expect(mealCost({ kind: 'recipe', recipeId: 'b', servings: 4 }, R)).toEqual({ status: 'uncosted' });
    expect(mealCost({ kind: 'recipe', recipeId: 'a', servings: 4 }, R)).toEqual({ status: 'estimate', pence: 400 });
    expect(mealCost({ kind: 'eating_out' }, R)).toEqual({ status: 'none' });
    const c = weekCost(setRecipe(setRecipe(empty(), mon, 'a', 4), tue, 'b', 4), R);
    expect(c).toMatchObject({ knownPence: 400, costedMeals: 1, uncostedMeals: 1, status: 'partial' });
    expect(weekCostLabel(c)).toMatch(/At least £4\.00 \(estimate\); 1 meal uncosted/);
    expect(weekCostLabel(weekCost(empty(), R))).toMatch(/No meals/);
    expect(formatPence(1140)).toBe('£11.40');
  });

  it('weekly nutrition keeps unknown unknown', () => {
    expect(weekNutrition(empty(), R)).toBeNull();
    const n = weekNutrition(setRecipe(empty(), mon, 'a', 2), R)!;
    expect(n.meals).toBe(1);
    expect(n.mealsWithoutNutrition).toBe(1);
    expect(n.summary.totals.energy_kcal.status).not.toBe('zero');
  });
});

describe('ported constraint chip edits (same cases as the web unit tests)', () => {
  const base: PlanRequest = {
    days: 7, mealTypes: ['dinner'], servings: 4, budgetPence: 10000,
    dietProportions: { vegetarian: { fraction: 0.5 }, fish: { count: 2 } },
    excludeDietCategories: [], includeTags: [], excludeAllergens: [], excludeTerms: ['mushrooms'], favouritesOf: ['Lauren'],
    quickMeals: { dates: [], weekdays: ['mon', 'tue'], maxTotalMinutes: 30, strict: false },
  };

  it('describes every diet target form', () => {
    expect(describeTarget('vegetarian', { fraction: 0.5 })).toBe('Vegetarian: about 50%');
    expect(describeTarget('fish', { count: 2 })).toBe('Fish: 2 meals');
    expect(describeTarget('meat', { max: 1 })).toBe('Meat: at most 1 meal');
  });

  it('applies edits', () => {
    let r = base;
    r = setReqServings(r, 6); r = setBudgetPounds(r, 85.5);
    r = setDietTarget(r, 'vegan', 'min', 1); r = setDietTarget(r, 'meat', 'percent', 25);
    r = addTerm(r, 'Soy'); r = addFavourite(r, 'Sam'); r = toggleQuickDay(r, 'thu'); r = setQuickStrict(r, true); r = setQuickMinutes(r, 20);
    expect(r).toMatchObject({ servings: 6, budgetPence: 8550, excludeTerms: ['mushrooms', 'Soy'], favouritesOf: ['Lauren', 'Sam'] });
    expect(r.dietProportions).toMatchObject({ vegan: { min: 1 }, meat: { fraction: 0.25 } });
    expect(r.quickMeals).toMatchObject({ weekdays: ['mon', 'tue', 'thu'], maxTotalMinutes: 20, strict: true });
  });

  it('removes chips, de-duplicates, clears empty groups and clamps', () => {
    expect(removeTerm(base, 'MUSHROOMS').excludeTerms).toEqual([]);
    expect(addTerm(base, ' Mushrooms ')).toBe(base);
    expect(removeFavourite(base, 'lauren').favouritesOf).toEqual([]);
    expect(removeDietTarget(removeDietTarget(base, 'fish'), 'vegetarian').dietProportions).toBeUndefined();
    expect(setBudgetPounds(base, null).budgetPence).toBeUndefined();
    expect(setBudgetPounds(base, -5).budgetPence).toBeUndefined();
    expect(toggleQuickDay(toggleQuickDay(base, 'mon'), 'tue').quickMeals).toBeUndefined();
    expect(quickWeekdays(toggleQuickDay(base, 'fri'))).toEqual(['mon', 'tue', 'fri']);
    expect(setReqServings(base, 0).servings).toBe(1);
    expect(setReqServings(base, 500).servings).toBe(50);
  });
});

describe('defensive parsers', () => {
  it('parses a full page and drops what it cannot trust', () => {
    const p = parsePage({ ...pageJson(WEEK, { withheldExclusions: 2, recipes: [...pageJson(WEEK).recipes, { id: 5 }, null, 'x'] }), extra: 'ignored' });
    expect(p.recipes.map((r) => r.id)).toEqual(['r1', 'r2', 'r3', 'r4']);
    expect(p.recipes.find((r) => r.id === 'r4')!.costPerServingPence).toBeNull();
    expect(p.recipes.find((r) => r.id === 'r3')!.excludedBy).toEqual(['peanuts']);
    expect(p.withheldExclusions).toBe(2);
    expect(p.defaultServings).toBe(4);
  });

  it('survives garbage: bad entries dropped, defaults applied, no doc is a bad response', () => {
    const doc = parseDoc({ id: 'p', weekStart: WEEK, mealTypes: ['nonsense'], status: 'weird', entries: { a: { kind: 'recipe' }, b: 'x', c: { kind: 'recipe', recipeId: 'r1', servings: 3, note: 'hi' }, d: { kind: 'leftovers' } } })!;
    expect(doc.mealTypes).toEqual(['dinner']);
    expect(doc.status).toBe('draft');
    expect(Object.keys(doc.entries)).toEqual(['c', 'd']);
    expect(parseDoc(null)).toBeNull();
    expect(() => parsePage({})).toThrow(ServerApiError);
    expect(parsePage({ doc: { id: 'p', weekStart: WEEK }, recipes: 'no', saved: [{}, { id: 's', weekStart: WEEK, status: 'approved' }], withheldExclusions: -3 })).toMatchObject({
      recipes: [], saved: [{ id: 's', weekStart: WEEK, status: 'approved' }], withheldExclusions: 0, examplePrompt: '',
    });
  });

  it('normalises a request but keeps unknown keys so edits round trip', () => {
    const r = parseRequest({ servings: 'lots', excludeTerms: ['a', 3], strange: { keep: true }, mealTypes: ['dinner', 'brunch'] });
    expect(r).toMatchObject({ servings: 4, excludeTerms: ['a'], favouritesOf: [], mealTypes: ['dinner'], strange: { keep: true } });
  });

  it('parses a proposal: unknown cost stays null, bad slots/gaps dropped', () => {
    const p = parseProposal(PROPOSAL.proposal);
    expect(p.slots).toHaveLength(7);
    expect(p.slots[6]).toMatchObject({ recipeId: null, note: 'Needs a new recipe' });
    expect(p.report).toHaveLength(2);
    expect(p.ideas[0]!.criteria).toEqual({ dietCategory: 'fish', mealType: 'dinner' });
    expect(p.budgetPence).toBe(10000);
    const odd = parseProposal({ slots: [{ date: WEEK, mealType: 'brunch' }, { mealType: 'dinner' }], gaps: [{ date: WEEK, mealType: 'x' }], totalCostPence: 'x' });
    expect(odd.slots).toEqual([]);
    expect(odd.gaps).toEqual([]);
    expect(odd.totalCostPence).toBeNull();
    expect(parseProposal(null).slots).toEqual([]);
  });

  it('parses ideas defensively', () => {
    expect(parseIdeas(IDEAS).cards[0]).toMatchObject({ id: '5200', diet: 'fish', publisher: 'TheMealDB' });
    expect(parseIdeas({ cards: [{ id: 1 }, { id: 'x', title: 't', diet: 'bogus' }] }).cards).toMatchObject([{ id: 'x', diet: 'meat', ingredients: [] }]);
  });

  it('describeError keeps server violations, unmet items and gap needs', () => {
    const f = describeError(err(422, 'Cannot approve.', { violations: ['"Peanut satay" contains excluded ingredient(s): peanuts.'], unmet: [{ detail: 'Fish' }], gaps: [{ mealType: 'dinner' }, { mealType: 'dinner' }, { mealType: 'lunch' }] }, 'PLAN_REFUSED'));
    expect(f).toMatchObject({ message: 'Cannot approve.', violations: ['"Peanut satay" contains excluded ingredient(s): peanuts.'], unmet: ['Fish'], gapCount: 3 });
    expect(f.gapNeeds.map((n) => n.count)).toEqual([1, 2]); // lunch 1, dinner 2 (meal-type order)
    expect(describeError(new Error('boom')).message).toBe('boom');
    expect(describeError('x').message).toMatch(/Something went wrong/);
  });

  it('uses the same consent wording as the web (count only)', () => {
    expect(consentNoticeText(0)).toBeNull();
    expect(consentNoticeText(1)).toBe("1 allergy exclusion isn't being applied because consent hasn't been given");
    expect(consentNoticeText(3)).toBe("3 allergy exclusions aren't being applied because consent hasn't been given");
  });
});

describe('plan client', () => {
  it('sends the household and contract bodies, and rejects unexpected responses', async () => {
    const { api, calls, posts } = fakePlanApi({
      'POST /api/plan/parse': () => PARSED,
      'POST /api/plan/solve': () => PROPOSAL,
      'POST /api/plan/generate-shopping': () => ({ count: 12, href: '/shopping?plan=p', preview: [{ name: 'salmon', quantity: '2' }] }),
      'POST /api/plan/ideas': () => IDEAS,
    });
    const c = createPlanClient(api, 'hh-1');
    const page = await c.loadWeek('2026-10-22');
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/plan', payload: { householdId: 'hh-1', week: '2026-10-22' } });
    expect(page.doc.weekStart).toBe(WEEK);
    expect(await c.loadSaved(WEEK)).toBeNull();
    const parsed = await c.parse('plan', WEEK);
    expect(parsed.notes).toEqual(['We could not find a member called Bob.']);
    await c.solve('plan', WEEK, parsed.request);
    expect(posts('/api/plan/solve')[0]!.payload).toMatchObject({ householdId: 'hh-1', weekStart: WEEK, request: { excludeTerms: ['mushrooms'] } });
    expect((await c.generateShopping('p')).count).toBe(12);
    await c.findIdeas({ reason: 'r', count: 1, criteria: { dietCategory: 'fish' } }, { terms: ['x'], allergens: [], excludeDiets: [] });
    expect(posts('/api/plan/ideas')[0]!.payload).toMatchObject({ criteria: { dietCategory: 'fish' }, extra: { terms: ['x'] } });

    const bad = createPlanClient(fakePlanApi({ 'POST /api/plan/save': () => ({}), 'POST /api/plan/parse': () => ({}) }).api, 'hh-1');
    await expect(bad.save(page.doc)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
    await expect(bad.parse('p', WEEK)).rejects.toMatchObject({ code: 'BAD_RESPONSE' });
  });

  it('saves an idea through the draft then /api/extract/save, but not when the draft needs web review', async () => {
    const draft = { title: { value: 'Salmon traybake' }, issues: [] };
    const ok = fakePlanApi({ 'POST /api/plan/ideas/draft': () => ({ uploadId: 'u1', draft }), 'POST /api/extract/save': () => ({ id: 'rec-1' }) });
    expect(await createPlanClient(ok.api, 'hh-1').saveIdea('5200')).toEqual({ id: 'rec-1', title: 'Salmon traybake' });
    expect(ok.posts('/api/extract/save')[0]!.payload).toEqual({ uploadId: 'u1', draft });

    const blocked = fakePlanApi({ 'POST /api/plan/ideas/draft': () => ({ uploadId: 'u1', draft: { ...draft, issues: [{ blocking: true, message: 'Unknown ingredient' }] } }) });
    await expect(createPlanClient(blocked.api, 'hh-1').saveIdea('5200')).rejects.toMatchObject({ code: 'NEEDS_WEB_REVIEW' });
    expect(blocked.posts('/api/extract/save')).toHaveLength(0);
  });
});
