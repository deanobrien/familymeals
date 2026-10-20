import { NextResponse, type NextRequest } from 'next/server';
import { readPublicEnv, resolveAuthMode } from './lib/supabase/env';
import { redirectWithCookies, updateSession } from './lib/supabase/middleware';
import { productionConfigProblems } from './lib/server/config/production';
import { GUEST_ONLY_PATHS, SIGN_IN_PATH, acceptsBearer, isApiPath, isPublicPath } from './lib/server/auth/routes';

/**
 * Refreshes the Supabase session on every request and gates protected routes.
 *  - supabase: signed-out users are redirected to /sign-in?next=... (401 JSON for /api/**).
 *  - mock (dev/CI only, no Supabase env): everything passes through.
 *  - unconfigured (production without Supabase env): protected routes return 503; mock auth is never used.
 * Server-side checks (getHouseholdContext) still run in pages/actions: middleware is a first gate, not the only one.
 */
const NOT_CONFIGURED_HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not configured</title></head><body style="font-family:system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem"><h1>This site is not configured yet</h1><p>See <a href="/api/health">/api/health</a> for details.</p></body></html>';

export async function middleware(request: NextRequest) {
  if (productionConfigProblems().length > 0 && !request.nextUrl.pathname.startsWith('/api/health')) {
    return new NextResponse(NOT_CONFIGURED_HTML, {
      status: 503,
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'retry-after': '60' },
    });
  }
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
