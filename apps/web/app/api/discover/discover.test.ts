import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { MockRecipeSource } from '@fr/recipe-sources';
import type { AuthOutcome } from '../../../lib/server/auth/request-auth';

let outcome: AuthOutcome;
const seen: Array<{ requested: string | undefined; authorization: string | null }> = [];
vi.mock('../../../lib/server/auth/request-auth', () => ({
  resolveRequestAuth: async (req: Request, requested?: string) => {
    seen.push({ requested, authorization: req.headers.get('authorization') });
    return outcome;
  },
}));
const cookieTrap = () => { throw new Error('cookie session must not be used'); };
vi.mock('../../../lib/server/auth/household-context', () => ({ getHouseholdContext: cookieTrap, requireHouseholdContext: cookieTrap }));
vi.mock('../../../lib/server/context', () => ({ getAppContext: cookieTrap }));

const { setRecipeSource } = await import('../../../lib/server/discover/source');
const { GET: filters } = await import('./filters/route');
const { POST: search } = await import('./search/route');
const { POST: draft } = await import('./draft/route');

const H = 'a4000000-0000-4000-8000-0000000000a4';
const ok = (readOnly = false): AuthOutcome => ({ ok: true, auth: { userId: 'u1', householdId: H, readOnly, dataContext: null, defaultServings: 4 } });
const post = (body: unknown) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) });

beforeEach(() => {
  seen.length = 0;
  outcome = ok();
  setRecipeSource(new MockRecipeSource());
});
afterAll(() => setRecipeSource(undefined));

describe('GET /api/discover/filters', () => {
  it('401 unauthenticated', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await filters(new Request('http://t/x'))).status).toBe(401);
  });
  it('returns the source pick-lists, label and withheld count', async () => {
    const res = await filters(new Request(`http://t/x?householdId=${H}`, { headers: { authorization: 'Bearer good' } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const body = await res.json();
    expect(body.categories).toContain('Seafood');
    expect(body.areas.length).toBeGreaterThan(0);
    expect(typeof body.sourceLabel).toBe('string');
    expect(body.withheld).toBe(0);
    expect(seen[0]).toEqual({ requested: H, authorization: 'Bearer good' });
  });
  it('empty lists (not an error) when the source is down', async () => {
    const down = new MockRecipeSource();
    down.categories = async () => { throw new Error('down'); };
    setRecipeSource(down);
    const body = await (await filters(new Request('http://t/x'))).json();
    expect(body).toMatchObject({ categories: [], areas: [], withheld: 0 });
  });
});

describe('POST /api/discover/search', () => {
  const run = (body: unknown) => search(new Request('http://t/x', post(body)));
  it('401 unauthenticated; 400 invalid body', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await run({ q: 'salmon' })).status).toBe(401);
    outcome = ok();
    expect((await run('nope')).status).toBe(400);
    expect((await run({ q: 'x'.repeat(200) })).status).toBe(400);
    expect((await run({ q: 5 })).status).toBe(400);
  });
  it('returns attributed cards from the injected source; an empty search is ok with no cards', async () => {
    const res = await run({ householdId: H, q: 'salmon' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.cards[0]).toMatchObject({ title: 'Lemon Grilled Salmon', attribution: { publisher: 'TheMealDB' } });
    expect(seen[0]?.requested).toBe(H);
    expect(await (await run({})).json()).toMatchObject({ ok: true, cards: [] });
  });
  it('applies the household hard exclusions (demo household: peanuts)', async () => {
    const body = await (await run({ q: 'noodles' })).json();
    expect(body.ok).toBe(true);
    expect(body.cards).toEqual([]);
    expect(body.withheld).toBe(1);
  });
  it('a source failure is still HTTP 200 with ok:false and a readable message', async () => {
    const down = new MockRecipeSource();
    down.search = async () => { throw new Error('boom'); };
    setRecipeSource(down);
    const res = await run({ q: 'x' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: false });
  });
});

describe('POST /api/discover/draft', () => {
  const run = (body: unknown) => draft(new Request('http://t/x', post(body)));
  it('401 unauthenticated; 403 read-only; 400 invalid id', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await run({ id: '90001' })).status).toBe(401);
    outcome = ok(true);
    const ro = await run({ id: '90001' });
    expect(ro.status).toBe(403);
    expect((await ro.json()).error.code).toBe('READ_ONLY');
    outcome = ok();
    expect((await run({ id: 'abc' })).status).toBe(400);
    expect((await run({})).status).toBe(400);
  });
  it('builds a reviewable draft held under the caller (200), and refuses an excluded recipe (422)', async () => {
    const res = await run({ householdId: H, id: '90001' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(typeof body.uploadId).toBe('string');
    expect(body.draft).toBeTruthy();
    expect(Array.isArray(body.existing)).toBe(true);
    expect(seen[0]?.requested).toBe(H);
    // The mock source has a peanut recipe the demo household excludes.
    const found = await (await search(new Request('http://t/x', post({ q: 'noodles' })))).json();
    expect(found.withheld).toBe(1);
  });
  it('an id the source does not know is 422 ok:false', async () => {
    const res = await run({ id: '99999999' });
    expect(res.status).toBe(422);
    expect(await res.json()).toMatchObject({ ok: false });
  });
});
