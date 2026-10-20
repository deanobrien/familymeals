import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createFakeSupabase } from '../supabase/test-support/fake-client';
import { sameOwner } from '../import/pipeline';
import { acceptsBearer } from './routes';
import { bearerToken, resolveBearerAuth, type BearerDeps } from './request-auth';

const U = 'a0000000-0000-4000-8000-000000000001';
const H1 = 'aa000000-0000-4000-8000-0000000000aa';
const H2 = 'bb000000-0000-4000-8000-0000000000bb';

const row = (id: string, status = 'active') => ({
  role: 'member',
  joined_at: '2026-10-01T00:00:00Z',
  households: { id, name: id, status, default_servings: 4, weekly_budget_pence: null },
});

function deps(opts: { user?: string | null; households?: ReturnType<typeof row>[]; seenTokens?: string[] }): BearerDeps {
  return {
    clientFor(token) {
      opts.seenTokens?.push(token);
      const fake = createFakeSupabase(() => ({ data: opts.households ?? [] }));
      return {
        auth: {
          getUser: async (t: string) => (opts.user && t === 'good' ? { data: { user: { id: opts.user } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }),
        },
        from: (table: string) => fake.client.from(table),
      } as unknown as SupabaseClient;
    },
  };
}

describe('bearer token parsing and middleware pass-through (D102)', () => {
  it('reads only a well-formed Bearer header', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('bearer   abc')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken('Bearer')).toBeNull();
    expect(bearerToken(null)).toBeNull();
  });
  it('middleware lets a bearer request through to the import routes only', () => {
    expect(acceptsBearer('/api/extract', 'Bearer t')).toBe(true);
    expect(acceptsBearer('/api/extract/save', 'Bearer t')).toBe(true);
    expect(acceptsBearer('/api/extract', null)).toBe(false);
    expect(acceptsBearer('/api/extract', 'Basic t')).toBe(false);
    expect(acceptsBearer('/api/pantry/scan', 'Bearer t')).toBe(true); // Android parity API (D340)
    expect(acceptsBearer('/api/admin', 'Bearer t')).toBe(false); // not opted in
    expect(acceptsBearer('/recipes', 'Bearer t')).toBe(false);
  });
});

describe('resolveBearerAuth', () => {
  it('verifies the token, then the household membership, and acts as the caller (not a service client)', async () => {
    const seen: string[] = [];
    const out = await resolveBearerAuth('good', H1, deps({ user: U, households: [row(H1), row(H2)], seenTokens: seen }));
    expect(out).toMatchObject({ ok: true, auth: { userId: U, householdId: H1, readOnly: false } });
    if (!out.ok) throw new Error('unreachable');
    expect(out.auth.dataContext).toMatchObject({ householdId: H1, userId: U });
    expect(seen).toEqual(['good']);
  });
  it('rejects a token the auth server does not accept', async () => {
    expect(await resolveBearerAuth('forged', H1, deps({ user: U, households: [row(H1)] }))).toMatchObject({ ok: false, status: 401 });
    expect(await resolveBearerAuth('good', H1, deps({ user: null, households: [row(H1)] }))).toMatchObject({ ok: false, status: 401 });
  });
  it('rejects a household the caller is not a member of', async () => {
    expect(await resolveBearerAuth('good', H2, deps({ user: U, households: [row(H1)] }))).toMatchObject({ ok: false, status: 403 });
  });
  it('rejects a malformed household id', async () => {
    expect(await resolveBearerAuth('good', 'not-a-uuid', deps({ user: U, households: [row(H1)] }))).toMatchObject({ ok: false, status: 400 });
  });
  it('infers the household only when the caller has exactly one', async () => {
    expect(await resolveBearerAuth('good', undefined, deps({ user: U, households: [row(H1)] }))).toMatchObject({ ok: true, auth: { householdId: H1 } });
    expect(await resolveBearerAuth('good', undefined, deps({ user: U, households: [row(H1), row(H2)] }))).toMatchObject({ ok: false, status: 400 });
    expect(await resolveBearerAuth('good', undefined, deps({ user: U, households: [] }))).toMatchObject({ ok: false, status: 400 });
  });
  it('flags a household pending deletion as read-only', async () => {
    const out = await resolveBearerAuth('good', H1, deps({ user: U, households: [row(H1, 'pending_deletion')] }));
    expect(out).toMatchObject({ ok: true, auth: { readOnly: true } });
  });
  it('a client that throws is an authentication failure, not a 500', async () => {
    const out = await resolveBearerAuth('good', H1, { clientFor: () => { throw new Error('boom'); } });
    expect(out).toMatchObject({ ok: false, status: 401 });
  });
});

describe('upload ownership', () => {
  const a = { userId: 'u1', householdId: 'h1' };
  it('only the same user in the same household may retry or save an upload', () => {
    expect(sameOwner(a, { ...a })).toBe(true);
    expect(sameOwner(a, { ...a, userId: 'u2' })).toBe(false);
    expect(sameOwner(a, { ...a, householdId: 'h2' })).toBe(false);
    expect(sameOwner(a, undefined)).toBe(false);
    expect(sameOwner(undefined, a)).toBe(false);
    expect(sameOwner(undefined, undefined)).toBe(true);
  });
});

describe('resolveRequestAuth accepts the dev sandbox household in mock auth mode (D161)', () => {
  it('accepts e2e-* ids in mock mode, but never a malformed id or a sandbox id in production', async () => {
    const { vi } = await import('vitest');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', '');
    vi.doMock('./household-context', () => ({
      getHouseholdContext: async () => {
        const { getMockIdentity } = await import('./mock');
        const { household, user } = getMockIdentity('test', 'e2e-x');
        return { user, memberships: [household], household, readOnly: false, mode: 'mock' };
      },
    }));
    vi.resetModules();
    const { resolveRequestAuth } = await import('./request-auth');
    const req = new Request('http://t/api/extract/save', { method: 'POST' });
    vi.stubEnv('NODE_ENV', 'test');
    expect(await resolveRequestAuth(req, 'e2e-x')).toMatchObject({ ok: true, auth: { householdId: 'e2e-x' } });
    expect(await resolveRequestAuth(req, 'not a uuid')).toMatchObject({ ok: false, status: 400 });
    vi.stubEnv('NODE_ENV', 'production'); // mock mode is refused outright in production: the sandbox pattern is not accepted
    expect(await resolveRequestAuth(req, 'e2e-x')).toMatchObject({ ok: false, status: 400 });
    vi.unstubAllEnvs();
    vi.doUnmock('./household-context');
    vi.resetModules();
  });
});
