import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../../../lib/server/auth/request-auth';

let outcome: AuthOutcome;
const seen: Array<{ requested: string | undefined; authorization: string | null }> = [];
vi.mock('../../../lib/server/auth/request-auth', () => ({
  resolveRequestAuth: async (req: Request, requested?: string) => {
    seen.push({ requested, authorization: req.headers.get('authorization') });
    return outcome;
  },
}));
// A bearer caller has no cookies: none of the cookie-session helpers may be reached by these routes.
const cookieTrap = () => { throw new Error('cookie session must not be used'); };
vi.mock('../../../lib/server/auth/household-context', () => ({ getHouseholdContext: cookieTrap, requireHouseholdContext: cookieTrap }));
vi.mock('../../../lib/server/context', () => ({ getAppContext: cookieTrap }));

const { GET, POST } = await import('./route');

const H = 'a1000000-0000-4000-8000-0000000000a1';
const ok = (over: Partial<Extract<AuthOutcome, { ok: true }>['auth']> = {}): AuthOutcome => ({
  ok: true,
  auth: { userId: 'u1', householdId: H, readOnly: false, dataContext: null, defaultServings: 4, ...over },
});

const recipeBody = (title: string, over: Record<string, unknown> = {}) => ({
  title,
  description: '',
  imageUrl: null,
  sourceAttribution: '',
  sourceUrl: '',
  originalText: '',
  prepMinutes: 5,
  cookMinutes: 10,
  servings: 2,
  cuisine: 'British',
  mealType: 'dinner',
  diet: 'vegetarian',
  tags: ['api-test'],
  ingredients: [{ name: 'plain flour', quantity: { kind: 'exact', value: 200, unit: 'g', originalText: '200g' }, optional: false }],
  steps: ['Mix.'],
  ...over,
});

const get = (qs = '', headers: Record<string, string> = {}) => GET(new Request(`http://t/api/recipes${qs}`, { headers }));
const post = (body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  POST(new Request('http://t/api/recipes', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));

beforeEach(() => {
  seen.length = 0;
  outcome = ok();
});

describe('GET /api/recipes', () => {
  it('refuses an unauthenticated caller and a household the caller is not in', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    const res = await get();
    expect(res.status).toBe(401);
    expect((await res.json()).error).toEqual({ code: 'UNAUTHENTICATED', message: 'no', retryable: false });
    outcome = { ok: false, status: 403, message: 'not yours' };
    expect((await get()).status).toBe(403);
  });

  it('lists seed recipes as slim cards with paging, filters and hasAny; uncached', async () => {
    const res = await get('?pageSize=5');
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/private, no-store/);
    const body = await res.json();
    expect(body.items.length).toBe(5);
    expect(body).toMatchObject({ pageSize: 5, page: 1, hasAny: true });
    expect(body.total).toBeGreaterThan(5);
    expect(body.pageCount).toBe(Math.ceil(body.total / 5));
    expect(Array.isArray(body.cuisines)).toBe(true);
    expect(Array.isArray(body.tags)).toBe(true);
    const first = body.items[0];
    expect(Object.keys(first).sort()).toEqual(
      ['cookMinutes', 'cost', 'costPerServingPence', 'cuisine', 'diet', 'favourite', 'id', 'imageUrl', 'mealType', 'prepMinutes', 'rating', 'servings', 'tags', 'title'],
    );
    expect(first).not.toHaveProperty('ingredients');
    expect(first).not.toHaveProperty('steps');
    expect(first).not.toHaveProperty('originalText');
  });

  it('defaults to 20 per page, caps at 50, and honours q, sort and page', async () => {
    expect((await (await get()).json()).pageSize).toBe(20);
    expect((await (await get('?pageSize=500')).json()).pageSize).toBe(50);
    expect((await (await get('?pageSize=junk')).json()).pageSize).toBe(20);
    const all = (await (await get('?pageSize=50')).json()).items.map((r: { title: string }) => r.title);
    expect(all).toEqual([...all].sort((a, b) => a.localeCompare(b)));
    const none = await (await get('?q=zzzz-no-such-recipe')).json();
    expect(none).toMatchObject({ total: 0, items: [], hasAny: true });
  });

  it('passes the household and the Authorization header to the auth layer', async () => {
    await get(`?householdId=${H}`, { authorization: 'Bearer good' });
    expect(seen[0]).toEqual({ requested: H, authorization: 'Bearer good' });
  });
});

describe('POST /api/recipes', () => {
  it('refuses unauthenticated callers and read-only households', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await post({ recipe: recipeBody('X') })).status).toBe(401);
    outcome = ok({ readOnly: true });
    const res = await post({ recipe: recipeBody('X') });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('READ_ONLY');
  });

  it('accepts only application/json (a cross-site form post cannot be made to look like one)', async () => {
    const res = await post(JSON.stringify({ recipe: recipeBody('X') }), { 'content-type': 'text/plain' });
    expect(res.status).toBe(415);
    expect(seen.length).toBe(0); // refused before the caller is even resolved
    expect((await post(JSON.stringify({ recipe: recipeBody('X') }), {})).status).toBe(415);
  });

  it('validates the body', async () => {
    expect((await post('not json')).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ recipe: 'x' })).status).toBe(400);
  });

  it('answers 422 with field errors for an invalid recipe', async () => {
    const res = await post({ recipe: recipeBody('', { ingredients: [] }) });
    expect(res.status).toBe(422);
    const out = await res.json();
    expect(out.ok).toBe(false);
    expect(out.fieldErrors.title).toBeTruthy();
    expect(out.fieldErrors.ingredients).toBeTruthy();
  });

  it('saves (200 + id + links), then 422 with duplicates until force is set', async () => {
    const res = await post({ householdId: H, recipe: recipeBody('Api Pancakes') }, { 'content-type': 'application/json', authorization: 'Bearer good' });
    expect(res.status).toBe(200);
    const saved = await res.json();
    expect(saved).toMatchObject({ ok: true });
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(Array.isArray(saved.links)).toBe(true);
    expect(seen[0]).toEqual({ requested: H, authorization: 'Bearer good' });

    const dup = await post({ recipe: recipeBody('Api Pancakes') });
    expect(dup.status).toBe(422);
    const dupBody = await dup.json();
    expect(dupBody.ok).toBe(false);
    expect(dupBody.duplicates.map((d: { id: string }) => d.id)).toContain(saved.id);

    const forced = await post({ recipe: recipeBody('Api Pancakes'), force: true });
    expect(forced.status).toBe(200);
    expect((await forced.json()).id).not.toBe(saved.id);
  });
});
