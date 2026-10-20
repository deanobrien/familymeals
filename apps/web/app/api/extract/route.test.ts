import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../../../lib/server/auth/request-auth';

// The auth layer is exercised in lib/server/auth/request-auth.test.ts; here it is the route's contract that matters.
let outcome: AuthOutcome;
const seen: Array<{ requested: string | undefined; authorization: string | null }> = [];
vi.mock('../../../lib/server/auth/request-auth', () => ({
  resolveRequestAuth: async (req: Request, requested?: string) => {
    seen.push({ requested, authorization: req.headers.get('authorization') });
    return outcome;
  },
}));

const { POST: extract } = await import('./route');
const { POST: save } = await import('./save/route');
const { getRecipeRepositoryFor } = await import('../../../lib/recipes/factory');

const PNG = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
);
const H = 'aa000000-0000-4000-8000-0000000000aa';
const who = (userId: string, householdId = H): AuthOutcome => ({ ok: true, auth: { userId, householdId, readOnly: false, dataContext: null, defaultServings: 4 } });

function extractReq(householdId: string | undefined, authorization = 'Bearer good') {
  const form = new FormData();
  form.append('images', new File([PNG], 'p.png', { type: 'image/png' }));
  if (householdId) form.append('householdId', householdId);
  return new Request('http://t/api/extract', { method: 'POST', body: form, headers: { authorization } });
}
const saveReq = (body: unknown, authorization = 'Bearer good') =>
  new Request('http://t/api/extract/save', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', authorization } });

beforeEach(() => {
  seen.length = 0;
});

describe('POST /api/extract and /api/extract/save accept a bearer-authenticated caller (D74, D102)', () => {
  it('rejects an unauthenticated / unverified caller before any extraction', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    const res = await extract(extractReq(H));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
    expect((await save(saveReq({ uploadId: 'x', draft: {} }))).status).toBe(401);
  });

  it('passes the multipart householdId and the Authorization header to the auth layer; non-members get 403', async () => {
    outcome = { ok: false, status: 403, message: 'not a member' };
    const res = await extract(extractReq(H));
    expect(res.status).toBe(403);
    expect(seen[0]).toEqual({ requested: H, authorization: 'Bearer good' });
  });

  it('refuses writes while the household is pending deletion', async () => {
    outcome = { ok: true, auth: { userId: 'u', householdId: H, readOnly: true, dataContext: null, defaultServings: 4 } };
    expect((await extract(extractReq(H))).status).toBe(403);
  });

  it('extracts, then saves into the caller household through the active RecipeSink; web cookie callers behave the same', async () => {
    outcome = who('user-1');
    const ex = await extract(extractReq(H));
    expect(ex.status).toBe(200);
    const body = (await ex.json()) as { uploadId: string; draft: { title: { value: string } } };
    const before = (await getRecipeRepositoryFor(H).list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 100 })).total;
    const sv = await save(saveReq({ uploadId: body.uploadId, draft: body.draft }));
    expect(sv.status).toBe(200);
    const { id } = (await sv.json()) as { id: string };
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect((await getRecipeRepositoryFor(H).get(id))?.title).toBe(body.draft.title.value);
    expect((await getRecipeRepositoryFor(H).list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 100 })).total).toBe(before + 1);
    // save takes the household from the upload, not from the request
    expect(seen.at(-1)?.requested).toBe(H);
  });

  it("another user cannot save, or retry, someone else's upload", async () => {
    outcome = who('user-1');
    const ex = await extract(extractReq(H));
    const body = (await ex.json()) as { uploadId: string; draft: unknown };
    outcome = who('user-2');
    expect((await save(saveReq({ uploadId: body.uploadId, draft: body.draft }))).status).toBe(410);
    const retry = await extract(new Request('http://t/api/extract', { method: 'POST', body: JSON.stringify({ uploadId: body.uploadId }), headers: { 'content-type': 'application/json' } }));
    expect(retry.status).toBe(410);
    outcome = who('user-1', 'bb000000-0000-4000-8000-0000000000bb'); // same user, different household
    expect((await save(saveReq({ uploadId: body.uploadId, draft: body.draft }))).status).toBe(410);
  });
});
