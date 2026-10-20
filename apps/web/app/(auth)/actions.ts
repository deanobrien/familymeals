'use server';

import { redirect } from 'next/navigation';
import { z } from 'zod';
import { resolveAuthMode } from '../../lib/supabase/env';
import { createSupabaseServerClient } from '../../lib/supabase/server';
import { mapAuthApiError, type AuthErrorCode } from '../../lib/server/auth/errors';
import { safeNextPath } from '../../lib/server/auth/next-path';
import { getSiteUrl } from '../../lib/server/auth/site-url';

/**
 * Auth server actions. Outcomes are reported by redirecting with a fixed `error` code (never raw messages),
 * so no email, token or provider text is reflected into URLs or logs. Next verifies the Origin header on
 * server actions (CSRF, threat A7).
 */
const Email = z.email().max(254);
const NewPassword = z.string().min(10).max(200);

const field = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === 'string' ? v : '';
};

function back(path: string, error: AuthErrorCode, next?: string): never {
  const q = new URLSearchParams({ error });
  if (next && next !== '/') q.set('next', next);
  redirect(`${path}?${q.toString()}`);
}

function requireSupabaseMode(path: string, next?: string) {
  const mode = resolveAuthMode();
  if (mode === 'mock') back(path, 'mock_mode', next);
  if (mode === 'unconfigured') back(path, 'not_configured', next);
}

export async function signInAction(fd: FormData): Promise<void> {
  const next = safeNextPath(field(fd, 'next'));
  requireSupabaseMode('/sign-in', next);
  const email = Email.safeParse(field(fd, 'email').trim());
  const password = field(fd, 'password');
  if (!email.success || password.length === 0 || password.length > 200) back('/sign-in', 'invalid_credentials', next);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email: email.data, password });
  if (error) back('/sign-in', mapAuthApiError(error), next);
  redirect(next);
}

export async function signUpAction(fd: FormData): Promise<void> {
  // A pending invite (/invite/<token>) survives sign-up via `next`; otherwise continue to onboarding.
  const requested = safeNextPath(field(fd, 'next'));
  const next = requested === '/' ? '/household/new' : requested;
  requireSupabaseMode('/sign-up', requested);
  const email = Email.safeParse(field(fd, 'email').trim());
  const pw = NewPassword.safeParse(field(fd, 'password'));
  if (!email.success) back('/sign-up', 'invalid_input', requested);
  if (!pw.success) back('/sign-up', 'weak_password', requested);
  const supabase = await createSupabaseServerClient();
  const origin = await getSiteUrl();
  const { data, error } = await supabase.auth.signUp({
    email: email.data,
    password: pw.data,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) back('/sign-up', mapAuthApiError(error), requested);
  // With email confirmation on, there is no session yet; with it off, continue straight to onboarding.
  // The same "check your email" outcome is used for new and existing addresses (no enumeration).
  if (data.session) redirect(next);
  redirect(requested === '/' ? '/sign-up?sent=1' : `/sign-up?sent=1&next=${encodeURIComponent(requested)}`);
}

export async function resendConfirmationAction(fd: FormData): Promise<void> {
  requireSupabaseMode('/sign-in');
  const email = Email.safeParse(field(fd, 'email').trim());
  if (!email.success) back('/sign-in', 'invalid_input');
  const next = safeNextPath(field(fd, 'next'));
  const supabase = await createSupabaseServerClient();
  const origin = await getSiteUrl();
  // Result deliberately ignored apart from rate limiting: identical response for unknown/confirmed/pending addresses.
  const { error } = await supabase.auth.resend({
    type: 'signup',
    email: email.data,
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next === '/' ? '/household/new' : next)}` },
  });
  if (error && mapAuthApiError(error) === 'rate_limited') back('/sign-in', 'rate_limited');
  redirect('/sign-in?resent=1');
}

export async function forgotPasswordAction(fd: FormData): Promise<void> {
  requireSupabaseMode('/forgot-password');
  const email = Email.safeParse(field(fd, 'email').trim());
  if (email.success) {
    const supabase = await createSupabaseServerClient();
    const origin = await getSiteUrl();
    // Result deliberately ignored: identical response for unknown and known addresses (threat A5).
    await supabase.auth
      .resetPasswordForEmail(email.data, { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent('/reset-password')}` })
      .catch(() => undefined);
  }
  redirect('/forgot-password?sent=1');
}

export async function resetPasswordAction(fd: FormData): Promise<void> {
  requireSupabaseMode('/reset-password');
  const pw = NewPassword.safeParse(field(fd, 'password'));
  if (!pw.success) back('/reset-password', 'weak_password');
  if (field(fd, 'confirm') !== pw.data) back('/reset-password', 'invalid_input');
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) back('/sign-in', 'invalid_credentials');
  const { error } = await supabase.auth.updateUser({ password: pw.data });
  if (error) back('/reset-password', mapAuthApiError(error));
  redirect('/');
}

export async function signOutAction(): Promise<void> {
  if (resolveAuthMode() === 'supabase') {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut().catch(() => undefined);
  }
  redirect('/sign-in');
}
