import { NextResponse, type NextRequest } from 'next/server';
import { readPublicEnv, resolveAuthMode } from './lib/supabase/env';
import { redirectWithCookies, updateSession } from './lib/supabase/middleware';
import { GUEST_ONLY_PATHS, SIGN_IN_PATH, acceptsBearer, isApiPath, isPublicPath } from './lib/server/auth/routes';

/**
 * Refreshes the Supabase session on every request and gates protected routes.
 *  - supabase: signed-out users are redirected to /sign-in?next=... (401 JSON for /api/**).
 *  - mock (dev/CI only, no Supabase env): everything passes through.
 *  - unconfigured (production without Supabase env): protected routes return 503; mock auth is never used.
 * Server-side checks (getHouseholdContext) still run in pages/actions: middleware is a first gate, not the only one.
 */
export async function middleware(request: NextRequest) {
  const mode = resolveAuthMode();
  const { pathname, search } = request.nextUrl;
  if (mode === 'mock') return NextResponse.next();

  const env = readPublicEnv();
  if (mode === 'unconfigured' || !env) {
    if (isPublicPath(pathname)) return NextResponse.next();
    return new NextResponse('Authentication is not configured', { status: 503 });
  }

  const { response, user } = await updateSession(request, env);
  if (user) {
    if (GUEST_ONLY_PATHS.includes(pathname)) return redirectWithCookies(new URL('/', request.url), response);
    return response;
  }
  if (isPublicPath(pathname)) return response;
  // The Android app sends a bearer token, not cookies: the route verifies it (D102).
  if (acceptsBearer(pathname, request.headers.get('authorization'))) return response;
  if (isApiPath(pathname)) {
    return NextResponse.json({ error: 'unauthenticated' }, { status: 401, headers: { 'cache-control': 'no-store' } });
  }
  const url = new URL(SIGN_IN_PATH, request.url);
  url.searchParams.set('next', pathname + search);
  return redirectWithCookies(url, response);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|txt|xml|webmanifest)$).*)'],
};
