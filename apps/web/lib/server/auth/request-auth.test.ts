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
    expect(acceptsBearer('/api/pantry/scan', 'Bearer t')).toBe(false); // not opted in
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
