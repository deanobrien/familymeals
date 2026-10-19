import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { mapAuthApiError, mapDbError, messageFor } from './errors';
import {
  acceptInvitation,
  createHousehold,
  createInvitation,
  CreateHouseholdForm,
  InviteForm,
  leaveHousehold,
  listPendingInvitations,
  loadMemberships,
  revokeInvitation,
  revokeMember,
  transferOwnership,
} from './household-service';
import { pickActiveMembership, type HouseholdSummary } from './memberships';
import { MockAuthForbiddenError, assertMockAllowed, getMockIdentity } from './mock';
import { safeNextPath } from './next-path';
import { isPublicPath } from './routes';
import { buildInviteUrl } from './site-url-pure';
import { readPublicEnv, resolveAuthMode } from '../../supabase/env';

const H1 = '11111111-1111-4111-8111-111111111111';
const U1 = '22222222-2222-4222-8222-222222222222';
const M1 = '33333333-3333-4333-8333-333333333333';
const TOKEN = 'a'.repeat(64);

type Call = { table?: string; fn?: string; ops: Array<[string, unknown[]]> };

/** Minimal chainable, thenable fake of the supabase-js query builder; resolves queued results in order. */
function fakeClient(results: Array<{ data?: unknown; error?: unknown }>) {
  const calls: Call[] = [];
  const next = () => results.shift() ?? { data: null, error: null };
  const chain = (call: Call): unknown => {
    const p: Record<string, unknown> = {};
    for (const m of ['select', 'insert', 'update', 'eq', 'neq', 'is', 'order', 'single']) {
      p[m] = (...args: unknown[]) => {
        call.ops.push([m, args]);
        return p;
      };
    }
    p.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(next()).then(res, rej);
    return p;
  };
  const client = {
    from: (table: string) => {
      const c: Call = { table, ops: [] };
      calls.push(c);
      return chain(c);
    },
    rpc: (fn: string, args: unknown) => {
      const c: Call = { fn, ops: [['args', [args]]] };
      calls.push(c);
      return Promise.resolve(next());
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe('safeNextPath (A6 open redirect)', () => {
  it.each([
    ['/recipes', '/recipes'],
    ['/plan?week=2026-10-19', '/plan?week=2026-10-19'],
    ['https://evil.test', '/'],
    ['//evil.test', '/'],
    ['/\\evil.test', '/'],
    ['javascript:alert(1)', '/'],
    ['', '/'],
    [null, '/'],
    ['/sign-in', '/'],
    ['/auth/callback?code=1', '/'],
    ['/ok\r\nSet-Cookie: a=b', '/'],
  ])('%s -> %s', (input, expected) => {
    expect(safeNextPath(input as string | null)).toBe(expected);
  });
});

describe('auth mode and mock guard', () => {
  const url = 'http://localhost:54321';
  it('is supabase when env is present', () => {
    expect(resolveAuthMode({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k', NODE_ENV: 'production' })).toBe('supabase');
  });
  it('is mock without env in development/test', () => {
    expect(resolveAuthMode({ NODE_ENV: 'development' })).toBe('mock');
    expect(resolveAuthMode({ NODE_ENV: 'test' })).toBe('mock');
  });
  it('refuses mock in production: unconfigured instead', () => {
    expect(resolveAuthMode({ NODE_ENV: 'production' })).toBe('unconfigured');
    expect(resolveAuthMode({ NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: url })).toBe('unconfigured');
  });
  it('treats blank values as missing', () => {
    expect(readPublicEnv({ NEXT_PUBLIC_SUPABASE_URL: ' ', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k' })).toBeNull();
  });
  it('mock identity throws in production (defence in depth)', () => {
    expect(() => assertMockAllowed('production')).toThrow(MockAuthForbiddenError);
    expect(() => getMockIdentity('production')).toThrow(MockAuthForbiddenError);
    expect(getMockIdentity('development').household.role).toBe('owner');
  });
});

describe('routes', () => {
  it('classifies public and protected paths', () => {
    for (const p of ['/privacy', '/sign-in', '/sign-up', '/forgot-password', '/reset-password', '/auth/callback', `/invite/${TOKEN}`]) {
      expect(isPublicPath(p), p).toBe(true);
    }
    for (const p of ['/', '/recipes', '/household', '/household/new', '/api/ai/extract', '/invitex']) {
      expect(isPublicPath(p), p).toBe(false);
    }
  });
});

describe('active household selection', () => {
  const mk = (id: string, joinedAt: string): HouseholdSummary => ({
    id, name: id, status: 'active', role: 'member', defaultServings: 4, weeklyBudgetPence: null, joinedAt,
  });
  const a = mk('a', '2026-01-02T00:00:00Z');
  const b = mk('b', '2026-01-01T00:00:00Z');
  it('returns null with no memberships', () => expect(pickActiveMembership([], 'a')).toBeNull());
  it('honours the cookie when it names a membership', () => expect(pickActiveMembership([a, b], 'a')).toBe(a));
  it('ignores a cookie naming a household the user is not in', () => expect(pickActiveMembership([a, b], 'zzz')).toBe(b));
  it('falls back to the oldest membership', () => expect(pickActiveMembership([a, b], undefined)).toBe(b));
});

describe('error mapping never reflects raw text', () => {
  it('maps SQLSTATEs', () => {
    expect(mapDbError({ code: '42501', message: 'household is pending deletion and read-only' })).toBe('read_only');
    expect(mapDbError({ code: '42501', message: 'only household owners can invite' })).toBe('forbidden');
    expect(mapDbError({ code: '22023', message: 'invitation invalid or expired' })).toBe('invitation_invalid');
    expect(mapDbError({ code: '23514', message: 'household x must keep at least one active owner' })).toBe('last_owner');
    expect(mapDbError({ code: '22023', message: 'transfer ownership before leaving' })).toBe('last_owner');
    expect(mapDbError(new Error('boom user@example.com'))).toBe('unknown');
  });
  it('maps auth errors coarsely (no enumeration)', () => {
    expect(mapAuthApiError({ status: 400, code: 'invalid_credentials' })).toBe('invalid_credentials');
    expect(mapAuthApiError({ status: 400, code: 'user_not_found' })).toBe('invalid_credentials');
    expect(mapAuthApiError({ status: 429 })).toBe('rate_limited');
    expect(mapAuthApiError({ code: 'weak_password' })).toBe('weak_password');
  });
  it('messageFor only knows whitelisted codes', () => {
    expect(messageFor('<script>')).toBeNull();
    expect(messageFor('forbidden')).toBeTruthy();
  });
});

describe('forms', () => {
  it('parses household form incl. blank budget and pounds->pence', () => {
    const p = CreateHouseholdForm.parse({ name: ' Smiths ', defaultServings: '3', weeklyBudgetPounds: '', displayName: '' });
    expect(p).toMatchObject({ name: 'Smiths', defaultServings: 3, weeklyBudgetPounds: null, displayName: undefined });
    expect(CreateHouseholdForm.parse({ name: 'x', weeklyBudgetPounds: '85.50' }).weeklyBudgetPounds).toBe(85.5);
    expect(CreateHouseholdForm.safeParse({ name: '  ' }).success).toBe(false);
    expect(CreateHouseholdForm.safeParse({ name: 'x', defaultServings: '0' }).success).toBe(false);
  });
  it('lower-cases invite email and rejects junk', () => {
    expect(InviteForm.parse({ email: 'A@B.Test', role: 'member', ttlHours: '24' }).email).toBe('a@b.test');
    expect(InviteForm.parse({ email: '', role: 'member' }).email).toBeUndefined();
    expect(InviteForm.safeParse({ email: 'nope', role: 'member' }).success).toBe(false);
    expect(InviteForm.safeParse({ role: 'admin' }).success).toBe(false);
  });
});

describe('household service (mocked Supabase client)', () => {
  it('loadMemberships flattens the embedded household', async () => {
    const { client } = fakeClient([
      { data: [{ role: 'owner', joined_at: 't', households: { id: H1, name: 'N', status: 'active', default_servings: 4, weekly_budget_pence: 8500 } }] },
    ]);
    const r = await loadMemberships(client, U1);
    expect(r).toEqual({ ok: true, data: [{ id: H1, name: 'N', status: 'active', role: 'owner', defaultServings: 4, weeklyBudgetPence: 8500, joinedAt: 't' }] });
  });

  it('createHousehold converts pounds to pence and sets display name', async () => {
    const { client, calls } = fakeClient([{ data: { id: H1 } }, { data: null }]);
    const r = await createHousehold(client, U1, { name: 'N', defaultServings: 4, weeklyBudgetPounds: 85.5, displayName: 'Dean' });
    expect(r).toEqual({ ok: true, data: { id: H1 } });
    expect(calls[0]!.ops[0]).toEqual(['insert', [{ name: 'N', default_servings: 4, weekly_budget_pence: 8550 }]]);
    expect(calls[1]!.ops[0]).toEqual(['update', [{ display_name: 'Dean' }]]);
  });

  it('createInvitation passes the RPC args and returns the one-time token', async () => {
    const { client, calls } = fakeClient([{ data: [{ invitation_id: M1, token: TOKEN, expires_at: 'e' }] }]);
    const r = await createInvitation(client, { householdId: H1, email: 'a@b.test', role: 'member', ttlHours: 24 });
    expect(r).toEqual({ ok: true, data: { invitationId: M1, token: TOKEN, expiresAt: 'e' } });
    expect(calls[0]).toMatchObject({ fn: 'create_invitation' });
    expect(calls[0]!.ops[0]![1][0]).toEqual({ p_household_id: H1, p_email: 'a@b.test', p_role: 'member', p_ttl: '24 hours' });
  });

  it('createInvitation maps non-owner and rejects malformed tokens/ids', async () => {
    const denied = fakeClient([{ error: { code: '42501', message: 'only household owners can invite' } }]);
    expect(await createInvitation(denied.client, { householdId: H1, role: 'member', ttlHours: 24 })).toEqual({ ok: false, error: 'forbidden' });
    const bad = fakeClient([{ data: [{ invitation_id: M1, token: 'short', expires_at: 'e' }] }]);
    expect(await createInvitation(bad.client, { householdId: H1, role: 'member', ttlHours: 24 })).toEqual({ ok: false, error: 'unknown' });
    expect(await createInvitation(fakeClient([]).client, { householdId: 'x', role: 'member', ttlHours: 24 })).toEqual({ ok: false, error: 'invalid_input' });
  });

  it('acceptInvitation: validates token shape without a DB call; collapses all rejections', async () => {
    const none = fakeClient([]);
    expect(await acceptInvitation(none.client, 'nope')).toEqual({ ok: false, error: 'invitation_invalid' });
    expect(none.calls).toHaveLength(0);
    const used = fakeClient([{ error: { code: '22023', message: 'invitation invalid or expired' } }]);
    expect(await acceptInvitation(used.client, TOKEN)).toEqual({ ok: false, error: 'invitation_invalid' });
    const good = fakeClient([{ data: H1 }]);
    expect(await acceptInvitation(good.client, TOKEN)).toEqual({ ok: true, data: { householdId: H1 } });
  });

  it('revokeInvitation / revokeMember report not_found when no row matched', async () => {
    expect(await revokeInvitation(fakeClient([{ data: [] }]).client, H1, M1)).toEqual({ ok: false, error: 'not_found' });
    expect(await revokeInvitation(fakeClient([{ data: [{ id: M1 }] }]).client, H1, M1)).toEqual({ ok: true, data: true });
    const { client, calls } = fakeClient([{ data: [{ id: M1 }] }]);
    expect((await revokeMember(client, H1, M1, U1)).ok).toBe(true);
    const ops = calls[0]!.ops.map(([m]) => m);
    expect(ops).toContain('neq'); // cannot remove yourself this way
  });

  it('transferOwnership calls the transfer_ownership RPC', async () => {
    const { client, calls } = fakeClient([{ data: null }]);
    expect((await transferOwnership(client, H1, M1, U1)).ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.fn).toBe('transfer_ownership');
    expect(calls[0]!.ops[0]).toEqual(['args', [{ p_household_id: H1, p_new_owner_member_id: M1 }]]);
  });

  it('transferOwnership maps RPC refusals (read-only grace, not owner, bad target)', async () => {
    const ro = fakeClient([{ error: { code: '42501', message: 'household is pending deletion and read-only' } }]);
    expect(await transferOwnership(ro.client, H1, M1, U1)).toEqual({ ok: false, error: 'read_only' });
    const no = fakeClient([{ error: { code: '42501', message: 'not an active owner' } }]);
    expect(await transferOwnership(no.client, H1, M1, U1)).toEqual({ ok: false, error: 'forbidden' });
    const bad = fakeClient([{ error: { code: '22023', message: 'target is not an active member of this household' } }]);
    expect(await transferOwnership(bad.client, H1, M1, U1)).toEqual({ ok: false, error: 'invalid_input' });
    const none = fakeClient([]);
    expect(await transferOwnership(none.client, 'x', M1, U1)).toEqual({ ok: false, error: 'invalid_input' });
    expect(none.calls).toHaveLength(0);
  });

  it('leaveHousehold surfaces the sole-owner rule', async () => {
    const { client } = fakeClient([{ error: { code: '22023', message: 'transfer ownership before leaving' } }]);
    expect(await leaveHousehold(client, H1)).toEqual({ ok: false, error: 'last_owner' });
  });

  it('listPendingInvitations flags expired invites', async () => {
    const { client } = fakeClient([
      { data: [{ id: M1, email: null, role: 'member', expires_at: '2026-01-01T00:00:00Z', created_at: 'c' }] },
    ]);
    const r = await listPendingInvitations(client, H1, new Date('2026-02-01T00:00:00Z'));
    expect(r.ok && r.data[0]!.expired).toBe(true);
  });
});

describe('invite url', () => {
  it('builds /invite/<token> without double slashes', () => {
    expect(buildInviteUrl('https://x.test/', TOKEN)).toBe(`https://x.test/invite/${TOKEN}`);
  });
});
