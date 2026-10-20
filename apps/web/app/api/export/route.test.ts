import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExportCaller } from '../../../lib/server/export/caller';

let caller: ExportCaller;
const seen: Array<{ requested: string | undefined; authorization: string | null; inferFirst: boolean | undefined }> = [];
vi.mock('../../../lib/server/export/caller', () => ({
  resolveExportCaller: async (req: Request, requested: string | undefined, opts?: { inferFirst?: boolean }) => {
    seen.push({ requested, authorization: req.headers.get('authorization'), inferFirst: opts?.inferFirst });
    return caller;
  },
}));

const started: Array<{ scope: string }> = [];
let startResult: unknown;
let downloadResult: Response | null;
vi.mock('../../../lib/server/export/service', () => ({
  startExport: async (_ctx: unknown, scope: string) => {
    started.push({ scope });
    return startResult;
  },
  downloadExport: async () => downloadResult,
}));

const { POST } = await import('./route');
const { GET } = await import('./[id]/route');

const H = 'aa000000-0000-4000-8000-0000000000aa';
const ctx = { user: { id: 'u1', email: 'a@b.test' }, household: { id: H }, memberships: [], supabase: {}, mode: 'supabase', isOwner: true } as never;
const okCaller: ExportCaller = { ok: true, ctx, dataContext: null };
const post = (body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  POST(new Request('http://t/api/export', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));

beforeEach(() => {
  seen.length = 0;
  started.length = 0;
  caller = okCaller;
  startResult = { ok: true, ticket: { id: 'e1', expiresAt: '2026-10-21T10:00:00Z' } };
  downloadResult = new Response('zip', { status: 200 });
});

describe('POST /api/export', () => {
  it('needs a JSON body', async () => {
    expect((await post({ scope: 'member' }, { 'content-type': 'text/plain' })).status).toBe(415);
  });
  it('answers 401 for an unauthenticated caller before looking at the body', async () => {
    caller = { ok: false, status: 401, error: 'unauthenticated' };
    const res = await post('not json');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'unauthenticated' });
  });
  it('maps a refused Bearer household to 403 / 400', async () => {
    caller = { ok: false, status: 403, error: 'forbidden' };
    expect((await post({ scope: 'member', householdId: H })).status).toBe(403);
    caller = { ok: false, status: 400, error: 'invalid_input' };
    expect((await post({ scope: 'member' })).status).toBe(400);
  });
  it('validates the scope', async () => {
    expect((await post({ scope: 'everything' })).status).toBe(400);
    expect((await post('not json')).status).toBe(400);
    expect(started).toHaveLength(0);
  });
  it('starts the export and answers the ticket (uncached); passes householdId and the Authorization header to the caller resolver', async () => {
    const res = await post({ scope: 'household', householdId: H }, { 'content-type': 'application/json', authorization: 'Bearer good' });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ id: 'e1', downloadUrl: '/api/export/e1', expiresAt: '2026-10-21T10:00:00Z' });
    expect(started).toEqual([{ scope: 'household' }]);
    expect(seen[0]).toEqual({ requested: H, authorization: 'Bearer good', inferFirst: undefined });
  });
  it('maps rate limiting (with Retry-After), forbidden and failures', async () => {
    startResult = { ok: false, reason: 'rate_limited', retryAfter: new Date(Date.now() + 3_600_000).toISOString() };
    const limited = await post({ scope: 'member' });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(3000);
    expect((await limited.json()).error).toBe('rate_limited');
    startResult = { ok: false, reason: 'forbidden' };
    expect((await post({ scope: 'household' })).status).toBe(403);
    startResult = { ok: false, reason: 'error' };
    expect((await post({ scope: 'member' })).status).toBe(500);
  });
});

describe('GET /api/export/<id>', () => {
  const get = (headers: Record<string, string> = {}) => GET(new Request('http://t/api/export/e1', { headers }), { params: Promise.resolve({ id: 'e1' }) });
  it('401 when unauthenticated, 404 for an unknown / foreign / expired id, the zip otherwise', async () => {
    caller = { ok: false, status: 401, error: 'unauthenticated' };
    expect((await get()).status).toBe(401);
    caller = okCaller;
    downloadResult = null;
    const missing = await get({ authorization: 'Bearer good' });
    expect(missing.status).toBe(404);
    expect(missing.headers.get('cache-control')).toBe('no-store');
    downloadResult = new Response('zip', { status: 200 });
    expect((await get({ authorization: 'Bearer good' })).status).toBe(200);
  });
  it('lets the resolver fall back to the oldest membership (the export row decides access)', async () => {
    await get({ authorization: 'Bearer good' });
    expect(seen.at(-1)).toEqual({ requested: undefined, authorization: 'Bearer good', inferFirst: true });
  });
});
