// P3-A (D420-D429): the bearer / public routes the Android app uses for share links and kids' mode, in mock mode.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../../../lib/server/auth/request-auth';

let outcome: AuthOutcome;
vi.mock('../../../lib/server/auth/request-auth', () => ({ resolveRequestAuth: async () => outcome }));
const cookieTrap = () => { throw new Error('cookie session must not be used'); };
vi.mock('../../../lib/server/auth/household-context', () => ({ getHouseholdContext: cookieTrap, requireHouseholdContext: cookieTrap, getAuthState: cookieTrap }));
vi.mock('../../../lib/server/context', () => ({ getAppContext: cookieTrap }));

const shares = await import('./route');
const preview = await import('./preview/route');
const save = await import('./save/route');
const image = await import('./[token]/image/[recipeId]/route');
const kids = await import('../kids/route');
const { getRecipeRepositoryFor } = await import('../../../lib/recipes/factory');
const { resetMemoryShares } = await import('../../../lib/server/sharing/store');
const { resetShareLimits } = await import('../../../lib/server/sharing/rate-limit');
const { resetMemoryKids } = await import('../../../lib/server/kids/store');
const { resetPlanServices } = await import('../../../lib/server/plan/services');

const HA = 'a4000000-0000-4000-8000-0000000000a4';
const HB = 'b4000000-0000-4000-8000-0000000000b4';
const as = (householdId: string, userId: string, readOnly = false): AuthOutcome => ({
  ok: true, auth: { userId, householdId, readOnly, dataContext: null, defaultServings: 4 },
});
const post = (body: unknown, h: string) => new Request('http://t/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ householdId: h, ...(body as object) }) });
const get = (path: string) => new Request(`http://t/${path}`);

async function recipeIds(h: string, n: number): Promise<string[]> {
  const page = await getRecipeRepositoryFor(h).list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 50 });
  return page.items.slice(0, n).map((r) => r.id);
}

beforeEach(() => {
  outcome = as(HA, 'alice');
  resetMemoryShares();
  resetShareLimits();
  resetMemoryKids();
  resetPlanServices();
});

describe('/api/shares', () => {
  it('create -> list -> preview as another household -> save -> revoke -> generic not available', async () => {
    const [rid] = await recipeIds(HA, 1);
    const created = await shares.POST(post({ action: 'create', scope: 'recipe', recipeIds: [rid], expiresInDays: 30 }, HA));
    expect(created.status).toBe(200);
    const { share } = await created.json();
    expect(share.token).toMatch(/^[0-9a-f]{64}$/);
    expect(share.path).toBe(`/s/${share.token}`);

    const listed = await (await shares.GET(get(`api/shares?householdId=${HA}`))).json();
    expect(listed.shares).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(share.token);

    outcome = as(HB, 'bob');
    const p = await (await preview.POST(post({ token: share.token }, HB))).json();
    expect(p.signedIn).toBe(true);
    expect(p.preview.kind).toBe('full');
    expect(JSON.stringify(p)).not.toMatch(/favourite|"rating"|originalText/);

    const saved = await save.POST(post({ token: share.token, recipeId: rid }, HB));
    expect(saved.status).toBe(200);
    const copy = await saved.json();
    expect((await getRecipeRepositoryFor(HB).get(copy.recipeId))!.sourceAttribution).toContain('Shared by');
    expect((await save.POST(post({ token: share.token, recipeId: '11111111-1111-4111-8111-111111111111' }, HB))).status).toBe(404);

    outcome = as(HB, 'bob');
    expect((await shares.POST(post({ action: 'revoke', shareId: share.id }, HB))).status).toBe(404); // not Bob's share
    outcome = as(HA, 'alice');
    expect((await shares.POST(post({ action: 'revoke', shareId: share.id }, HA))).status).toBe(200);
    outcome = as(HB, 'bob');
    expect((await (await preview.POST(post({ token: share.token }, HB))).json()).preview).toEqual({ kind: 'invalid' });
    expect((await save.POST(post({ token: share.token, recipeId: rid }, HB))).status).toBe(404);
  });

  it('a signed-out visitor (no credentials) gets the minimal preview; a bad token is the same as an unknown one', async () => {
    const [rid] = await recipeIds(HA, 1);
    const { share } = await (await shares.POST(post({ action: 'create', scope: 'recipe', recipeIds: [rid], expiresInDays: null }, HA))).json();
    outcome = { ok: false, status: 401, message: 'Please sign in.' };
    const min = await (await preview.POST(post({ token: share.token }, HA))).json();
    expect(min.signedIn).toBe(false);
    expect(min.preview.kind).toBe('minimal');
    expect(JSON.stringify(min)).not.toMatch(/ingredients|steps/);
    expect((await (await preview.POST(post({ token: 'nope' }, HA))).json()).preview).toEqual({ kind: 'invalid' });
    expect((await preview.POST(new Request('http://t/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '[]' }))).status).toBe(400);
  });

  it('a rejected bearer token is refused, not downgraded to signed out', async () => {
    outcome = { ok: false, status: 401, message: 'Your sign-in was not accepted.' };
    const req = new Request('http://t/x', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer abc' }, body: JSON.stringify({ token: 'a'.repeat(64) }) });
    expect((await preview.POST(req)).status).toBe(401);
  });

  it('images: only a signed-in viewer of a live share; everything else is a plain 404', async () => {
    const [rid] = await recipeIds(HA, 1);
    const { share } = await (await shares.POST(post({ action: 'create', scope: 'recipe', recipeIds: [rid], expiresInDays: 7 }, HA))).json();
    const ctx = (token: string, recipeId: string) => ({ params: Promise.resolve({ token, recipeId }) });
    outcome = as(HB, 'bob');
    expect((await image.GET(get('x'), ctx('0'.repeat(64), rid))).status).toBe(404);
    expect((await image.GET(get('x'), ctx(share.token, 'not-a-uuid'))).status).toBe(404);
    outcome = { ok: false, status: 401, message: 'Please sign in.' };
    expect((await image.GET(get('x'), ctx(share.token, rid))).status).toBe(404);
  });

  it('refuses writes while the household is read-only, and non-JSON bodies', async () => {
    const [rid] = await recipeIds(HA, 1);
    outcome = as(HA, 'alice', true);
    expect((await shares.POST(post({ action: 'create', scope: 'recipe', recipeIds: [rid] }, HA))).status).toBe(403);
    outcome = as(HA, 'alice');
    const form = new Request('http://t/x', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
    expect((await shares.POST(form)).status).toBe(415);
    expect((await shares.POST(post({ action: 'dance' }, HA))).status).toBe(400);
  });
});

describe('/api/kids', () => {
  it('profiles, a round, kid + member votes, closing, and a closed round refusing votes', async () => {
    const ids = await recipeIds(HA, 4);
    const k = await kids.POST(post({ action: 'addKid', displayName: 'Mia', avatar: '🦊', colour: 'blue' }, HA));
    expect(k.status).toBe(200);
    const { kid } = await k.json();
    expect((await kids.POST(post({ action: 'addKid', displayName: 'mia@example.com', avatar: '🦊', colour: 'blue' }, HA))).status).toBe(422);

    expect((await kids.POST(post({ action: 'openRound', recipeIds: ids.slice(0, 2) }, HA))).status).toBe(422);
    const opened = await kids.POST(post({ action: 'openRound', recipeIds: ids.slice(0, 3), title: 'Tonight' }, HA));
    expect(opened.status).toBe(200);
    const { roundId } = await opened.json();

    expect((await kids.POST(post({ action: 'vote', roundId, recipeId: ids[0], kidId: kid.id, value: 'heart' }, HA))).status).toBe(200);
    expect((await kids.POST(post({ action: 'vote', roundId, recipeId: ids[1], value: 'up' }, HA))).status).toBe(200);
    expect((await kids.POST(post({ action: 'vote', roundId, recipeId: ids[3], value: 'up' }, HA))).status).toBe(404); // not a candidate
    expect((await kids.POST(post({ action: 'vote', roundId, recipeId: ids[0], value: 'meh' }, HA))).status).toBe(422);

    const view = await (await kids.GET(get(`api/kids?householdId=${HA}`))).json();
    const round = view.kids.rounds[0];
    expect(round.open).toBe(true);
    expect(round.candidates.find((c: { recipeId: string }) => c.recipeId === ids[0])).toMatchObject({ heart: 1, up: 0, score: 2 });
    expect(view.kids.me).toBe('alice');

    outcome = as(HB, 'bob');
    expect((await (await kids.GET(get(`api/kids?householdId=${HB}`))).json()).kids.rounds).toEqual([]); // another household sees nothing
    outcome = as(HA, 'alice');
    expect((await kids.POST(post({ action: 'closeRound', roundId }, HA))).status).toBe(200);
    expect((await kids.POST(post({ action: 'vote', roundId, recipeId: ids[2], value: 'up' }, HA))).status).toBe(409);
    const closed = (await (await kids.GET(get(`api/kids?householdId=${HA}`))).json()).kids.rounds[0];
    expect(closed.open).toBe(false);
    expect(closed.candidates.filter((c: { winner: boolean }) => c.winner).map((c: { recipeId: string }) => c.recipeId)).toEqual([ids[0]]);
  });

  it('a round closes by itself at its closing time', async () => {
    const ids = await recipeIds(HA, 3);
    const soon = new Date(Date.now() + 60_000).toISOString();
    const { roundId } = await (await kids.POST(post({ action: 'openRound', recipeIds: ids, closesAt: soon }, HA))).json();
    expect((await kids.POST(post({ action: 'openRound', recipeIds: ids, closesAt: '2020-01-01T00:00:00Z' }, HA))).status).toBe(422);
    const { memoryKidsRoundForTest } = await import('../../../lib/server/kids/store');
    memoryKidsRoundForTest(HA, roundId)!.closesAt = new Date(Date.now() - 1000).toISOString();
    expect((await kids.POST(post({ action: 'vote', roundId, recipeId: ids[0], value: 'up' }, HA))).status).toBe(409);
    expect((await (await kids.GET(get(`api/kids?householdId=${HA}`))).json()).kids.rounds[0].open).toBe(false);
  });
});
