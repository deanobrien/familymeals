/**
 * Allow-list for post-auth redirect targets (threat A6: open redirect). Only same-origin relative paths
 * survive; anything else (absolute URLs, protocol-relative `//x`, backslash tricks, control chars) falls back.
 */
export function safeNextPath(next: string | null | undefined, fallback = '/'): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > 2000) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  try {
    const base = 'http://fr.invalid';
    const u = new URL(next, base);
    if (u.origin !== base) return fallback;
    const path = u.pathname + u.search;
    // Never bounce back into the auth pages themselves.
    if (u.pathname === '/sign-in' || u.pathname === '/sign-up' || u.pathname.startsWith('/auth/')) return fallback;
    return path;
  } catch {
    return fallback;
  }
}
