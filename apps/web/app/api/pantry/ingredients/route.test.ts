import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../../../../lib/server/auth/request-auth';

let outcome: AuthOutcome;
vi.mock('../../../../lib/server/auth/request-auth', () => ({ resolveRequestAuth: async () => outcome }));

const { GET } = await import('./route');
const H = 'aa000000-0000-4000-8000-0000000000aa';

beforeEach(() => {
  outcome = { ok: true, auth: { userId: 'u', householdId: H, readOnly: false, dataContext: null, defaultServings: 4 } };
});

describe('GET /api/pantry/ingredients', () => {
  it('needs a signed-in caller', async () => {
    outcome = { ok: false, status: 401, message: 'no' };
    const res = await GET(new Request('http://t/api/pantry/ingredients?q=milk'));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
  });

  it('returns canonical ingredient hits', async () => {
    const res = await GET(new Request(`http://t/api/pantry/ingredients?q=milk&householdId=${H}`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hits: Array<{ id: string; name: string; category: string }> };
    expect(body.hits.length).toBeGreaterThan(0);
    expect(body.hits[0]).toHaveProperty('name');
  });
});
