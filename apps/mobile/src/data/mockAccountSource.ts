import type { Uuid } from '@fr/domain';
import { AccountError } from '@/lib/accountErrors';
import { requireEmail, requireNewPassword } from '@/lib/accountForms';
import { INVITE_TOKEN_RE, buildAppInviteUrl } from '@/lib/inviteLink';
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

interface MockHousehold extends HouseholdSummary {
  members: MemberSummary[];
  invitations: Array<PendingInvitation & { token: string }>;
  exclusions: Array<{ id: string; term: string }>;
  consent: boolean;
}

const hex = (n: number) => n.toString(16).padStart(64, '0');

/**
 * In-memory demo implementation (no Supabase env): the same behaviour the screens see against Supabase, enough to click through
 * sign-up, households, invitations, settings and the deletion flows. The demo password for the re-authentication step is `secret1`
 * (the same one MockDataSource accepts). Nothing is persisted.
 */
export class MockAccountSource implements AccountSource {
  private seq = 1;
  private households: MockHousehold[];
  private accountDeletionAt: string | null = null;
  /** Test seam: the clock. */
  now: () => Date = () => new Date();
  /** Counts for tests. */
  sentConfirmations = 0;
  sentResets = 0;
  signedOut = false;

  constructor() {
    const me = (role: HouseholdRole, hh: string): MemberSummary => ({ id: `m-me-${hh}`, userId: 'u-me', role, displayName: 'Dean', joinedAt: '2026-01-01T00:00:00Z', isYou: true });
    const other = (hh: string, n: number, role: HouseholdRole = 'member'): MemberSummary => ({
      id: `m-${hh}-${n}`,
      userId: `u-${hh}-${n}`,
      role,
      displayName: n === 1 ? 'Sam' : `Member ${n}`,
      joinedAt: '2026-02-01T00:00:00Z',
      isYou: false,
    });
    const base = (id: string, name: string, role: HouseholdRole, members: MemberSummary[]): MockHousehold => ({
      id,
      name,
      status: 'active',
      role,
      defaultServings: 4,
      weeklyBudgetPence: 8500,
      purgeAfter: null,
      joinedAt: '2026-01-01T00:00:00Z',
      members,
      invitations: [],
      exclusions: [],
      consent: false,
    });
    this.households = [
      base('hh-1', 'The Smiths', 'owner', [me('owner', 'hh-1'), other('hh-1', 1), other('hh-1', 2), other('hh-1', 3)]),
      base('hh-2', 'Flat 3B', 'member', [me('member', 'hh-2'), other('hh-2', 1, 'owner')]),
    ];
  }

  private hh(id: string): MockHousehold {
    const h = this.households.find((x) => x.id === id);
    if (!h) throw new AccountError('not_found');
    return h;
  }
  private owner(id: string): MockHousehold {
    const h = this.hh(id);
    if (h.role !== 'owner') throw new AccountError('forbidden');
    return h;
  }
  private writable(id: string): MockHousehold {
    const h = this.hh(id);
    if (h.status === 'pending_deletion') throw new AccountError('read_only');
    return h;
  }

  async signUp(email: string, password: string): Promise<SignUpResult> {
    requireEmail(email);
    requireNewPassword(password);
    this.sentConfirmations += 1;
    return { signedIn: false };
  }
  async resendConfirmation(email: string): Promise<void> {
    requireEmail(email);
    this.sentConfirmations += 1;
  }
  async requestPasswordReset(email: string): Promise<void> {
    requireEmail(email);
    this.sentResets += 1;
  }
  async updatePassword(password: string): Promise<void> {
    requireNewPassword(password);
  }

  async listMemberships(): Promise<HouseholdSummary[]> {
    return this.households.map(({ members: _m, invitations: _i, exclusions: _e, consent: _c, ...summary }) => ({ ...summary }));
  }
  async createHousehold(input: CreateHouseholdInput): Promise<{ id: Uuid }> {
    const id = `hh-new-${this.seq++}`;
    this.households.push({
      id,
      name: input.name,
      status: 'active',
      role: 'owner',
      defaultServings: input.defaultServings,
      weeklyBudgetPence: input.weeklyBudgetPence,
      purgeAfter: null,
      joinedAt: this.now().toISOString(),
      members: [{ id: `m-me-${id}`, userId: 'u-me', role: 'owner', displayName: input.displayName ?? 'You', joinedAt: this.now().toISOString(), isYou: true }],
      invitations: [],
      exclusions: [],
      consent: false,
    });
    return { id };
  }
  async listMembers(householdId: Uuid): Promise<MemberSummary[]> {
    return this.hh(householdId).members.map((m) => ({ ...m }));
  }
  async listInvitations(householdId: Uuid): Promise<PendingInvitation[]> {
    const h = this.hh(householdId);
    if (h.role !== 'owner') return [];
    return h.invitations.map(({ token: _t, ...i }) => ({ ...i, expired: new Date(i.expiresAt).getTime() <= this.now().getTime() }));
  }
  async createInvitation(input: { householdId: Uuid; email?: string | undefined; role: HouseholdRole; ttlHours: number }): Promise<CreatedInvitation> {
    const h = this.writable(input.householdId);
    if (h.role !== 'owner') throw new AccountError('forbidden');
    const email = input.email?.trim() ? requireEmail(input.email).toLowerCase() : null;
    const token = hex(this.seq++);
    const expiresAt = new Date(this.now().getTime() + input.ttlHours * 3_600_000).toISOString();
    const id = `inv-${this.seq++}`;
    h.invitations.push({ id, email, role: input.role, expiresAt, expired: false, token });
    return { invitationId: id, link: buildAppInviteUrl(token), expiresAt };
  }
  async revokeInvitation(householdId: Uuid, invitationId: Uuid): Promise<void> {
    const h = this.owner(householdId);
    const before = h.invitations.length;
    h.invitations = h.invitations.filter((i) => i.id !== invitationId);
    if (h.invitations.length === before) throw new AccountError('not_found');
  }
  async removeMember(householdId: Uuid, memberId: Uuid): Promise<void> {
    const h = this.owner(householdId);
    this.writable(householdId);
    const m = h.members.find((x) => x.id === memberId);
    if (!m || m.isYou || m.role !== 'member') throw new AccountError('not_found');
    h.members = h.members.filter((x) => x.id !== memberId);
  }
  async transferOwnership(householdId: Uuid, memberId: Uuid): Promise<void> {
    const h = this.owner(householdId);
    this.writable(householdId);
    const target = h.members.find((x) => x.id === memberId && !x.isYou);
    if (!target) throw new AccountError('not_found');
    target.role = 'owner';
    for (const m of h.members) if (m.isYou) m.role = 'member';
    h.role = 'member';
  }
  async leaveHousehold(householdId: Uuid): Promise<void> {
    const h = this.hh(householdId);
    const owners = h.members.filter((m) => m.role === 'owner' && !m.isYou).length;
    if (h.members.length <= 1 || (h.role === 'owner' && owners === 0)) throw new AccountError('last_owner');
    this.households = this.households.filter((x) => x.id !== householdId);
  }
  async acceptInvitation(token: string): Promise<{ householdId: Uuid }> {
    if (!INVITE_TOKEN_RE.test(token)) throw new AccountError('invitation_invalid');
    for (const h of this.households) {
      const i = h.invitations.find((x) => x.token === token);
      if (i) {
        h.invitations = h.invitations.filter((x) => x !== i);
        return { householdId: h.id };
      }
    }
    // The demo has no other accounts: any well-formed unknown token is "invalid, expired or used", exactly as on the server.
    throw new AccountError('invitation_invalid');
  }

  async getSettings(householdId: Uuid): Promise<AccountSettings> {
    const h = this.hh(householdId);
    return { defaultServings: h.defaultServings, weeklyBudgetPence: h.weeklyBudgetPence, exclusions: h.exclusions.map((e) => ({ ...e })), consentActive: h.consent, withheldExclusions: h.consent ? 0 : h.exclusions.length };
  }
  async savePreferences(householdId: Uuid, prefs: { defaultServings: number; weeklyBudgetPence: number | null }): Promise<void> {
    const h = this.owner(householdId);
    h.defaultServings = prefs.defaultServings;
    h.weeklyBudgetPence = prefs.weeklyBudgetPence;
  }
  async saveExclusions(householdId: Uuid, tags: string[], consent: boolean): Promise<void> {
    const h = this.hh(householdId);
    if (tags.length > 0 && !consent) throw new AccountError('invalid_input');
    if (tags.length > 0) h.consent = true;
    h.exclusions = [...new Set(tags.map((t) => t.trim().toLowerCase()))].map((term, i) => ({ id: `ex-${i}`, term }));
  }
  async withdrawConsent(householdId: Uuid): Promise<void> {
    this.hh(householdId).consent = false;
  }
  async removeAllDietary(householdId: Uuid): Promise<void> {
    const h = this.hh(householdId);
    h.exclusions = [];
    h.consent = false;
  }

  async getLifecycle(householdId: Uuid): Promise<Lifecycle> {
    const h = this.hh(householdId);
    return { accountDeletionAt: this.accountDeletionAt, activeMembers: h.members.length, otherOwners: h.members.filter((m) => m.role === 'owner' && !m.isYou).length };
  }
  async requestHouseholdDeletion(householdId: Uuid, confirmName: string, password: string): Promise<{ purgeAfter: string }> {
    const h = this.owner(householdId);
    if (h.status === 'pending_deletion') throw new AccountError('read_only');
    if (confirmName.trim() !== h.name.trim()) throw new AccountError('confirm_mismatch');
    if (password !== 'secret1') throw new AccountError('reauth_failed');
    h.status = 'pending_deletion';
    h.purgeAfter = new Date(this.now().getTime() + 14 * 86_400_000).toISOString();
    return { purgeAfter: h.purgeAfter };
  }
  async cancelHouseholdDeletion(householdId: Uuid): Promise<void> {
    const h = this.owner(householdId);
    h.status = 'active';
    h.purgeAfter = null;
  }
  async requestAccountDeletion(confirmText: string, password: string): Promise<{ scheduledAt: string; signedOut: boolean }> {
    if (confirmText.trim().toUpperCase() !== 'DELETE') throw new AccountError('confirm_mismatch');
    if (password !== 'secret1') throw new AccountError('reauth_failed');
    const sole = this.households.filter((h) => h.members.length <= 1);
    const scheduled = sole.length > 0 ? new Date(this.now().getTime() + 14 * 86_400_000) : this.now();
    this.accountDeletionAt = scheduled.toISOString();
    const signedOut = sole.length === 0;
    if (signedOut) this.signedOut = true;
    return { scheduledAt: this.accountDeletionAt, signedOut };
  }
  async cancelAccountDeletion(): Promise<void> {
    this.accountDeletionAt = null;
  }
}
