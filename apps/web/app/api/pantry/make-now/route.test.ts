import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuthOutcome } from '../../../../lib/server/auth/request-auth';
import { acceptsBearer } from '../../../../lib/server/auth/routes';
import type { MakeNowView } from '../../../../lib/make-now/types';

let outcome: AuthOutcome;
vi.mock('../../../../lib/server/auth/request-auth', () => ({ resolveRequestAuth: async () => outcome }));

const { GET, POST } = await import('./route');
let n = 0;
let H = '';

beforeEach(() => {
  H = `cc${String(++n).padStart(6, '0')}-0000-4000-8000-0000000000cc`;
  outcome = { ok: true, auth: { userId: 'u', householdId: H, readOnly: false, dataContext: null, defaultServings: 4 } };
});

const get = async (qs = '') => (await GET(new Request(`http://t/api/pantry/make-now?householdId=${H}${qs}`)));
const post = (body: Record<string, unknown>) =>
  POST(new Request('http://t/api/pantry/make-now', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ householdId: H, ...body }) }));

describe('/api/pantry/make-now', () => {
  it('is a bearer route and needs a signed-in caller', async () => {
    expect(acceptsBearer('/api/pantry/make-now', 'Bearer abc')).toBe(true);
    outcome = { ok: false, status: 401, message: 'no' };
    expect((await get()).status).toBe(401);
    expect((await post({ action: 'add_missing', recipeId: 'x' })).status).toBe(401);
  });

  it('returns ranked suggestions with coverage, missing items and the consent / allergy fields', async () => {
    const res = await get('&limit=3');
    expect(res.status).toBe(200);
    const { view } = (await res.json()) as { view: MakeNowView };
    expect(view.items.length).toBeGreaterThan(0);
    expect(view.items.length).toBeLessThanOrEqual(3);
    expect(view).toMatchObject({ exclusionsActive: expect.any(Boolean), hiddenByAllergy: expect.any(Number), withheldExclusions: expect.any(Number), pantryEmpty: false });
    for (const it of view.items) expect(it).toMatchObject({ recipeId: expect.any(String), title: expect.any(String), coveragePct: expect.any(Number), missing: expect.any(Array), makeable: expect.any(Boolean) });
  });

  it('add_missing adds the missing items once; a repeat adds nothing; read-only households are refused', async () => {
    const { view } = (await (await get('&limit=30')).json()) as { view: MakeNowView };
    const needy = view.items.find((i) => i.missing.length > 0)!;
    expect(needy).toBeDefined();
    const first = await post({ action: 'add_missing', recipeId: needy.recipeId });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ ok: true, added: expect.any(Number) });
    const second = await (await post({ action: 'add_missing', recipeId: needy.recipeId })).json();
    expect(second).toMatchObject({ ok: true, added: 0 });
    outcome = { ok: true, auth: { userId: 'u', householdId: H, readOnly: true, dataContext: null, defaultServings: 4 } };
    expect((await post({ action: 'add_missing', recipeId: needy.recipeId })).status).toBe(403);
    expect((await get()).status).toBe(200); // reads stay open
  });

  it('refuses unknown actions, missing recipe ids and unknown recipes', async () => {
    expect((await post({ action: 'nope', recipeId: 'x' })).status).toBe(400);
    expect((await post({ action: 'add_missing' })).status).toBe(400);
    const res = await post({ action: 'add_missing', recipeId: 'does-not-exist' });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('REFUSED');
  });
});
