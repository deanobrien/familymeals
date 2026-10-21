/**
 * Phone-as-scanner for a desktop session (PRJ-018 P3-C, D447-D449). Pure and shared by the web app (desktop panel, phone page)
 * and the Android app (scan the QR, push reads). No I/O, no clock unless passed in.
 *
 * The flow: the signed-in desktop user asks for a session (the server stores only the SHA-256 of a random token, binds the session to
 * household + user, expires it in 10 minutes). The desktop shows a QR code holding `<origin>/scan/phone?s=<id>#t=<token>` (the token is
 * in the URL FRAGMENT: browsers never send it to a server or put it in a Referer header). A phone, signed in or not, opens that
 * address and pushes barcodes and photos into the session; the desktop review picks them up live. Nothing reaches the pantry until the
 * desktop user confirms.
 */

export const SCANNER_LINK_PATH = '/scan/phone';
/** Session lifetime (the server clamps to this). */
export const SESSION_TTL_SECONDS = 600;
export const MAX_SESSION_ITEMS = 300;
export const MAX_SESSION_PHOTOS = 10;
/** A photo is downscaled on the phone to fit; the server refuses anything bigger. */
export const MAX_PHOTO_BYTES = 1_500_000;
export const MAX_PUSHES_PER_MINUTE = 120;

export type ScannerPurpose = 'pantry' | 'receipt';
export const SCANNER_PURPOSES: readonly ScannerPurpose[] = ['pantry', 'receipt'];

/** What the desktop sees of one push. Photo bytes are fetched separately, one at a time. */
export interface ScannerItem {
  id: string;
  /** Strictly increasing per session: the desktop asks for items after the last `seq` it has applied. */
  seq: number;
  kind: 'barcode' | 'photo';
  barcode?: string;
  count: number;
}

export type ScannerSessionState = 'waiting' | 'connected' | 'expired' | 'revoked';

export interface ScannerSessionView {
  id: string;
  purpose: ScannerPurpose;
  expiresAt: string;
  state: ScannerSessionState;
  itemCount: number;
  photoCount: number;
}

/** Phone-side and desktop-side failure codes (the same strings come from the SQL functions). */
export type ScannerErrorCode =
  | 'invalid' | 'revoked' | 'expired' | 'scanner_in_use' | 'rate_limited' | 'session_full' | 'too_many_photos'
  | 'photo_too_large' | 'invalid_input' | 'forbidden' | 'not_found' | 'unavailable';

export const SCANNER_ERROR_MESSAGE: Record<ScannerErrorCode, string> = {
  invalid: 'This scanner link is not valid. Show a new QR code on the computer and scan it again.',
  revoked: 'The computer ended this scanning session. Start a new one there.',
  expired: 'This scanning session has run out of time (they last 10 minutes). Start a new one on the computer.',
  scanner_in_use: 'Another phone is already scanning into this session. On the computer, press "Use a different phone".',
  rate_limited: 'Too many scans too quickly. Wait a moment and carry on.',
  session_full: 'This session has reached its limit of 300 scans. Review them on the computer, then start another.',
  too_many_photos: 'This session already has 10 photos. Review them on the computer, then start another.',
  photo_too_large: 'That photo is too big to send. Try again with the phone further from the label.',
  invalid_input: 'That scan could not be sent.',
  forbidden: 'You cannot start a scanning session here.',
  not_found: 'That scanning session was not found.',
  unavailable: 'Could not reach the server. Check your connection; scans already sent are kept.',
};

/** Errors after which pushing more is pointless: the phone page stops and shows the message. */
export const FATAL_PUSH_ERRORS: readonly ScannerErrorCode[] = ['invalid', 'revoked', 'expired', 'scanner_in_use'];

export function sessionState(s: { expiresAt: string; revokedAt?: string | null; connected: boolean }, now: number): ScannerSessionState {
  if (s.revokedAt) return 'revoked';
  if (Date.parse(s.expiresAt) <= now) return 'expired';
  return s.connected ? 'connected' : 'waiting';
}

/** Seconds left (never negative). */
export const secondsLeft = (expiresAt: string, now: number): number => Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));

export const formatCountdown = (seconds: number): string => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

// ---------------------------------------------------------------------------------------------------------------------
// The link in the QR code
// ---------------------------------------------------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

export const isSessionId = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);
export const isToken = (v: unknown): v is string => typeof v === 'string' && TOKEN_PATTERN.test(v);

export function buildPhoneLink(origin: string, sessionId: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}${SCANNER_LINK_PATH}?s=${sessionId}#t=${token}`;
}

export interface PhoneLink {
  origin: string;
  sessionId: string;
  token: string;
}

/**
 * Parse a scanned QR string / opened link. Returns null for anything that is not exactly our link shape. `allowedOrigin`: the app
 * passes the server it is configured for so a hostile QR code can never make it send scans to another site.
 */
export function parsePhoneLink(raw: string, opts: { allowedOrigin?: string } = {}): PhoneLink | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '[::1]';
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && local)) return null;
  if (u.username || u.password) return null;
  if (u.pathname !== SCANNER_LINK_PATH) return null;
  if (opts.allowedOrigin !== undefined) {
    let allowed: string;
    try {
      allowed = new URL(opts.allowedOrigin).origin;
    } catch {
      return null;
    }
    if (u.origin !== allowed) return null;
  }
  const sessionId = u.searchParams.get('s');
  const frag = new URLSearchParams(u.hash.replace(/^#/, ''));
  const token = frag.get('t');
  if (!isSessionId(sessionId) || !isToken(token)) return null;
  return { origin: u.origin, sessionId: sessionId.toLowerCase(), token };
}

// ---------------------------------------------------------------------------------------------------------------------
// Desktop: apply pushes exactly once
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The desktop polls (and gets Realtime hints), so the same item can arrive twice. `fresh` returns the items not applied yet, in
 * `seq` order; call `done(item)` for each AFTER it has been applied. Idempotent by item id.
 */
export function createApplied(): {
  fresh(items: readonly ScannerItem[]): ScannerItem[];
  done(item: ScannerItem): void;
  /** Highest seq applied: ask the server for items after it. */
  lastSeq(): number;
  reset(): void;
} {
  const applied = new Set<string>();
  let last = 0;
  return {
    fresh: (items) => [...items].filter((i) => !applied.has(i.id)).sort((x, y) => x.seq - y.seq),
    done(item) {
      applied.add(item.id);
      if (item.seq > last) last = item.seq;
    },
    lastSeq: () => last,
    reset() {
      applied.clear();
      last = 0;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Sliding-window rate limiter (per session in the memory store, per IP on the public phone routes)
// ---------------------------------------------------------------------------------------------------------------------

export interface RateLimiter {
  /** True when the call is allowed (and counted). */
  hit(key: string, now?: number): boolean;
  /** Drop keys with no recent hits (call now and then). */
  sweep(now?: number): void;
}

export function createRateLimiter(limit: number, windowMs: number, clock: () => number = Date.now): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    hit(key, now = clock()) {
      const cutoff = now - windowMs;
      const list = (hits.get(key) ?? []).filter((t) => t > cutoff);
      if (list.length >= limit) {
        hits.set(key, list);
        return false;
      }
      list.push(now);
      hits.set(key, list);
      return true;
    },
    sweep(now = clock()) {
      const cutoff = now - windowMs;
      for (const [k, v] of hits) if (!v.some((t) => t > cutoff)) hits.delete(k);
    },
  };
}
