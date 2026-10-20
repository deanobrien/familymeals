import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../../../../lib/server/auth/request-auth';

let outcome: AuthOutcome;
const seen: Array<{ requested: string | undefined; authorization: string | null }> = [];
vi.mock('../../../../lib/server/auth/request-auth', () => ({
  resolveRequestAuth: async (req: Request, requested?: string) => {
    seen.push({ requested, authorization: req.headers.get('authorization') });
    return outcome;
  },
}));
const cookieTrap = () => { throw new Error('cookie session must not be used'); };
vi.mock('../../../../lib/server/auth/household-context', () => ({ getHouseholdContext: cookieTrap, requireHouseholdContext: cookieTrap }));
vi.mock('../../../../lib/server/context', () => ({ getAppContext: cookieTrap }));

const { GET, PUT, DELETE } = await import('./route');
const { POST: create } = await import('../route');
const { POST: favourite } = await import('./favourite/route');
const { POST: rematch } = await import('./rematch/route');
const { POST: duplicates } = await import('../duplicates/route');

const H = 'a2000000-0000-4000-8000-0000000000a2';
const ok = (over: Partial<Extract<AuthOutcome, { ok: true }>['auth']> = {}): AuthOutcome => ({
  ok: true,
  auth: { userId: 'u1', householdId: H, readOnly: false, dataContext: null, defaultServings: 6, ...over },
});
const MISSING = 'ffffffff-ffff-4fff-8fff-ffffffffffff';

const recipe = (title: string, over: Record<string, unknown> = {}) => ({
  title, description: '', imageUrl: null, sourceAttribution: '', sourceUrl: '', originalText: '', prepMinutes: 5, cookMinutes: 10,
  servings: 2, cuisine: 'British', mealType: 'dinner', diet: 'vegetarian', tags: [],
  ingredients: [
    { name: 'plain flour', quantity: { kind: 'exact', value: 200, unit: 'g', originalText: '200g' }, optional: false },
    { name: 'zzz mystery item', quantity: { kind: 'to_taste', originalText: 'to taste' }, optional: true },
  ],
  steps: ['Mix.'], ...over,
});
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const json = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

async function seedId(title: string): Promise<string> {
  const res = await create(new Request('http://t/api/recipes', json({ recipe: recipe(title) })));
  return (await res.json()).id;
}

beforeEach(() => {
  seen.length = 0;
  outcome = ok();
});

describe('GET /api/recipes/[id]', () => {
  it('401 unauthenticated; 404 for a bad uuid and an unknown id', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await GET(new Request('http://t/x'), ctx(MISSING))).status).toBe(401);
    outcome = ok();
    for (const id of ['not-a-uuid', MISSING]) {
      const res = await GET(new Request('http://t/x'), ctx(id));
      expect(res.status).toBe(404);
      expect((await res.json()).error).toMatchObject({ code: 'NOT_FOUND', retryable: false });
    }
  });

  it('returns the recipe, its calculation, household servings and link info', async () => {
    const id = await seedId('Detail Cake');
    const res = await GET(new Request(`http://t/x?householdId=${H}`, { headers: { authorization: 'Bearer good' } }), ctx(id));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const body = await res.json();
    expect(body.recipe).toMatchObject({ id, title: 'Detail Cake' });
    expect(body.recipe.ingredients).toHaveLength(2);
    expect(body.calc).toBeTruthy();
    expect(body.householdServings).toBe(6);
    expect(body.unlinkedCount).toBe(1);
    const linked = body.recipe.ingredients.find((i: { ingredientId?: string }) => i.ingredientId);
    expect(body.linkNames[linked.ingredientId]).toMatch(/flour/i);
    expect(seen.at(-1)).toEqual({ requested: H, authorization: 'Bearer good' });
  });
});

describe('PUT /api/recipes/[id]', () => {
  const put = (id: string, body: unknown) => PUT(new Request('http://t/x', { ...json(body), method: 'PUT' }), ctx(id));

  it('read-only households are refused; bad bodies are 400; unknown ids are 404', async () => {
    const id = await seedId('Edit Me');
    outcome = ok({ readOnly: true });
    expect((await put(id, { recipe: recipe('Edit Me') })).status).toBe(403);
    outcome = ok();
    expect((await put(id, {})).status).toBe(400);
    expect((await put(MISSING, { recipe: recipe('Never Saved') })).status).toBe(404);
    expect((await put('nope', { recipe: recipe('Never Saved') })).status).toBe(404);
  });

  it('updates in place; invalid input is 422', async () => {
    const id = await seedId('Edit Me Two');
    const res = await put(id, { recipe: recipe('Edit Me Two Renamed', { servings: 8 }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, id });
    const got = await (await GET(new Request('http://t/x'), ctx(id))).json();
    expect(got.recipe).toMatchObject({ title: 'Edit Me Two Renamed', servings: 8 });
    expect((await put(id, { recipe: recipe('', {}) })).status).toBe(422);
  });
});

describe('DELETE /api/recipes/[id]', () => {
  const del = (id: string) => DELETE(new Request(`http://t/x?householdId=${H}`, { method: 'DELETE' }), ctx(id));
  it('refuses read-only, deletes once, then 404', async () => {
    const id = await seedId('Delete Me');
    outcome = ok({ readOnly: true });
    expect((await del(id)).status).toBe(403);
    outcome = ok();
    const res = await del(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect((await del(id)).status).toBe(404);
    expect(seen.at(-1)?.requested).toBe(H);
    expect((await GET(new Request('http://t/x'), ctx(id))).status).toBe(404);
  });
});

describe('POST /api/recipes/[id]/favourite', () => {
  const fav = (id: string, body: unknown = {}) => favourite(new Request('http://t/x', json(body)), ctx(id));
  it('toggles on and off, 404 for unknown, 403 read-only, 401 unauthenticated', async () => {
    const id = await seedId('Fav Me');
    expect(await (await fav(id)).json()).toEqual({ ok: true, favourite: true });
    expect(await (await fav(id, { householdId: H })).json()).toEqual({ ok: true, favourite: false });
    expect(seen.at(-1)?.requested).toBe(H);
    expect((await fav(MISSING)).status).toBe(404);
    outcome = ok({ readOnly: true });
    expect((await fav(id)).status).toBe(403);
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await fav(id)).status).toBe(401);
  });
});

describe('POST /api/recipes/[id]/rematch', () => {
  const re = (id: string) => rematch(new Request('http://t/x', json({})), ctx(id));
  it('re-matches unlinked lines; 404 unknown; 403 read-only', async () => {
    const id = await seedId('Rematch Me');
    const res = await re(id);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, summary: { recipes: 1 } });
    const missing = await re(MISSING);
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, message: 'Recipe not found' });
    outcome = ok({ readOnly: true });
    expect((await re(id)).status).toBe(403);
  });
});

describe('POST /api/recipes/duplicates', () => {
  const dup = (body: unknown) => duplicates(new Request('http://t/x', json(body)));
  it('finds a same-title recipe, honours excludeId, and answers empty hits for invalid input', async () => {
    const id = await seedId('Twin Pie');
    const hits = (await (await dup({ title: 'Twin Pie', names: ['plain flour'] })).json()).hits;
    expect(hits).toEqual([{ id, title: 'Twin Pie' }]);
    expect((await (await dup({ title: 'Twin Pie', names: ['plain flour'], excludeId: id })).json()).hits).toEqual([]);
    expect(await (await dup({ title: 5 })).json()).toEqual({ hits: [] });
    expect(await (await dup({ title: 'Twin Pie', names: [1] })).json()).toEqual({ hits: [] });
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await dup({ title: 'Twin Pie', names: [] })).status).toBe(401);
  });
});
