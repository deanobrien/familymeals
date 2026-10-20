import { NextResponse, type NextRequest } from 'next/server';
import { resolveAuthMode } from '../../../../lib/supabase/env';
import { createSupabaseServerClient } from '../../../../lib/supabase/server';
import { safeNextPath } from '../../../../lib/server/auth/next-path';
import { mapCallbackError, type AuthErrorCode } from '../../../../lib/server/auth/errors';
import { publicOrigin } from '../../../../lib/server/site-url';

/**
 * Email-link landing (sign-up confirmation, password recovery): exchanges the one-time `code` for a session
 * cookie, then redirects to an allow-listed same-origin `next` path (threat A6). Redirects are built on the
 * PUBLIC origin: behind App Service `request.url` carries the container's internal host.
 */
export async function GET(request: NextRequest) {
  const origin = publicOrigin(request);
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const next = safeNextPath(searchParams.get('next'));
  const fail = (e: AuthErrorCode) => NextResponse.redirect(`${origin}/sign-in?error=${e}`);

  // Supabase can report a bad/expired link with query params (hash-style errors are handled client-side on /sign-in).
  const providerError = searchParams.get('error_code') ?? searchParams.get('error');
  if (providerError) return fail(mapCallbackError(providerError));

  if (resolveAuthMode() === 'supabase' && code && code.length < 2000) {
    const supabase = await createSupabaseServerClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}${next}`);
    return fail(mapCallbackError((error as { code?: string }).code));
  }
  return fail('link_expired');
}
