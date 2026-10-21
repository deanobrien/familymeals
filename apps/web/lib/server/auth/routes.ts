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
  '/about/sources',
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/reset-password',
];

/** Public path prefixes (the prefix itself or anything below it). */
export const PUBLIC_PREFIXES: readonly string[] = ['/auth/', '/invite/', '/s/', '/.well-known/'];

/**
 * `/api/jobs/**`: scheduler endpoints; each verifies its own shared secret inside the route
 * (`/api/jobs/storage-cleanup`: CRON_SECRET, ST1 D190; `/api/jobs/purge`: JOBS_SECRET, DX1 D256).
 */
export const PUBLIC_API_PREFIXES: readonly string[] = ['/api/health', '/api/jobs', '/api/shares/preview'];

/**
 * API routes the Android app calls with `Authorization: Bearer <supabase access token>` instead of cookies (D102).
 * Middleware lets a bearer request through; the ROUTE verifies the token (auth.getUser) and household membership.
 */
export const BEARER_API_PATHS: readonly string[] = ['/api/extract', '/api/extract/save', '/api/shopping/scan', '/api/products', '/api/recipes', '/api/export', '/api/settings', '/api/import/url'];

/** Bearer-capable route families (dynamic segments), e.g. GET /api/products/<barcode> (X2, D188). */
export const BEARER_API_PREFIXES: readonly string[] = [
  '/api/products/',
  '/api/images/',
  '/api/recipes/',
  '/api/catalogue/',
  '/api/discover/',
  '/api/export/',
  // Android parity JSON API (D340): every route verifies the token itself through withApi / resolveRequestAuth.
  '/api/plan',
  '/api/pantry',
  '/api/receipts',
  '/api/shopping/',
  // P1-B (D370, D378): recipe from a web link; soft dislikes under /api/settings/.
  '/api/import/',
  '/api/settings/',
  // P1-C notifications (D380): centre, activity feed, settings, device registration, test.
  '/api/notifications',
  // P2-B money (D400): spending, retailer links, per-shop prices and list comparison.
  '/api/money/',
  // P3-A (D420, D425): shared cookbook links, saving a copy, share-scoped images; kids' mode rounds and profiles.
  '/api/shares',
  '/api/kids',
];

export function acceptsBearer(pathname: string, authorization: string | null | undefined): boolean {
  const known = BEARER_API_PATHS.includes(pathname) || BEARER_API_PREFIXES.some((p) => pathname.startsWith(p));
  return known && /^Bearer\s+\S+$/i.test(authorization?.trim() ?? '');
}

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
