/**
 * Deep link for auth callbacks (D214): `familyrecipes://auth/callback`. Add that exact URL to the Supabase Auth redirect
 * allow-list (Authentication > URL Configuration) so confirmation / recovery / magic links can open the app.
 *
 * Supabase appends the result either in the URL fragment (implicit flow: `#access_token=...&refresh_token=...`) or the
 * query (PKCE: `?code=...`), and reports problems as `error` / `error_description` / `error_code` in either place.
 */
export const AUTH_CALLBACK_PATH = 'auth/callback';
export const AUTH_REDIRECT_URL = 'familyrecipes://auth/callback';

export type AuthLink =
  | { kind: 'tokens'; accessToken: string; refreshToken: string }
  | { kind: 'code'; code: string }
  | { kind: 'error'; message: string; code?: string }
  | { kind: 'none' };

/** True for `familyrecipes://auth/callback...` (and the Expo Go `exp://.../--/auth/callback...` form). */
export function isAuthCallbackUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const path = url.split(/[?#]/)[0] ?? '';
  return /^[a-z][a-z0-9+.-]*:\/\/(.*\/)?auth\/callback\/?$/i.test(path) || path.endsWith(`/--/${AUTH_CALLBACK_PATH}`);
}

function parts(url: string): URLSearchParams {
  const q = url.indexOf('?');
  const h = url.indexOf('#');
  const query = q >= 0 ? url.slice(q + 1, h >= 0 && h > q ? h : undefined) : '';
  const hash = h >= 0 ? url.slice(h + 1) : '';
  const merged = new URLSearchParams(query);
  for (const [k, v] of new URLSearchParams(hash)) merged.set(k, v); // fragment wins
  return merged;
}

export function parseAuthLink(url: string): AuthLink {
  if (!isAuthCallbackUrl(url)) return { kind: 'none' };
  const p = parts(url);
  const err = p.get('error_description') ?? p.get('error');
  if (err) {
    const code = p.get('error_code') ?? undefined;
    return { kind: 'error', message: err.replace(/\+/g, ' '), ...(code ? { code } : {}) };
  }
  const access = p.get('access_token');
  const refresh = p.get('refresh_token');
  if (access && refresh) return { kind: 'tokens', accessToken: access, refreshToken: refresh };
  const code = p.get('code');
  if (code) return { kind: 'code', code };
  return { kind: 'none' };
}
