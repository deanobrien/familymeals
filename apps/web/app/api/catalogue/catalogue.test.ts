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
const cookieTrap = () => { throw new Error('cookie session must not be used'); };
vi.mock('../../../lib/server/auth/household-context', () => ({ getHouseholdContext: cookieTrap, requireHouseholdContext: cookieTrap }));
vi.mock('../../../lib/server/context', () => ({ getAppContext: cookieTrap }));

const { GET: search } = await import('./search/route');
const { POST: match } = await import('./match/route');

const H = 'a3000000-0000-4000-8000-0000000000a3';
const ok: AuthOutcome = { ok: true, auth: { userId: 'u1', householdId: H, readOnly: false, dataContext: null, defaultServings: 4 } };
const q = (s: string, headers: Record<string, string> = {}) => search(new Request(`http://t/api/catalogue/search?${s}`, { headers }));
const m = (body: unknown) => match(new Request('http://t/api/catalogue/match', { method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body) }));

beforeEach(() => {
  seen.length = 0;
  outcome = ok;
});

describe('GET /api/catalogue/search', () => {
  it('401 unauthenticated', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await q('q=flour')).status).toBe(401);
  });
  it('finds candidates; fewer than 2 characters is empty; passes household and Authorization on', async () => {
    const res = await q(`q=flour&householdId=${H}`, { authorization: 'Bearer good' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const { candidates } = await res.json();
    expect(candidates.length).toBeGreaterThan(0);
    expect(Object.keys(candidates[0]).sort()).toEqual(['id', 'name']);
    expect(seen[0]).toEqual({ requested: H, authorization: 'Bearer good' });
    expect(await (await q('q=f')).json()).toEqual({ candidates: [] });
    expect(await (await q('')).json()).toEqual({ candidates: [] });
  });
});

describe('POST /api/catalogue/match', () => {
  it('401 unauthenticated; 400 for a bad body or more than 100 names', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await m({ names: ['flour'] })).status).toBe(401);
    outcome = ok;
    expect((await m('nope')).status).toBe(400);
    expect((await m({})).status).toBe(400);
    expect((await m({ names: [1] })).status).toBe(400);
    expect((await m({ names: Array(101).fill('flour') })).status).toBe(400);
  });
  it('suggests a link per name (matched and unmatched)', async () => {
    const res = await m({ householdId: H, names: ['plain flour', 'zzz mystery item'] });
    expect(res.status).toBe(200);
    const { suggestions } = await res.json();
    expect(suggestions).toHaveLength(2);
    expect(suggestions[0]).toMatchObject({ status: 'matched' });
    expect(suggestions[1]).toMatchObject({ status: 'unmatched' });
    expect(seen[0]?.requested).toBe(H);
  });
});
