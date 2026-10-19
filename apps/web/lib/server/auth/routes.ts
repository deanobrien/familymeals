/**
 * Route classification shared by middleware and tests. Pure, edge-safe.
 *
 * Everything not listed here requires a signed-in user. `/api/**` returns 401 JSON instead of redirecting.
 * Machine-to-machine endpoints (cron, webhooks) that authenticate by secret must be added to
 * PUBLIC_API_PREFIXES by their lane (and must verify that secret themselves).
 */
export const SIGN_IN_PATH = '/sign-in';

/** Exact public paths. */
export const PUBLIC_PATHS: readonly string[] = [
  '/privacy',
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/reset-password',
];

/** Public path prefixes (the prefix itself or anything below it). */
export const PUBLIC_PREFIXES: readonly string[] = ['/auth/', '/invite/'];

export const PUBLIC_API_PREFIXES: readonly string[] = [];

/** Auth pages a signed-in user is bounced away from. */
export const GUEST_ONLY_PATHS: readonly string[] = ['/sign-in', '/sign-up', '/forgot-password'];

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  return PUBLIC_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}
