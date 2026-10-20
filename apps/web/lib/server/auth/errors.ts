/**
 * Maps Postgres/Supabase errors to fixed, user-safe codes. Messages are looked up from a whitelist so we
 * never reflect raw error text (which could contain tokens or emails) into pages, URLs or logs.
 */
export type AuthErrorCode =
  | 'invalid_credentials'
  | 'email_not_confirmed'
  | 'link_expired'
  | 'invalid_input'
  | 'weak_password'
  | 'rate_limited'
  | 'not_configured'
  | 'mock_mode'
  | 'forbidden'
  | 'read_only'
  | 'last_owner'
  | 'invitation_invalid'
  | 'not_found'
  | 'unknown';

export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  invalid_credentials: 'That email and password did not match. Please try again.',
  email_not_confirmed: 'Your email address has not been confirmed yet. Use the link in the confirmation email, or request a new one below.',
  link_expired:
    'That link has expired or was already used (some email security scanners open links automatically). Try signing in — your email may already be confirmed — or request a new link.',
  invalid_input: 'Please check the details you entered and try again.',
  weak_password: 'Choose a password of at least 10 characters.',
  rate_limited: 'Too many attempts. Please wait a minute and try again.',
  not_configured: 'Authentication is not configured on this server.',
  mock_mode: 'This action needs a Supabase connection and is unavailable in local mock mode.',
  forbidden: 'You do not have permission to do that.',
  read_only: 'This household is pending deletion and is read-only. The owner can cancel the deletion.',
  last_owner: 'A household must keep at least one owner. Make someone else an owner first.',
  invitation_invalid: 'This invitation is invalid, expired or has already been used.',
  not_found: 'We could not find that.',
  unknown: 'Something went wrong. Please try again.',
};

export function isAuthErrorCode(v: unknown): v is AuthErrorCode {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(AUTH_ERROR_MESSAGES, v);
}

export function messageFor(code: string | null | undefined): string | null {
  return isAuthErrorCode(code) ? AUTH_ERROR_MESSAGES[code] : null;
}

interface PgLikeError {
  code?: string;
  message?: string;
  status?: number;
}

/** Postgres SQLSTATEs used by the L1 functions: 42501 insufficient_privilege, 22023 invalid_parameter_value, 23514 check_violation. */
export function mapDbError(err: unknown): AuthErrorCode {
  const e = (err ?? {}) as PgLikeError;
  const msg = typeof e.message === 'string' ? e.message : '';
  if (e.status === 429) return 'rate_limited';
  if (/transfer ownership|last member/i.test(msg)) return 'last_owner';
  if (e.code === '42501') {
    // RLS denial vs the grace-period guard (guard_household_writable raises insufficient_privilege too).
    return /read.?only|pending[_ ]deletion|not writable/i.test(msg) ? 'read_only' : 'forbidden';
  }
  if (e.code === '22023') return /invitation/i.test(msg) ? 'invitation_invalid' : 'invalid_input';
  if (e.code === '23514') return /at least one active owner/i.test(msg) ? 'last_owner' : 'invalid_input';
  if (e.code === 'PGRST116') return 'not_found';
  return 'unknown';
}

/** Supabase Auth (GoTrue) sign-in/sign-up error mapping. Deliberately coarse to avoid account enumeration. */
export function mapAuthApiError(err: unknown): AuthErrorCode {
  const e = (err ?? {}) as PgLikeError & { code?: string };
  if (e.status === 429 || e.code === 'over_request_rate_limit' || e.code === 'over_email_send_rate_limit') return 'rate_limited';
  if (e.code === 'weak_password') return 'weak_password';
  if (e.code === 'validation_failed') return 'invalid_input';
  if (e.code === 'email_not_confirmed') return 'email_not_confirmed';
  if (e.code === 'otp_expired') return 'link_expired';
  if (e.status && e.status >= 500) return 'unknown';
  return 'invalid_credentials';
}

/**
 * Maps an error from the email-link landing (provider `error_code`/`error` query param, or a failed code exchange)
 * to a precise code. Expired/used links, a missing PKCE verifier (link opened in another browser) and unknown
 * codes all read as "link expired or already used"; only genuine denials stay generic.
 */
export function mapCallbackError(code: string | null | undefined): AuthErrorCode {
  if (code === 'email_not_confirmed') return 'email_not_confirmed';
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') return 'rate_limited';
  return 'link_expired';
}
