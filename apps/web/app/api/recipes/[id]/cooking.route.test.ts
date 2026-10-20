// P1-A (D360-D369): the bearer cooking routes (mark cooked, history, don't-suggest, substitutions, variant) in mock mode.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockProvider } from '@fr/ai';
import type { AuthOutcome } from '../../../../lib/server/auth/request-auth';

let outcome: AuthOutcome;
vi.mock('../../../../lib/server/auth/request-auth', () => ({ resolveRequestAuth: async () => outcome }));
const cookieTrap = () => { throw new Error('cookie session must not be used'); };
vi.mock('../../../../lib/server/auth/household-context', () => ({ getHouseholdContext: cookieTrap, requireHouseholdContext: cookieTrap }));
vi.mock('../../../../lib/server/context', () => ({ getAppContext: cookieTrap }));
vi.mock('../../../../lib/server/ai/provider', () => ({ settingsAiProvider: createMockProvider({ allowInProduction: true }) }));

const { GET: detail } = await import('./route');
const { POST: create } = await import('../route');
const { GET: cooking } = await import('./cooking/route');
const { POST: cooked } = await import('./cooked/route');
const { POST: dontSuggest } = await import('./dont-suggest/route');
const { POST: substitutions } = await import('./substitutions/route');
const { POST: variant } = await import('./variant/route');
const { GET: list } = await import('../route');
const { resetMemoryCooking } = await import('../../../../lib/server/cooking/memory-store');
const { resetPlanServices } = await import('../../../../lib/server/plan/services');

const H = 'a3000000-0000-4000-8000-0000000000a3';
const ok = (over: Partial<Extract<AuthOutcome, { ok: true }>['auth']> = {}): AuthOutcome => ({
  ok: true,
  auth: { userId: 'u1', householdId: H, readOnly: false, dataContext: null, defaultServings: 4, ...over },
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) => new Request('http://t/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const MISSING = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const recipeBody = (title: string) => ({
  title, description: '', imageUrl: null, sourceAttribution: '', sourceUrl: '', originalText: '', prepMinutes: 5, cookMinutes: 10,
  servings: 2, cuisine: 'British', mealType: 'dinner', diet: 'vegetarian', tags: [],
  ingredients: [
    { name: 'butter', quantity: { kind: 'exact', value: 100, unit: 'g', originalText: '100g' }, optional: false },
    { name: 'plain flour', quantity: { kind: 'exact', value: 200, unit: 'g', originalText: '200g' }, optional: false },
  ],
  steps: ['Melt the butter.', 'Simmer for 10-12 minutes.'],
});

async function seed(title: string): Promise<{ id: string; lines: Array<{ id: string; name: string }> }> {
  const res = await create(post({ recipe: recipeBody(title) }));
  const { id } = (await res.json()) as { id: string };
  const d = await (await detail(new Request('http://t/x'), ctx(id))).json();
  return { id, lines: d.recipe.ingredients };
}

beforeEach(() => {
  outcome = ok();
  resetMemoryCooking();
  resetPlanServices();
});

describe('mark as cooked, history and ratings', () => {
  it('records a cook with a rating and a private note, and shows it on the detail and the list', async () => {
    const { id } = await seed('Shortbread');
    const res = await cooked(post({ servings: 4, rating: 5, note: 'less sugar', notePrivate: true }), ctx(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ entry: { servings: 4, rating: 5, note: { text: 'less sugar', isPrivate: true } }, cooking: { cookedCount: 1, myRating: 5 } });

    const d = await (await detail(new Request('http://t/x'), ctx(id))).json();
    expect(d.cooking).toMatchObject({ cookedCount: 1, myRating: 5, history: [{ servings: 4 }] });
    expect(d.recipe).toMatchObject({ rating: 5, cooked: { cookedCount: 1 } });

    const l = await (await list(new Request('http://t/api/recipes?q=Shortbread'))).json();
    expect(l.items[0]).toMatchObject({ id, rating: 5, cooked: { cookedCount: 1 } });
    expect(l.items[0].cooked.lastCookedAt).toEqual(expect.any(String));

    const c = await (await cooking(new Request('http://t/x'), ctx(id))).json();
    expect(c.cooking.history).toHaveLength(1);
  });

  it('refuses bad values with field errors (422), an unknown recipe (404), and a read-only household (403)', async () => {
    const { id } = await seed('Flapjacks');
    const bad = await cooked(post({ servings: 0 }), ctx(id));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error).toMatchObject({ code: 'INVALID_INPUT', fieldErrors: { servings: expect.any(String) } });
    expect((await cooked(post({ servings: 2, rating: 9 }), ctx(id))).status).toBe(422);
    expect((await cooked(post({ servings: 2 }), ctx(MISSING))).status).toBe(404);
    expect((await cooked(post({ servings: 2 }), ctx('not-a-uuid'))).status).toBe(404);
    outcome = ok({ readOnly: true });
    const ro = await cooked(post({ servings: 2 }), ctx(id));
    expect(ro.status).toBe(403);
    expect((await ro.json()).error.code).toBe('READ_ONLY');
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await cooked(post({ servings: 2 }), ctx(id))).status).toBe(401);
  });

  it('don\'t suggest again toggles the flag', async () => {
    const { id } = await seed('Scones');
    expect(await (await dontSuggest(post({ value: true }), ctx(id))).json()).toMatchObject({ cooking: { dontSuggest: true } });
    expect(await (await dontSuggest(post({ value: false }), ctx(id))).json()).toMatchObject({ cooking: { dontSuggest: false } });
    expect((await dontSuggest(post({ value: 'yes' }), ctx(id))).status).toBe(400);
  });
});

describe('substitutions', () => {
  it('returns safe suggestions and drops the ones that clash with household exclusions (peanuts) before they leave the server', async () => {
    const { id, lines } = await seed('Cake');
    const butter = lines.find((l) => l.name === 'butter')!;
    const res = await substitutions(post({ lineId: butter.id }), ctx(id));
    expect(res.status).toBe(200);
    const body = await res.json();
    const names = body.suggestions.map((s: { substitute: string }) => s.substitute);
    expect(names).toEqual(expect.arrayContaining(['olive oil', 'margarine']));
    expect(names).not.toContain('peanut butter'); // the mock offers it; the demo household excludes peanuts
    expect(body.withheld).toBe(1);
    expect(body.exclusionsActive).toBe(true);
    expect(body.suggestions[0]).toMatchObject({ quantityGuidance: expect.any(String), effect: expect.any(String) });
  });

  it('withholds a substitute it cannot match to a known ingredient while exclusions are active (fail safe)', async () => {
    const egg = await create(post({ recipe: { ...recipeBody('Egg dish'), ingredients: [{ name: 'egg', quantity: { kind: 'exact', value: 2, unit: 'item', originalText: '2' }, optional: false }] } }));
    const eid = ((await egg.json()) as { id: string }).id;
    const detailEgg = await (await detail(new Request('http://t/x'), ctx(eid))).json();
    const r = await (await substitutions(post({ lineId: detailEgg.recipe.ingredients[0].id }), ctx(eid))).json();
    // the mock's flaxseed option is not in the ingredient catalogue, so it cannot be proven safe: withheld, never shown
    expect(r.suggestions.map((s: { substitute: string }) => s.substitute)).not.toContain('ground flaxseed');
    expect(r.withheldUnverifiable).toBeGreaterThanOrEqual(1);
  });

  it('404s for an unknown line or recipe, and 400 without a line', async () => {
    const { id } = await seed('Bread');
    expect((await substitutions(post({ lineId: 'nope' }), ctx(id))).status).toBe(404);
    expect((await substitutions(post({ lineId: 'x' }), ctx(MISSING))).status).toBe(404);
    expect((await substitutions(post({}), ctx(id))).status).toBe(400);
  });
});

describe('save as variant', () => {
  it('saves a COPY with the swap applied and leaves the original untouched', async () => {
    const { id, lines } = await seed('Biscuits');
    const butter = lines.find((l) => l.name === 'butter')!;
    const res = await variant(post({ swaps: [{ lineId: butter.id, name: 'margarine', guidance: 'Swap 1:1.' }] }), ctx(id));
    expect(res.status).toBe(200);
    const v = (await res.json()) as { id: string; title: string };
    expect(v.id).not.toBe(id);
    expect(v.title).toBe('Biscuits (no butter)');
    const copy = (await (await detail(new Request('http://t/x'), ctx(v.id))).json()).recipe;
    expect(copy.ingredients.map((i: { name: string }) => i.name)).toEqual(['margarine', 'plain flour']);
    expect(copy.ingredients[0].preparation).toContain('instead of butter');
    expect(copy.steps).toHaveLength(2);
    const original = (await (await detail(new Request('http://t/x'), ctx(id))).json()).recipe;
    expect(original.ingredients.map((i: { name: string }) => i.name)).toEqual(['butter', 'plain flour']);
    expect(original.title).toBe('Biscuits');
  });

  it('refuses a swap that clashes with the exclusions, whatever the client claims (422 EXCLUDED), and bad input', async () => {
    const { id, lines } = await seed('Brownies');
    const butter = lines.find((l) => l.name === 'butter')!;
    const bad = await variant(post({ swaps: [{ lineId: butter.id, name: 'peanut butter' }] }), ctx(id));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.code).toBe('EXCLUDED');
    const unknown = await variant(post({ swaps: [{ lineId: butter.id, name: 'mystery goo' }] }), ctx(id));
    expect(unknown.status).toBe(422); // unverifiable: fail safe
    expect((await variant(post({ swaps: [{ lineId: 'nope', name: 'margarine' }] }), ctx(id))).status).toBe(422);
    expect((await variant(post({ swaps: [] }), ctx(id))).status).toBe(422);
    expect((await variant(post({ swaps: [{ lineId: butter.id, name: 'margarine' }] }), ctx(MISSING))).status).toBe(404);
    outcome = ok({ readOnly: true });
    expect((await variant(post({ swaps: [{ lineId: butter.id, name: 'margarine' }] }), ctx(id))).status).toBe(403);
  });
});
