'use client';

import { useEffect, useState } from 'react';
import { Button, Input } from '@fr/ui';
import { resendConfirmationAction } from '../actions';
import { AUTH_ERROR_MESSAGES } from '../../../lib/server/auth/errors';

/**
 * Supabase reports an expired/used email link by redirecting with `#error=access_denied&error_code=otp_expired...`
 * (a hash fragment, invisible to the server). Read it here and show a precise, friendly message, plus the
 * "Resend confirmation email" action (also offered when the server reported email-not-confirmed / link-expired).
 */
export function LinkErrorAndResend({ serverCode, next }: { serverCode?: string; next: string }) {
  const [hashCode, setHashCode] = useState<string | null>(null);
  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, '');
    if (!raw) return;
    const p = new URLSearchParams(raw);
    const code = p.get('error_code') ?? p.get('error');
    if (code) {
      setHashCode(code === 'email_not_confirmed' ? 'email_not_confirmed' : 'link_expired');
      // Drop the fragment so the provider text/tokens do not linger in the address bar or history.
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
  }, []);
  const hashMessage = hashCode ? AUTH_ERROR_MESSAGES[hashCode as 'link_expired' | 'email_not_confirmed'] : null;
  const showResend = hashCode !== null || serverCode === 'email_not_confirmed' || serverCode === 'link_expired';
  return (
    <>
      {hashMessage ? (
        <p role="alert" data-testid="auth-error">
          {hashMessage}
        </p>
      ) : null}
      {showResend ? (
        <form action={resendConfirmationAction} data-testid="resend-confirmation" style={{ display: 'grid', gap: '0.75rem' }}>
          <input type="hidden" name="next" value={next} />
          <Input label="Email for the new confirmation link" name="email" type="email" autoComplete="email" required />
          <Button type="submit">Resend confirmation email</Button>
        </form>
      ) : null}
    </>
  );
}
