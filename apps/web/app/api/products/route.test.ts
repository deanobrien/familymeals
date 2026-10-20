import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_CODES } from '@fr/product-sources';
import type { AuthOutcome } from '../../../lib/server/auth/request-auth';

let outcome: AuthOutcome;
const seen: Array<{ requested: string | undefined; authorization: string | null }> = [];
vi.mock('../../../lib/server/auth/request-auth', () => ({
  resolveRequestAuth: async (req: Request, requested?: string) => {
    seen.push({ requested, authorization: req.headers.get('authorization') });
    return outcome;
  },
}));

const { POST } = await import('./route');
const { getBatchResolver, setBatchResolverForTests, resetPollRate } = await import('../../../lib/server/products/batch');
const { acceptsBearer, isPublicPath } = await import('../../../lib/server/auth/routes');

const H = 'aa000000-0000-4000-8000-0000000000aa';
const ok: AuthOutcome = { ok: true, auth: { userId: 'u1', householdId: H, readOnly: false, dataContext: null, defaultServings: 4 } };
const call = (body: unknown, headers: Record<string, string> = { 'content-type': 'application/json' }) =>
  POST(new Request('http://t/api/products', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) }));

beforeEach(() => {
  seen.length = 0;
  outcome = ok;
  setBatchResolverForTests(undefined);
  resetPollRate();
});

describe('POST /api/products (batch lookup)', () => {
  it('rejects an unauthenticated caller', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await call({ codes: [FIXTURE_CODES.bakedBeans] })).status).toBe(401);
  });

  it('validates the body: JSON content type, a non-empty list, at most 50 codes', async () => {
    expect((await call({ codes: [] })).status).toBe(400);
    expect((await call('not json')).status).toBe(400);
    expect((await call({ codes: 'x' })).status).toBe(400);
    expect((await call({ codes: Array(51).fill(FIXTURE_CODES.bakedBeans) })).status).toBe(400);
    expect((await call({ codes: [FIXTURE_CODES.bakedBeans] }, { 'content-type': 'text/plain' })).status).toBe(415);
  });

  it('answers at once with pending, then done once the queue has run; uncached; read-only', async () => {
    const res = await call({ codes: [FIXTURE_CODES.bakedBeans, '1234'] });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const first = (await res.json()).results;
    expect(first[FIXTURE_CODES.bakedBeans]).toEqual({ status: 'pending' });
    expect(first['1234']).toMatchObject({ status: 'error', error: { code: 'invalid_barcode' } });
    await getBatchResolver().drain();
    const second = (await (await call({ codes: [FIXTURE_CODES.bakedBeans] })).json()).results;
    expect(second[FIXTURE_CODES.bakedBeans]).toMatchObject({ status: 'done', lookup: { product: { barcode: FIXTURE_CODES.bakedBeans }, match: { status: 'matched' } } });
  });

  it('passes the household and Authorization header to the auth layer (Android: bearer)', async () => {
    await call({ codes: [FIXTURE_CODES.bakedBeans], householdId: H }, { 'content-type': 'application/json', authorization: 'Bearer good' });
    expect(seen[0]).toEqual({ requested: H, authorization: 'Bearer good' });
  });

  it('is a bearer-capable route and not a public one', () => {
    expect(acceptsBearer('/api/products', 'Bearer abc')).toBe(true);
    expect(acceptsBearer('/api/products', null)).toBe(false);
    expect(isPublicPath('/api/products')).toBe(false);
  });
});
