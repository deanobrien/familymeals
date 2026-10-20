import { AccountError } from '@/lib/accountErrors';
import { ApiError, type ApiClient } from '@/lib/apiClient';
import { AUTH_REDIRECT_URL } from '@/lib/authLink';
import { SupabaseAccountSource } from '@/data/supabaseAccountSource';
import { ME, fakeAccountDb, froms, ops, rpcs, type Responder } from './helpers/fakeAccountDb';

const H = '00000000-0000-4000-8000-000000000100';
const M2 = '00000000-0000-4000-8000-000000000102';
const INV = '00000000-0000-4000-8000-000000000103';
const TOKEN = 'ab'.repeat(32);
const NOW = new Date('2026-10-20T12:00:00Z');

function make(respond: Responder = () => ({ data: null }), opts: { verify?: boolean; auth?: Record<string, unknown>; webBase?: string | undefined } = {}) {
  const { client, calls, auth } = fakeAccountDb(respond, opts.auth);
  const verify = jest.fn(async () => opts.verify ?? true);
  const signedOut = jest.fn();
  const src = new SupabaseAccountSource({
    client,
    webBaseUrl: 'webBase' in opts ? opts.webBase : 'https://web.test/',
    verifyPassword: verify,
    onSignedOut: signedOut,
    now: () => NOW,
  });
  return { src, calls, auth, verify, signedOut };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof AccountError ? e.code : `non-account:${String(e)}`;
  }
  return 'resolved';
};

describe('sign-up, confirmation and recovery', () => {
  it('signs up with the deep link as the confirmation redirect', async () => {
    const { src, auth } = make();
    await expect(src.signUp(' a@b.co ', 'longenough1')).resolves.toEqual({ signedIn: false });
    expect(auth.signUp).toHaveBeenCalledWith({ email: 'a@b.co', password: 'longenough1', options: { emailRedirectTo: AUTH_REDIRECT_URL } });
    expect(AUTH_REDIRECT_URL).toBe('familyrecipes://auth/callback');
  });
  it('reports a session when the project has email confirmation off', async () => {
    const { src } = make(undefined, { auth: { signUp: jest.fn(async () => ({ data: { session: { access_token: 'x' } }, error: null })) } });
    await expect(src.signUp('a@b.co', 'longenough1')).resolves.toEqual({ signedIn: true });
  });
  it('validates before calling the server: bad email, short password (10 minimum)', async () => {
    const { src, auth } = make();
    expect(await code(src.signUp('nope', 'longenough1'))).toBe('invalid_input');
    expect(await code(src.signUp('a@b.co', '123456789'))).toBe('weak_password');
    expect(await code(src.signUp('a@b.co', 'x'.repeat(201)))).toBe('weak_password');
    expect(auth.signUp).not.toHaveBeenCalled();
  });
  it('maps provider errors to fixed codes and never reflects provider text', async () => {
    const e = (error: object) => ({ signUp: jest.fn(async () => ({ data: {}, error })) });
    expect(await code(make(undefined, { auth: e({ code: 'weak_password', message: 'Password pwned: hunter2' }) }).src.signUp('a@b.co', 'longenough1'))).toBe('weak_password');
    expect(await code(make(undefined, { auth: e({ status: 429, message: 'x' }) }).src.signUp('a@b.co', 'longenough1'))).toBe('rate_limited');
    expect(await code(make(undefined, { auth: e({ message: 'TypeError: Network request failed' }) }).src.signUp('a@b.co', 'longenough1'))).toBe('offline');
    const err = await make(undefined, { auth: e({ message: 'a@b.co is registered' }) }).src.signUp('a@b.co', 'longenough1').catch((x: Error) => x);
    expect((err as Error).message).not.toMatch(/a@b\.co|registered/);
  });
  it('resend: identical outcome whatever the provider says, except rate limit and offline', async () => {
    const mk = (error: object | null) => make(undefined, { auth: { resend: jest.fn(async () => ({ data: {}, error })) } });
    await expect(mk({ message: 'User not found', status: 400 }).src.resendConfirmation('a@b.co')).resolves.toBeUndefined();
    expect(await code(mk({ status: 429, message: 'x' }).src.resendConfirmation('a@b.co'))).toBe('rate_limited');
    expect(await code(mk({ message: 'Network request failed' }).src.resendConfirmation('a@b.co'))).toBe('offline');
    const { src, auth } = make();
    await src.resendConfirmation('a@b.co');
    expect(auth.resend).toHaveBeenCalledWith({ type: 'signup', email: 'a@b.co', options: { emailRedirectTo: AUTH_REDIRECT_URL } });
  });
  it('forgot password: redirects to the deep link and answers the same for unknown addresses', async () => {
    const { src, auth } = make();
    await src.requestPasswordReset('a@b.co');
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith('a@b.co', { redirectTo: AUTH_REDIRECT_URL });
    const unknown = make(undefined, { auth: { resetPasswordForEmail: jest.fn(async () => ({ data: {}, error: { message: 'User not found', status: 400 } })) } });
    await expect(unknown.src.requestPasswordReset('ghost@b.co')).resolves.toBeUndefined();
    const throws = make(undefined, { auth: { resetPasswordForEmail: jest.fn(async () => { throw new Error('boom'); }) } });
    await expect(throws.src.requestPasswordReset('a@b.co')).resolves.toBeUndefined();
    const limited = make(undefined, { auth: { resetPasswordForEmail: jest.fn(async () => ({ data: {}, error: { status: 429, message: 'x' } })) } });
    expect(await code(limited.src.requestPasswordReset('a@b.co'))).toBe('rate_limited');
  });
  it('reset password needs the recovery session and a strong password', async () => {
    const ok = make();
    await ok.src.updatePassword('longenough1');
    expect(ok.auth.updateUser).toHaveBeenCalledWith({ password: 'longenough1' });
    expect(await code(ok.src.updatePassword('short'))).toBe('weak_password');
    const noSession = make(undefined, { auth: { getSession: jest.fn(async () => ({ data: { session: null }, error: null })) } });
    expect(await code(noSession.src.updatePassword('longenough1'))).toBe('link_expired');
    expect(noSession.auth.updateUser).not.toHaveBeenCalled();
  });
});

describe('households', () => {
  it('lists memberships with role, status and the grace end date', async () => {
    const { src, calls } = make((c) =>
      c.name === 'household_members'
        ? {
            data: [
              { role: 'owner', joined_at: '2026-01-01T00:00:00Z', households: { id: H, name: 'Smiths', status: 'pending_deletion', default_servings: 5, weekly_budget_pence: 9000, purge_after: '2026-11-01T00:00:00Z' } },
              { role: 'member', joined_at: '2026-02-01T00:00:00Z', households: [{ id: M2, name: 'Flat', status: 'active', default_servings: 2, weekly_budget_pence: null, purge_after: null }] },
              { role: 'member', joined_at: '2026-03-01T00:00:00Z', households: null },
            ],
          }
        : undefined,
    );
    const out = await src.listMemberships();
    expect(out).toEqual([
      { id: H, name: 'Smiths', status: 'pending_deletion', role: 'owner', defaultServings: 5, weeklyBudgetPence: 9000, purgeAfter: '2026-11-01T00:00:00Z', joinedAt: '2026-01-01T00:00:00Z' },
      { id: M2, name: 'Flat', status: 'active', role: 'member', defaultServings: 2, weeklyBudgetPence: null, purgeAfter: null, joinedAt: '2026-02-01T00:00:00Z' },
    ]);
    expect(ops(calls[0]!, 'eq')).toEqual([['eq', 'user_id', ME.id], ['eq', 'status', 'active']]);
  });
  it('creates a household as the signed-in user and sets the display name best-effort', async () => {
    const { src, calls } = make((c) => (c.name === 'households' ? { data: { id: H } } : undefined));
    await expect(src.createHousehold({ name: ' The Smiths ', defaultServings: 4, weeklyBudgetPence: 8500, displayName: 'Dean' })).resolves.toEqual({ id: H });
    const insert = ops(froms(calls, 'households')[0]!, 'insert')[0]!;
    expect(insert[1]).toEqual({ name: 'The Smiths', default_servings: 4, weekly_budget_pence: 8500 });
    const rename = froms(calls, 'household_members')[0]!;
    expect(ops(rename, 'update')[0]![1]).toEqual({ display_name: 'Dean' });
    expect(ops(rename, 'eq')).toEqual([['eq', 'household_id', H], ['eq', 'user_id', ME.id]]);
  });
  it('maps a creation failure to a fixed code', async () => {
    const { src } = make(() => ({ error: { code: '42501', message: 'new row violates row-level security' } }));
    expect(await code(src.createHousehold({ name: 'x', defaultServings: 4, weeklyBudgetPence: null }))).toBe('forbidden');
  });
  it('lists members (isYou, fallback name) and pending invitations (expired flag, no token material)', async () => {
    const { src } = make((c) =>
      c.name === 'household_members'
        ? { data: [{ id: 'm1', user_id: ME.id, role: 'owner', display_name: 'Dean', joined_at: 'a' }, { id: M2, user_id: 'u2', role: 'member', display_name: '  ', joined_at: 'b' }] }
        : { data: [{ id: INV, email: 'sam@x.co', role: 'member', expires_at: '2026-10-01T00:00:00Z', created_at: 'c', token_hash: 'zzz' }, { id: 'i2', email: null, role: 'owner', expires_at: '2026-12-01T00:00:00Z', created_at: 'd' }] },
    );
    const members = await src.listMembers(H);
    expect(members.map((m) => [m.displayName, m.isYou])).toEqual([['Dean', true], ['Household member', false]]);
    const invites = await src.listInvitations(H);
    expect(invites).toEqual([
      { id: INV, email: 'sam@x.co', role: 'member', expiresAt: '2026-10-01T00:00:00Z', expired: true },
      { id: 'i2', email: null, role: 'owner', expiresAt: '2026-12-01T00:00:00Z', expired: false },
    ]);
    expect(JSON.stringify(invites)).not.toMatch(/token|zzz/);
  });
  it('creates an invitation through create_invitation and returns the shareable link once', async () => {
    const { src, calls } = make((c) => (c.name === 'create_invitation' ? { data: [{ invitation_id: INV, token: TOKEN, expires_at: '2026-10-27T12:00:00Z' }] } : undefined));
    const res = await src.createInvitation({ householdId: H, email: ' SAM@X.CO ', role: 'member', ttlHours: 168 });
    expect(res).toEqual({ invitationId: INV, link: `https://web.test/invite/${TOKEN}`, expiresAt: '2026-10-27T12:00:00Z' });
    expect(rpcs(calls)[0]!.args).toEqual({ p_household_id: H, p_email: 'sam@x.co', p_role: 'member', p_ttl: '168 hours' });
  });
  it('without a web address the link falls back to the app scheme', async () => {
    const { src } = make(() => ({ data: { invitation_id: INV, token: TOKEN, expires_at: 'x' } }), { webBase: undefined });
    expect((await src.createInvitation({ householdId: H, role: 'owner', ttlHours: 24 })).link).toBe(`familyrecipes://invite/${TOKEN}`);
  });
  it('refuses a malformed token from the server, bad ttl and bad email; maps read-only / forbidden', async () => {
    const bad = make(() => ({ data: { invitation_id: INV, token: 'short', expires_at: 'x' } }));
    expect(await code(bad.src.createInvitation({ householdId: H, role: 'member', ttlHours: 24 }))).toBe('unknown');
    const { src, calls } = make();
    expect(await code(src.createInvitation({ householdId: H, role: 'member', ttlHours: 0 }))).toBe('invalid_input');
    expect(await code(src.createInvitation({ householdId: H, email: 'nope', role: 'member', ttlHours: 24 }))).toBe('invalid_input');
    expect(await code(src.createInvitation({ householdId: 'not-uuid', role: 'member', ttlHours: 24 }))).toBe('invalid_input');
    expect(calls).toHaveLength(0);
    const ro = make(() => ({ error: { code: '42501', message: 'household is pending_deletion and read-only' } }));
    expect(await code(ro.src.createInvitation({ householdId: H, role: 'member', ttlHours: 24 }))).toBe('read_only');
  });
  it('revokes an open invitation, or says not found', async () => {
    const ok = make((c) => (c.kind === 'from' ? { data: [{ id: INV }] } : undefined));
    await ok.src.revokeInvitation(H, INV);
    const q = ok.calls[0]!;
    expect(ops(q, 'update')[0]![1]).toEqual({ revoked_at: NOW.toISOString() });
    expect(ops(q, 'is')).toEqual([['is', 'accepted_at', null], ['is', 'revoked_at', null]]);
    const none = make(() => ({ data: [] }));
    expect(await code(none.src.revokeInvitation(H, INV))).toBe('not_found');
  });
  it('removes only another active plain member', async () => {
    const ok = make(() => ({ data: [{ id: M2 }] }));
    await ok.src.removeMember(H, M2);
    const q = ok.calls[0]!;
    expect(ops(q, 'update')[0]![1]).toEqual({ status: 'revoked' });
    expect(ops(q, 'eq')).toEqual([['eq', 'id', M2], ['eq', 'household_id', H], ['eq', 'status', 'active'], ['eq', 'role', 'member']]);
    expect(ops(q, 'neq')).toEqual([['neq', 'user_id', ME.id]]);
    expect(await code(make(() => ({ data: [] })).src.removeMember(H, M2))).toBe('not_found');
  });
  it('transfers ownership and leaves through the RPCs, mapping last-owner and read-only', async () => {
    const ok = make();
    await ok.src.transferOwnership(H, M2);
    await ok.src.leaveHousehold(H);
    expect(rpcs(ok.calls, 'transfer_ownership')[0]!.args).toEqual({ p_household_id: H, p_new_owner_member_id: M2 });
    expect(rpcs(ok.calls, 'member_leave')[0]!.args).toEqual({ p_household_id: H });
    const last = make(() => ({ error: { code: '23514', message: 'household must keep at least one active owner' } }));
    expect(await code(last.src.leaveHousehold(H))).toBe('last_owner');
    const t = make(() => ({ error: { code: 'P0001', message: 'cannot transfer ownership of a read-only household' } }));
    expect(await code(t.src.transferOwnership(H, M2))).toBe('last_owner');
  });
  it('accepts an invitation by token; every rejection reads the same', async () => {
    const ok = make(() => ({ data: H }));
    await expect(ok.src.acceptInvitation(TOKEN)).resolves.toEqual({ householdId: H });
    expect(rpcs(ok.calls)[0]!.args).toEqual({ p_token: TOKEN });
    expect(await code(make().src.acceptInvitation('short'))).toBe('invitation_invalid');
    for (const error of [{ code: '22023', message: 'invitation expired' }, { code: 'P0001', message: 'whatever' }, { code: 'PGRST116', message: 'x' }]) {
      expect(await code(make(() => ({ error })).src.acceptInvitation(TOKEN))).toBe('invitation_invalid');
    }
    expect(await code(make(() => ({ data: 'not-a-uuid' })).src.acceptInvitation(TOKEN))).toBe('unknown');
  });
});

describe('settings (through the web app /api/settings, D350)', () => {
  const server = { defaultServings: 6, weeklyBudgetPence: 7550, exclusions: ['peanuts'], consentActive: true, withheldExclusions: 2 };
  function makeApi(impl: { get?: () => Promise<unknown>; send?: () => Promise<unknown> } = {}) {
    const get = jest.fn(impl.get ?? (async () => ({ settings: server })));
    const send = jest.fn(impl.send ?? (async () => ({ settings: server })));
    const api = { configured: true, url: () => null, authHeaders: async () => ({}), get, send } as unknown as ApiClient;
    const { client } = fakeAccountDb(() => ({ data: null }));
    return { src: new SupabaseAccountSource({ client, api, now: () => NOW }), get, send };
  }
  it('reads the server settings', async () => {
    const { src, get } = makeApi();
    await expect(src.getSettings(H)).resolves.toEqual({
      defaultServings: 6,
      weeklyBudgetPence: 7550,
      exclusions: [{ id: 'peanuts', term: 'peanuts' }],
      consentActive: true,
      withheldExclusions: 2,
    });
    expect(get).toHaveBeenCalledWith('/api/settings', { householdId: H });
  });
  it('sends preferences as the web form strings (pounds)', async () => {
    const { src, send } = makeApi();
    await src.savePreferences(H, { defaultServings: 5, weeklyBudgetPence: 8550 });
    expect(send).toHaveBeenLastCalledWith('POST', '/api/settings', { householdId: H, action: 'preferences', defaultServings: '5', weeklyBudget: '85.50' });
    await src.savePreferences(H, { defaultServings: 5, weeklyBudgetPence: 8500 });
    expect(send).toHaveBeenLastCalledWith('POST', '/api/settings', expect.objectContaining({ weeklyBudget: '85' }));
    await src.savePreferences(H, { defaultServings: 5, weeklyBudgetPence: null });
    expect(send).toHaveBeenLastCalledWith('POST', '/api/settings', expect.objectContaining({ weeklyBudget: '' }));
  });
  it('sends dietary, withdraw and remove-all actions; refuses exclusions without consent before calling', async () => {
    const { src, send } = makeApi();
    await src.saveExclusions(H, ['milk'], true);
    expect(send).toHaveBeenLastCalledWith('POST', '/api/settings', { householdId: H, action: 'dietary', tags: ['milk'], consent: true });
    await src.withdrawConsent(H);
    expect(send).toHaveBeenLastCalledWith('POST', '/api/settings', { householdId: H, action: 'withdraw_consent' });
    await src.removeAllDietary(H);
    expect(send).toHaveBeenLastCalledWith('POST', '/api/settings', { householdId: H, action: 'remove_all' });
    send.mockClear();
    expect(await code(src.saveExclusions(H, ['fish'], false))).toBe('invalid_input');
    expect(send).not.toHaveBeenCalled();
  });
  it.each([
    [new ApiError('x', 403, false, 'FORBIDDEN'), 'forbidden'],
    [new ApiError('x', 403, false, 'READ_ONLY'), 'read_only'],
    [new ApiError('x', 401, false, 'UNAUTHENTICATED'), 'forbidden'],
    [new ApiError('x', 422, false, 'INVALID_INPUT'), 'invalid_input'],
    [new ApiError('x', 0, true), 'offline'],
    [new ApiError('x', 0, false), 'not_configured'],
    [new ApiError('x', 500, true, 'INTERNAL'), 'unknown'],
  ])('maps %# to a fixed account error', async (err, expected) => {
    const { src } = makeApi({ send: async () => Promise.reject(err) });
    expect(await code(src.savePreferences(H, { defaultServings: 5, weeklyBudgetPence: null }))).toBe(expected);
  });
  it('rejects a malformed household id without calling the server', async () => {
    const { src, get } = makeApi();
    expect(await code(src.getSettings('nope'))).toBe('invalid_input');
    expect(get).not.toHaveBeenCalled();
  });
});

describe('Your data: deletion lifecycle', () => {
  it('reads the lifecycle: pending account deletion, member counts, other owners', async () => {
    const { src } = make((c) =>
      c.name === 'my_account_deletion'
        ? { data: '2026-11-03T00:00:00Z' }
        : { data: [{ user_id: ME.id, role: 'owner' }, { user_id: 'u2', role: 'owner' }, { user_id: 'u3', role: 'member' }] },
    );
    await expect(src.getLifecycle(H)).resolves.toEqual({ accountDeletionAt: '2026-11-03T00:00:00Z', activeMembers: 3, otherOwners: 1 });
  });
  const hh: Responder = (c) => (c.name === 'households' ? { data: { name: 'The Smiths' } } : c.name === 'request_household_deletion' ? { data: '2026-11-03T00:00:00Z' } : undefined);
  it('household deletion needs the typed name AND the current password before the RPC runs', async () => {
    const wrongName = make(hh);
    expect(await code(wrongName.src.requestHouseholdDeletion(H, 'the smiths!', 'pw'))).toBe('confirm_mismatch');
    expect(wrongName.verify).not.toHaveBeenCalled();
    expect(rpcs(wrongName.calls)).toHaveLength(0);
    const wrongPw = make(hh, { verify: false });
    expect(await code(wrongPw.src.requestHouseholdDeletion(H, 'The Smiths', 'bad'))).toBe('reauth_failed');
    expect(rpcs(wrongPw.calls)).toHaveLength(0);
    const ok = make(hh);
    await expect(ok.src.requestHouseholdDeletion(H, '  The Smiths ', 'secret')).resolves.toEqual({ purgeAfter: '2026-11-03T00:00:00Z' });
    expect(ok.verify).toHaveBeenCalledWith(ME.email, 'secret');
    expect(rpcs(ok.calls, 'request_household_deletion')[0]!.args).toEqual({ p_household_id: H });
  });
  it('maps an owner-only refusal from the RPC', async () => {
    const { src } = make((c) => (c.name === 'households' ? { data: { name: 'x' } } : { error: { code: '42501', message: 'only an owner may delete' } }));
    expect(await code(src.requestHouseholdDeletion(H, 'x', 'pw'))).toBe('forbidden');
  });
  it('cancels a household deletion through the RPC (no password needed)', async () => {
    const { src, calls, verify } = make();
    await src.cancelHouseholdDeletion(H);
    expect(rpcs(calls, 'cancel_household_deletion')[0]!.args).toEqual({ p_household_id: H });
    expect(verify).not.toHaveBeenCalled();
  });
  it('account deletion needs DELETE and the password; signs out only when nothing is left to wait for', async () => {
    const soon = make((c) => (c.name === 'request_account_deletion' ? { data: new Date(NOW.getTime() + 30_000).toISOString() } : undefined));
    expect(await code(soon.src.requestAccountDeletion('delete me', 'pw'))).toBe('confirm_mismatch');
    expect(rpcs(soon.calls)).toHaveLength(0);
    const wrong = make(undefined, { verify: false });
    expect(await code(wrong.src.requestAccountDeletion('DELETE', 'bad'))).toBe('reauth_failed');
    expect(rpcs(wrong.calls)).toHaveLength(0);

    await expect(soon.src.requestAccountDeletion(' delete ', 'secret')).resolves.toMatchObject({ signedOut: true });
    expect(soon.auth.signOut).toHaveBeenCalled();
    expect(soon.signedOut).toHaveBeenCalled();

    const later = make((c) => (c.name === 'request_account_deletion' ? { data: '2026-11-03T00:00:00Z' } : undefined));
    await expect(later.src.requestAccountDeletion('DELETE', 'secret')).resolves.toEqual({ scheduledAt: '2026-11-03T00:00:00Z', signedOut: false });
    expect(later.auth.signOut).not.toHaveBeenCalled();
  });
  it('maps "transfer ownership first" and cancels an account deletion', async () => {
    const blocked = make((c) => (c.name === 'request_account_deletion' ? { error: { code: 'P0001', message: 'you must transfer ownership first' } } : undefined));
    expect(await code(blocked.src.requestAccountDeletion('DELETE', 'pw'))).toBe('last_owner');
    const { src, calls } = make();
    await src.cancelAccountDeletion();
    expect(rpcs(calls, 'cancel_account_deletion')).toHaveLength(1);
  });
  it('needs a session for anything that acts as the user', async () => {
    const { src } = make(undefined, { auth: { getSession: jest.fn(async () => ({ data: { session: null }, error: null })) } });
    expect(await code(src.listMemberships())).toBe('forbidden');
    expect(await code(src.requestAccountDeletion('DELETE', 'pw'))).toBe('forbidden');
  });
});
