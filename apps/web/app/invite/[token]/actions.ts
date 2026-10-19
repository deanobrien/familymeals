'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { resolveAuthMode } from '../../../lib/supabase/env';
import { createSupabaseServerClient } from '../../../lib/supabase/server';
import { getSessionUser } from '../../../lib/server/auth/household-context';
import { acceptInvitation, INVITE_TOKEN_RE } from '../../../lib/server/auth/household-service';
import { ACTIVE_HOUSEHOLD_COOKIE } from '../../../lib/server/auth/memberships';

/** Accept an invitation as the signed-in user. The token comes from the (validated) route param, never logged. */
export async function acceptInvitationAction(fd: FormData): Promise<void> {
  const token = fd.get('token');
  if (typeof token !== 'string' || !INVITE_TOKEN_RE.test(token)) redirect('/invite/invalid');
  if (resolveAuthMode() !== 'supabase') redirect(`/invite/${token}?error=mock_mode`);
  const user = await getSessionUser();
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/invite/${token}`)}`);
  const supabase = await createSupabaseServerClient();
  const res = await acceptInvitation(supabase, token);
  if (!res.ok) redirect(`/invite/${token}?error=${res.error}`);
  (await cookies()).set(ACTIVE_HOUSEHOLD_COOKIE, res.data.householdId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect('/household');
}
