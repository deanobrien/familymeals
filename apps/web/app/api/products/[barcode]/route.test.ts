import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FIXTURE_CODES } from '@fr/product-sources';
import type { AuthOutcome } from '../../../../lib/server/auth/request-auth';

let outcome: AuthOutcome;
const seen: Array<{ requested: string | undefined; authorization: string | null }> = [];
vi.mock('../../../../lib/server/auth/request-auth', () => ({
  resolveRequestAuth: async (req: Request, requested?: string) => {
    seen.push({ requested, authorization: req.headers.get('authorization') });
    return outcome;
  },
}));

const { GET } = await import('./route');
const { resetProductQuota } = await import('../../../../lib/server/products/lookup');
const { acceptsBearer, isPublicPath } = await import('../../../../lib/server/auth/routes');

const H = 'aa000000-0000-4000-8000-0000000000aa';
const ok: AuthOutcome = { ok: true, auth: { userId: 'u1', householdId: H, readOnly: false, dataContext: null, defaultServings: 4 } };
const call = (barcode: string, qs = '', authorization?: string) =>
  GET(new Request(`http://t/api/products/${barcode}${qs}`, { headers: authorization ? { authorization } : {} }), { params: Promise.resolve({ barcode }) });

beforeEach(() => {
  seen.length = 0;
  outcome = ok;
  resetProductQuota();
});

describe('GET /api/products/[barcode]', () => {
  it('rejects an unauthenticated caller before any lookup', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    const res = await call(FIXTURE_CODES.bakedBeans);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
  });

  it('returns the product, an ingredient match and the provider (mock, offline), uncached', async () => {
    const res = await call(FIXTURE_CODES.bakedBeans);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    const body = await res.json();
    expect(body.product).toMatchObject({ barcode: FIXTURE_CODES.bakedBeans, source: { publisher: 'Open Food Facts' } });
    expect(body.match.status).toBe('matched');
    expect(body.provider).toEqual({ id: 'mock', isMock: true });
  });

  it('answers 400 for an invalid barcode, 404 for an unknown product', async () => {
    expect((await call('12345')).status).toBe(400);
    const nf = await call('4006381333931');
    expect(nf.status).toBe(404);
    expect((await nf.json()).error.code).toBe('not_found');
  });

  it('passes the household and Authorization header to the auth layer (Android: bearer)', async () => {
    await call(FIXTURE_CODES.bakedBeans, `?householdId=${H}`, 'Bearer good');
    expect(seen[0]).toEqual({ requested: H, authorization: 'Bearer good' });
  });

  it('is a bearer-capable route and not a public one', () => {
    expect(acceptsBearer(`/api/products/${FIXTURE_CODES.bakedBeans}`, 'Bearer abc')).toBe(true);
    expect(acceptsBearer(`/api/products/${FIXTURE_CODES.bakedBeans}`, null)).toBe(false);
    expect(isPublicPath(`/api/products/${FIXTURE_CODES.bakedBeans}`)).toBe(false);
    expect(isPublicPath('/about/sources')).toBe(true);
  });
});
