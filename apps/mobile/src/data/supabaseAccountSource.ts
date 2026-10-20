import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Uuid } from '@fr/domain';
import { AccountError, isNetworkError, mapAuthApiError, mapDbError } from '@/lib/accountErrors';
import { requireEmail, requireNewPassword } from '@/lib/accountForms';
import { AUTH_REDIRECT_URL } from '@/lib/authLink';
import { INVITE_TOKEN_RE, buildAppInviteUrl, buildInviteUrl } from '@/lib/inviteLink';
import { ApiError, createApiClient, type ApiClient } from '@/lib/apiClient';
import type {
  AccountSettings,
  AccountSource,
  CreateHouseholdInput,
  CreatedInvitation,
  HouseholdRole,
  HouseholdSummary,
  Lifecycle,
  MemberSummary,
  PendingInvitation,
  SignUpResult,
} from './accountSource';

type Row = Record<string, unknown>;

/** GET/POST /api/settings answer (apps/web/lib/server/settings/types.ts HouseholdSettings). */
interface ServerSettings {
  defaultServings?: number;
  weeklyBudgetPence?: number | null;
  exclusions?: string[];
  consentActive?: boolean;
  members?: Array<{ memberId?: string; displayName?: string; isSelf?: boolean; terms?: string[] }>;
  canEditAllDislikes?: boolean;
  withheldExclusions?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The password re-authentication check (D258): true only when `password` is the signed-in user's current password. */
export type PasswordVerifier = (email: string, password: string) => Promise<boolean>;

/**
 * Checks the password on a throwaway, non-persisting anon client and then revokes only that temporary session
 * (`scope: 'local'`), so the user's real session is untouched. The password is never logged or stored. Same technique as
 * apps/web/lib/server/auth/reauth.ts; false on any failure (wrong password, rate limit, network).
 */
export const verifyPasswordOnThrowawayClient: PasswordVerifier = async (email, password) => {
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon || !email || !password || password.length > 200) return false;
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) return false;
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
};

export interface SupabaseAccountSourceOptions {
  client: SupabaseClient;
  /** Origin of the web app (EXPO_PUBLIC_API_BASE_URL): invitation links are `<origin>/invite/<token>`. */
  webBaseUrl?: string | undefined;
  verifyPassword?: PasswordVerifier;
  /** Test seam: the client for the web app's JSON routes (default: one on `webBaseUrl` with the session's access token). */
  api?: ApiClient;
  /** Called after the session is ended by an account deletion, so the data source can drop its caches. */
  onSignedOut?: () => void;
  now?: () => Date;
}

/**
 * Account, household and lifecycle operations over supabase-js as the signed-in user: RLS and the SECURITY DEFINER RPCs
 * (create_invitation, accept_invitation, transfer_ownership, member_leave, request_/cancel_household_deletion,
 * request_/cancel_account_deletion) are the authority; nothing here needs the service role. Errors become `AccountError`s
 * with fixed text (never raw provider messages, tokens or emails).
 */
export class SupabaseAccountSource implements AccountSource {
  private readonly db: SupabaseClient;
  private readonly webBase: string | undefined;
  private readonly api: ApiClient;
  private readonly verify: PasswordVerifier;
  private readonly onSignedOut: () => void;
  private readonly now: () => Date;

  constructor(opts: SupabaseAccountSourceOptions) {
    this.db = opts.client;
    this.webBase = opts.webBaseUrl?.trim().replace(/\/+$/, '') || undefined;
    this.api =
      opts.api ??
      createApiClient({
        baseUrl: this.webBase,
        getToken: async () => {
          try {
            return (await this.db.auth.getSession()).data.session?.access_token ?? null;
          } catch {
            return null;
          }
        },
      });
    this.verify = opts.verifyPassword ?? verifyPasswordOnThrowawayClient;
    this.onSignedOut = opts.onSignedOut ?? (() => undefined);
    this.now = opts.now ?? (() => new Date());
  }

  // ---- helpers --------------------------------------------------------------------------------------------

  private async session(): Promise<{ userId: string; email: string | null } | null> {
    try {
      const { data } = await this.db.auth.getSession();
      const u = data.session?.user;
      return u ? { userId: u.id, email: u.email ?? null } : null;
    } catch {
      return null;
    }
  }

  private async me(): Promise<{ userId: string; email: string | null }> {
    const s = await this.session();
    if (!s) throw new AccountError('forbidden');
    return s;
  }

  /** Await a PostgREST call; any error becomes an AccountError. */
  private async db_<T>(p: PromiseLike<{ data: T | null; error: unknown }>): Promise<T | null> {
    let res: { data: T | null; error: unknown };
    try {
      res = await p;
    } catch (e) {
      throw new AccountError(isNetworkError(e) ? 'offline' : 'unknown');
    }
    if (res.error) throw new AccountError(mapDbError(res.error));
    return res.data;
  }

  private async rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T | null> {
    return this.db_<T>(this.db.rpc(fn, args) as unknown as PromiseLike<{ data: T | null; error: unknown }>);
  }

  private needUuids(...ids: unknown[]) {
    if (!ids.every(isUuid)) throw new AccountError('invalid_input');
  }

  // ---- sign-up, confirmation, recovery ----------------------------------------------------------------------

  async signUp(email: string, password: string): Promise<SignUpResult> {
    const e = requireEmail(email);
    const pw = requireNewPassword(password);
    let res;
    try {
      res = await this.db.auth.signUp({ email: e, password: pw, options: { emailRedirectTo: AUTH_REDIRECT_URL } });
    } catch (err) {
      throw new AccountError(mapAuthApiError(err));
    }
    if (res.error) throw new AccountError(mapAuthApiError(res.error));
    // The same "check your email" outcome applies to new and existing addresses (no enumeration).
    return { signedIn: !!res.data.session };
  }

  async resendConfirmation(email: string): Promise<void> {
    const e = requireEmail(email);
    let res;
    try {
      res = await this.db.auth.resend({ type: 'signup', email: e, options: { emailRedirectTo: AUTH_REDIRECT_URL } });
    } catch (err) {
      throw new AccountError(mapAuthApiError(err));
    }
    // Deliberately ignored apart from rate limiting / no connection: identical outcome for unknown, confirmed and pending addresses.
    if (res.error) {
      const code = mapAuthApiError(res.error);
      if (code === 'rate_limited' || code === 'offline') throw new AccountError(code);
    }
  }

  async requestPasswordReset(email: string): Promise<void> {
    const e = requireEmail(email);
    try {
      const { error } = await this.db.auth.resetPasswordForEmail(e, { redirectTo: AUTH_REDIRECT_URL });
      if (error) {
        const code = mapAuthApiError(error);
        if (code === 'rate_limited' || code === 'offline') throw new AccountError(code);
      }
    } catch (err) {
      if (err instanceof AccountError) throw err;
      if (isNetworkError(err)) throw new AccountError('offline');
      // anything else: identical response for known and unknown addresses (threat A5)
    }
  }

  async updatePassword(password: string): Promise<void> {
    const pw = requireNewPassword(password);
    if (!(await this.session())) throw new AccountError('link_expired');
    let res;
    try {
      res = await this.db.auth.updateUser({ password: pw });
    } catch (err) {
      throw new AccountError(mapAuthApiError(err));
    }
    if (res.error) {
      const code = mapAuthApiError(res.error);
      throw new AccountError(code === 'invalid_credentials' ? 'unknown' : code);
    }
  }

  // ---- households -------------------------------------------------------------------------------------------

  async listMemberships(): Promise<HouseholdSummary[]> {
    const { userId } = await this.me();
    const rows = await this.db_<Row[]>(
      this.db
        .from('household_members')
        .select('role, joined_at, households(id, name, status, default_servings, weekly_budget_pence, purge_after)')
        .eq('user_id', userId)
        .eq('status', 'active')
        .order('joined_at', { ascending: true }),
    );
    const out: HouseholdSummary[] = [];
    for (const r of rows ?? []) {
      const h = (Array.isArray(r.households) ? r.households[0] : r.households) as Row | null | undefined;
      if (!h) continue;
      out.push({
        id: str(h.id),
        name: str(h.name),
        status: h.status === 'pending_deletion' ? 'pending_deletion' : 'active',
        role: r.role === 'owner' ? 'owner' : 'member',
        defaultServings: Number(h.default_servings ?? 4),
        weeklyBudgetPence: typeof h.weekly_budget_pence === 'number' ? h.weekly_budget_pence : null,
        purgeAfter: typeof h.purge_after === 'string' ? h.purge_after : null,
        joinedAt: str(r.joined_at),
      });
    }
    return out;
  }

  async createHousehold(input: CreateHouseholdInput): Promise<{ id: Uuid }> {
    const { userId } = await this.me();
    const name = input.name.trim();
    if (name.length < 1 || name.length > 120) throw new AccountError('invalid_input');
    const row = await this.db_<Row>(
      this.db
        .from('households')
        .insert({ name, default_servings: input.defaultServings, weekly_budget_pence: input.weeklyBudgetPence })
        .select('id')
        .single(),
    );
    const id = str(row?.id);
    if (!id) throw new AccountError('unknown');
    if (input.displayName?.trim()) {
      // Best effort: the owner row was created by the bootstrap trigger.
      try {
        await this.db.from('household_members').update({ display_name: input.displayName.trim() }).eq('household_id', id).eq('user_id', userId);
      } catch {
        /* the household exists; a missing display name is cosmetic */
      }
    }
    return { id };
  }

  async listMembers(householdId: Uuid): Promise<MemberSummary[]> {
    const { userId } = await this.me();
    this.needUuids(householdId);
    const rows = await this.db_<Row[]>(
      this.db
        .from('household_members')
        .select('id, user_id, role, display_name, joined_at')
        .eq('household_id', householdId)
        .eq('status', 'active')
        .order('joined_at', { ascending: true }),
    );
    return (rows ?? []).map((r) => ({
      id: str(r.id),
      userId: str(r.user_id),
      role: r.role === 'owner' ? 'owner' : 'member',
      displayName: str(r.display_name).trim() || 'Household member',
      joinedAt: str(r.joined_at),
      isYou: r.user_id === userId,
    }));
  }

  async listInvitations(householdId: Uuid): Promise<PendingInvitation[]> {
    this.needUuids(householdId);
    const rows = await this.db_<Row[]>(
      this.db
        .from('invitations')
        .select('id, email, role, expires_at, created_at')
        .eq('household_id', householdId)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .order('created_at', { ascending: false }),
    );
    const now = this.now().getTime();
    // Never any token material: only the hash exists server-side.
    return (rows ?? []).map((r) => ({
      id: str(r.id),
      email: typeof r.email === 'string' ? r.email : null,
      role: r.role === 'owner' ? 'owner' : 'member',
      expiresAt: str(r.expires_at),
      expired: new Date(str(r.expires_at)).getTime() <= now,
    }));
  }

  async createInvitation(input: { householdId: Uuid; email?: string | undefined; role: HouseholdRole; ttlHours: number }): Promise<CreatedInvitation> {
    this.needUuids(input.householdId);
    const email = input.email?.trim() ? requireEmail(input.email).toLowerCase() : null;
    const ttl = Math.floor(input.ttlHours);
    if (!(ttl >= 1 && ttl <= 720)) throw new AccountError('invalid_input');
    const data = await this.rpc<Row | Row[]>('create_invitation', {
      p_household_id: input.householdId,
      p_email: email,
      p_role: input.role,
      p_ttl: `${ttl} hours`,
    });
    const row = (Array.isArray(data) ? data[0] : data) as { invitation_id?: string; token?: string; expires_at?: string } | null | undefined;
    if (!row?.invitation_id || !row.token || !INVITE_TOKEN_RE.test(row.token) || !row.expires_at) throw new AccountError('unknown');
    return {
      invitationId: row.invitation_id,
      link: this.webBase ? buildInviteUrl(this.webBase, row.token) : buildAppInviteUrl(row.token),
      expiresAt: row.expires_at,
    };
  }

  async revokeInvitation(householdId: Uuid, invitationId: Uuid): Promise<void> {
    this.needUuids(householdId, invitationId);
    const rows = await this.db_<Row[]>(
      this.db
        .from('invitations')
        .update({ revoked_at: this.now().toISOString() })
        .eq('id', invitationId)
        .eq('household_id', householdId)
        .is('accepted_at', null)
        .is('revoked_at', null)
        .select('id'),
    );
    if ((rows ?? []).length === 0) throw new AccountError('not_found');
  }

  /** Owner removes another active member. Owners must be handed over first (keeps the last-owner guard simple). */
  async removeMember(householdId: Uuid, memberId: Uuid): Promise<void> {
    const { userId } = await this.me();
    this.needUuids(householdId, memberId);
    const rows = await this.db_<Row[]>(
      this.db
        .from('household_members')
        .update({ status: 'revoked' })
        .eq('id', memberId)
        .eq('household_id', householdId)
        .eq('status', 'active')
        .eq('role', 'member')
        .neq('user_id', userId)
        .select('id'),
    );
    if ((rows ?? []).length === 0) throw new AccountError('not_found');
  }

  async transferOwnership(householdId: Uuid, memberId: Uuid): Promise<void> {
    this.needUuids(householdId, memberId);
    await this.rpc('transfer_ownership', { p_household_id: householdId, p_new_owner_member_id: memberId });
  }

  async leaveHousehold(householdId: Uuid): Promise<void> {
    this.needUuids(householdId);
    await this.rpc('member_leave', { p_household_id: householdId });
  }

  async acceptInvitation(token: string): Promise<{ householdId: Uuid }> {
    if (!INVITE_TOKEN_RE.test(token)) throw new AccountError('invitation_invalid');
    let data: unknown;
    try {
      data = await this.rpc<string>('accept_invitation', { p_token: token });
    } catch (e) {
      // Any rejection of a token (wrong, expired, used, revoked) is reported identically.
      if (e instanceof AccountError && (e.code === 'unknown' || e.code === 'invalid_input' || e.code === 'not_found')) throw new AccountError('invitation_invalid');
      throw e;
    }
    if (typeof data !== 'string' || !isUuid(data)) throw new AccountError('unknown');
    return { householdId: data };
  }

  // ---- settings ---------------------------------------------------------------------------------------------
  // Preferences, allergies and consent go through the web app's /api/settings (D350): the same server module the web Settings
  // page uses, so the rules (owner only, consent before exclusions, withdrawal stops them applying) live in one place.

  private async settingsCall(fn: () => Promise<{ settings: ServerSettings }>): Promise<ServerSettings> {
    try {
      return (await fn()).settings;
    } catch (e) {
      if (!(e instanceof ApiError)) throw e;
      if (e.status === 0) throw new AccountError(e.retryable ? 'offline' : 'not_configured');
      if (e.code === 'READ_ONLY') throw new AccountError('read_only');
      if (e.status === 401 || e.status === 403) throw new AccountError('forbidden');
      if (e.status === 422 || e.status === 400) throw new AccountError('invalid_input');
      if (e.status === 404) throw new AccountError('not_found');
      throw new AccountError('unknown');
    }
  }

  private post(householdId: Uuid, body: Record<string, unknown>): Promise<ServerSettings> {
    this.needUuids(householdId);
    return this.settingsCall(() => this.api.send<{ settings: ServerSettings }>('POST', '/api/settings', { householdId, ...body }));
  }

  async getSettings(householdId: Uuid): Promise<AccountSettings> {
    this.needUuids(householdId);
    const r = await this.settingsCall(() => this.api.get<{ settings: ServerSettings }>('/api/settings', { householdId }));
    return {
      defaultServings: Number(r.defaultServings ?? 4),
      weeklyBudgetPence: typeof r.weeklyBudgetPence === 'number' ? r.weeklyBudgetPence : null,
      exclusions: (r.exclusions ?? []).filter((t) => typeof t === 'string' && t !== '').map((term) => ({ id: term, term })),
      consentActive: r.consentActive === true,
      members: (r.members ?? []).filter((m) => typeof m.memberId === 'string' && m.memberId !== '').map((m) => ({
        memberId: m.memberId as string,
        displayName: typeof m.displayName === 'string' && m.displayName ? m.displayName : 'Household member',
        isSelf: m.isSelf === true,
        terms: (m.terms ?? []).filter((t) => typeof t === 'string' && t !== ''),
      })),
      canEditAllDislikes: r.canEditAllDislikes === true,
      withheldExclusions: Number(r.withheldExclusions ?? 0) || 0,
    };
  }

  async savePreferences(householdId: Uuid, prefs: { defaultServings: number; weeklyBudgetPence: number | null }): Promise<void> {
    const weeklyBudget = prefs.weeklyBudgetPence === null ? '' : (prefs.weeklyBudgetPence / 100).toFixed(2).replace(/\.00$/, '');
    await this.post(householdId, { action: 'preferences', defaultServings: String(prefs.defaultServings), weeklyBudget });
  }

  async saveExclusions(householdId: Uuid, tags: string[], consent: boolean): Promise<void> {
    if (tags.length > 0 && !consent) throw new AccountError('invalid_input');
    await this.post(householdId, { action: 'dietary', tags, consent });
  }

  async withdrawConsent(householdId: Uuid): Promise<void> {
    await this.post(householdId, { action: 'withdraw_consent' });
  }

  async removeAllDietary(householdId: Uuid): Promise<void> {
    await this.post(householdId, { action: 'remove_all' });
  }

  async saveDislikes(householdId: Uuid, memberId: string, terms: string[]): Promise<void> {
    await this.post(householdId, { action: 'dislikes', memberId, terms });
  }

  // ---- Your data --------------------------------------------------------------------------------------------

  async getLifecycle(householdId: Uuid): Promise<Lifecycle> {
    const { userId } = await this.me();
    this.needUuids(householdId);
    const [acct, members] = await Promise.all([
      this.rpc<string>('my_account_deletion'),
      this.db_<Row[]>(this.db.from('household_members').select('user_id, role').eq('household_id', householdId).eq('status', 'active')),
    ]);
    const rows = members ?? [];
    return {
      accountDeletionAt: typeof acct === 'string' ? acct : null,
      activeMembers: rows.length,
      otherOwners: rows.filter((r) => r.role === 'owner' && r.user_id !== userId).length,
    };
  }

  async requestHouseholdDeletion(householdId: Uuid, confirmName: string, password: string): Promise<{ purgeAfter: string }> {
    const { email } = await this.me();
    this.needUuids(householdId);
    const h = await this.db_<Row>(this.db.from('households').select('name').eq('id', householdId).maybeSingle());
    if (!h) throw new AccountError('not_found');
    if (confirmName.trim() !== str(h.name).trim()) throw new AccountError('confirm_mismatch');
    if (!email || !(await this.verify(email, password))) throw new AccountError('reauth_failed');
    const data = await this.rpc<string>('request_household_deletion', { p_household_id: householdId });
    if (typeof data !== 'string') throw new AccountError('unknown');
    return { purgeAfter: data };
  }

  async cancelHouseholdDeletion(householdId: Uuid): Promise<void> {
    this.needUuids(householdId);
    await this.rpc('cancel_household_deletion', { p_household_id: householdId });
  }

  async requestAccountDeletion(confirmText: string, password: string): Promise<{ scheduledAt: string; signedOut: boolean }> {
    const { email } = await this.me();
    if (confirmText.trim().toUpperCase() !== 'DELETE') throw new AccountError('confirm_mismatch');
    if (!email || !(await this.verify(email, password))) throw new AccountError('reauth_failed');
    const data = await this.rpc<string>('request_account_deletion');
    if (typeof data !== 'string') throw new AccountError('unknown');
    // Nothing left to wait for (no sole-member household): sign out; the next job run deletes the account.
    const signedOut = new Date(data).getTime() <= this.now().getTime() + 60_000;
    if (signedOut) {
      await this.db.auth.signOut().catch(() => undefined);
      this.onSignedOut();
    }
    return { scheduledAt: data, signedOut };
  }

  async cancelAccountDeletion(): Promise<void> {
    await this.rpc('cancel_account_deletion');
  }
}
