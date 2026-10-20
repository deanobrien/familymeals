/**
 * Fixed, user-safe error codes for account / household / lifecycle actions (port of apps/web/lib/server/auth/errors.ts,
 * same wording). Raw provider or Postgres text is never shown or logged: it can contain tokens or email addresses.
 */
export type AccountErrorCode =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'link_expired'
  | 'invalid_input'
  | 'weak_password'
  | 'rate_limited'
  | 'not_configured'
  | 'forbidden'
  | 'read_only'
  | 'last_owner'
  | 'invitation_invalid'
  | 'not_found'
  | 'offline'
  | 'confirm_mismatch'
  | 'reauth_failed'
  | 'unknown';

export const ACCOUNT_ERROR_MESSAGES: Record<AccountErrorCode, string> = {
  invalid_credentials: 'That email and password did not match. Please try again.',
  email_not_confirmed: 'Your email address has not been confirmed yet. Use the link in the confirmation email, or request a new one below.',
  link_expired:
    'That link has expired or was already used (some email security scanners open links automatically). Try signing in — your email may already be confirmed — or request a new link.',
  invalid_input: 'Please check the details you entered and try again.',
  weak_password: 'Choose a password of at least 10 characters.',
  rate_limited: 'Too many attempts. Please wait a minute and try again.',
  not_configured: 'This build is not connected to a Supabase project, so this is unavailable in demo mode.',
  forbidden: 'You do not have permission to do that.',
  read_only: 'This household is pending deletion and is read-only. The owner can cancel the deletion.',
  last_owner: 'A household must keep at least one owner. Make someone else an owner first.',
  invitation_invalid: 'This invitation is invalid, expired or has already been used.',
  not_found: 'We could not find that.',
  offline: 'You appear to be offline. Check your connection and try again.',
  confirm_mismatch: 'The confirmation text did not match. Nothing was deleted.',
  reauth_failed: 'That password was not correct. Nothing was deleted.',
  unknown: 'Something went wrong. Please try again.',
};

/** Thrown by account actions. `message` is always the fixed text for `code`. */
export class AccountError extends Error {
  constructor(readonly code: AccountErrorCode) {
    super(ACCOUNT_ERROR_MESSAGES[code]);
    this.name = 'AccountError';
  }
}

/** The user-facing text of any thrown value (fixed text for an AccountError, a generic line otherwise). */
export function messageOf(e: unknown): string {
  return e instanceof AccountError ? e.message : ACCOUNT_ERROR_MESSAGES.unknown;
}

interface PgLikeError {
  code?: string;
  message?: string;
  status?: number;
}

const NETWORK = /network request failed|failed to fetch|fetch failed|timed? ?out|offline|ECONN|ENOTFOUND/i;

export function isNetworkError(err: unknown): boolean {
  const e = (err ?? {}) as PgLikeError;
  return typeof e.message === 'string' && NETWORK.test(e.message);
}

/** Postgres SQLSTATEs used by the household functions: 42501 insufficient_privilege, 22023 invalid_parameter_value, 23514 check_violation. */
export function mapDbError(err: unknown): AccountErrorCode {
  const e = (err ?? {}) as PgLikeError;
  const msg = typeof e.message === 'string' ? e.message : '';
  if (e.status === 429) return 'rate_limited';
  if (isNetworkError(err)) return 'offline';
  if (/transfer ownership|last member/i.test(msg)) return 'last_owner';
  if (e.code === '42501') return /read.?only|pending[_ ]deletion|not writable/i.test(msg) ? 'read_only' : 'forbidden';
  if (e.code === '22023') return /invitation/i.test(msg) ? 'invitation_invalid' : 'invalid_input';
  if (e.code === '23514') return /at least one active owner/i.test(msg) ? 'last_owner' : 'invalid_input';
  if (e.code === 'PGRST116') return 'not_found';
  return 'unknown';
}

/** Supabase Auth (GoTrue) sign-in/sign-up error mapping. Deliberately coarse to avoid account enumeration. */
export function mapAuthApiError(err: unknown): AccountErrorCode {
  const e = (err ?? {}) as PgLikeError;
  if (isNetworkError(err)) return 'offline';
  if (e.status === 429 || e.code === 'over_request_rate_limit' || e.code === 'over_email_send_rate_limit') return 'rate_limited';
  if (e.code === 'weak_password') return 'weak_password';
  if (e.code === 'validation_failed') return 'invalid_input';
  if (e.code === 'email_not_confirmed') return 'email_not_confirmed';
  if (e.code === 'otp_expired') return 'link_expired';
  if (e.status && e.status >= 500) return 'unknown';
  return 'invalid_credentials';
}

/**
 * An email-link landing error (`error_code` / `error` / `error_description` from Supabase) -> a precise code. Expired or used
 * links and anything unrecognised read as "link expired or already used"; only rate limits stay distinct.
 */
export function mapLinkError(code: string | null | undefined): AccountErrorCode {
  if (code === 'email_not_confirmed') return 'email_not_confirmed';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return 'rate_limited';
  return 'link_expired';
}
