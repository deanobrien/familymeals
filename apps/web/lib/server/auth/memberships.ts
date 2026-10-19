/** Pure helpers for choosing the active household among a user's memberships. */
export type HouseholdRole = 'owner' | 'member';
export type HouseholdStatus = 'active' | 'pending_deletion';

export interface HouseholdSummary {
  id: string;
  name: string;
  status: HouseholdStatus;
  role: HouseholdRole;
  defaultServings: number;
  weeklyBudgetPence: number | null;
  joinedAt: string;
}

/** Name of the httpOnly cookie that stores the user's chosen active household id. */
export const ACTIVE_HOUSEHOLD_COOKIE = 'fr_household';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v);
}

/**
 * The cookie is untrusted input: it only ever selects among memberships the database already returned for
 * this user. An unknown/stale id falls back to the oldest membership (stable, deterministic).
 */
export function pickActiveMembership(
  memberships: readonly HouseholdSummary[],
  cookieValue: string | null | undefined,
): HouseholdSummary | null {
  if (memberships.length === 0) return null;
  if (cookieValue) {
    const hit = memberships.find((m) => m.id === cookieValue);
    if (hit) return hit;
  }
  const sorted = [...memberships].sort((a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.id.localeCompare(b.id));
  return sorted[0] ?? null;
}

export function isReadOnly(h: Pick<HouseholdSummary, 'status'>): boolean {
  return h.status === 'pending_deletion';
}
