import { NextResponse, type NextRequest } from 'next/server';
import { resolveAuthMode } from '../../../../lib/supabase/env';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { safeNextPath } from '../../../../lib/server/auth/next-path';

/**
 * Email-link landing (sign-up confirmation, password recovery): exchanges the one-time `code` for a session
 * cookie, then redirects to an allow-listed same-origin `next` path (threat A6).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next'));
  if (resolveAuthMode() === 'supabase' && code && code.length < 2000) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, origin));
  }
  return NextResponse.redirect(new URL('/sign-in?error=invalid_credentials', origin));
}
