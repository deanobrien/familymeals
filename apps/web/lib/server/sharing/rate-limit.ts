// Rate limiting for share-link lookups (P3-A, D422). A token is ~256 random bits, so guessing is hopeless on its own; the limiter is
// there to make probing visibly pointless and cheap to refuse. In-process sliding windows (the app runs as one App Service instance;
// a second instance would simply double the allowance, which is still harmless). Failures are counted separately and cost more.
const g = globalThis as { __frShareLimits?: Map<string, number[]> };
const hits = (): Map<string, number[]> => (g.__frShareLimits ??= new Map());

export interface Limit {
  max: number;
  windowMs: number;
}

/** Looks per caller and per window, and (stricter) FAILED looks. */
export const LOOKUP_LIMIT: Limit = { max: 60, windowMs: 60_000 };
export const FAILURE_LIMIT: Limit = { max: 10, windowMs: 10 * 60_000 };
export const SAVE_LIMIT: Limit = { max: 30, windowMs: 60 * 60_000 };
export const CREATE_LIMIT: Limit = { max: 30, windowMs: 60 * 60_000 };

function recent(key: string, windowMs: number, now: number): number[] {
  const list = (hits().get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length) hits().set(key, list);
  else hits().delete(key);
  return list;
}

/** Is there room for one more under `limit`? (Does not record.) */
export function allowed(key: string, limit: Limit, now = Date.now()): boolean {
  return recent(key, limit.windowMs, now).length < limit.max;
}

export function record(key: string, limit: Limit, now = Date.now()): void {
  const list = recent(key, limit.windowMs, now);
  list.push(now);
  hits().set(key, list);
  // Keep the map from growing without bound under a flood of distinct keys.
  if (hits().size > 5000) {
    for (const k of hits().keys()) {
      if (recent(k, 10 * 60_000, now).length === 0) hits().delete(k);
      if (hits().size <= 4000) break;
    }
  }
}

export function resetShareLimits(): void {
  g.__frShareLimits = undefined;
}

/** Who is asking, for the limiter: the user id when signed in, else the client address (first hop of x-forwarded-for). */
export function limiterKey(req: { headers: { get(name: string): string | null } } | null, userId: string | null): string {
  if (userId) return `u:${userId}`;
  const fwd = req?.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return `ip:${fwd || req?.headers.get('x-real-ip') || 'unknown'}`;
}

/** The lookup gate: refuse when over either window; call `noteLookup(key, found)` after the answer. */
export function lookupAllowed(key: string, now = Date.now()): boolean {
  return allowed(`look:${key}`, LOOKUP_LIMIT, now) && allowed(`miss:${key}`, FAILURE_LIMIT, now);
}

export function noteLookup(key: string, found: boolean, now = Date.now()): void {
  record(`look:${key}`, LOOKUP_LIMIT, now);
  if (!found) record(`miss:${key}`, FAILURE_LIMIT, now);
}
