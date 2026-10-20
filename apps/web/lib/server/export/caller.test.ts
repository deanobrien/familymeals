import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createFakeSupabase } from '../supabase/test-support/fake-client';
import type { BearerDeps } from '../auth/request-auth';

const U = 'a0000000-0000-4000-8000-000000000001';
const H1 = 'aa000000-0000-4000-8000-0000000000aa';
const row = (id: string) => ({
  role: 'owner',
  joined_at: '2026-10-01T00:00:00Z',
  households: { id, name: id, status: 'active', default_servings: 4, weekly_budget_pence: null },
});

const cookieCtx = { user: { id: 'cookie-user', email: 'c@x.test' }, household: { id: H1 }, memberships: [], supabase: {}, mode: 'supabase', isOwner: true };
let cookie: unknown = cookieCtx;
vi.mock('../auth/household-context', () => ({ getHouseholdContext: async () => cookie }));

function deps(): BearerDeps {
  return {
    clientFor() {
      const fake = createFakeSupabase(() => ({ data: [row(H1)] }));
      return {
        auth: { getUser: async (t: string) => (t === 'good' ? { data: { user: { id: U, email: 'dean@example.com' } }, error: null } : { data: { user: null }, error: { message: 'bad' } }) },
        from: (table: string) => fake.client.from(table),
      } as unknown as SupabaseClient;
    },
  };
}

const req = (authorization?: string) => new Request('http://t/api/export', { headers: authorization ? { authorization } : {} });

beforeEach(() => {
  cookie = cookieCtx;
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://127.0.0.1:54321');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon');
});
afterEach(() => vi.unstubAllEnvs());

describe('resolveExportCaller', () => {
  it('uses the cookie session when there is no Authorization header (web, unchanged)', async () => {
    const { resolveExportCaller } = await import('./caller');
    expect(await resolveExportCaller(req(), undefined)).toMatchObject({ ok: true, ctx: { user: { id: 'cookie-user' } }, dataContext: null });
    cookie = null;
    expect(await resolveExportCaller(req(), undefined)).toEqual({ ok: false, status: 401, error: 'unauthenticated' });
  });
  it('verifies a Bearer token and runs as that user (Android)', async () => {
    const { resolveExportCaller } = await import('./caller');
    const out = await resolveExportCaller(req('Bearer good'), H1, { deps: deps() });
    expect(out).toMatchObject({ ok: true, ctx: { user: { id: U, email: 'dean@example.com' }, isOwner: true }, dataContext: { householdId: H1, userId: U } });
  });
  it('rejects a forged token (401) and a household the caller is not in (403); never falls back to cookies for a Bearer call', async () => {
    const { resolveExportCaller } = await import('./caller');
    expect(await resolveExportCaller(req('Bearer forged'), H1, { deps: deps() })).toEqual({ ok: false, status: 401, error: 'unauthenticated' });
    expect(await resolveExportCaller(req('Bearer good'), 'bb000000-0000-4000-8000-0000000000bb', { deps: deps() })).toEqual({ ok: false, status: 403, error: 'forbidden' });
  });
  it('a Bearer call needs real Supabase auth (not mock mode)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    const { resolveExportCaller } = await import('./caller');
    expect(await resolveExportCaller(req('Bearer good'), H1, { deps: deps() })).toEqual({ ok: false, status: 401, error: 'unauthenticated' });
  });
});
