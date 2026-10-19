import { createServerClient } from '@supabase/ssr';
import type { User } from '@supabase/supabase-js';
import { NextResponse, type NextRequest } from 'next/server';
import type { PublicSupabaseEnv } from './env';

/**
 * Refreshes the Supabase session cookies for this request and returns the verified user (or null).
 * Uses auth.getUser() (validated against the auth server), never the unverified cookie session.
 * Network/auth failures resolve to "no user" so protected routes fail closed.
 */
export async function updateSession(
  request: NextRequest,
  env: PublicSupabaseEnv,
): Promise<{ response: NextResponse; user: User | null }> {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  let user: User | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user ?? null;
  } catch {
    user = null;
  }
  return { response, user };
}

/** Redirect that carries over any refreshed session cookies from `from`. */
export function redirectWithCookies(url: URL, from: NextResponse): NextResponse {
  const res = NextResponse.redirect(url);
  for (const c of from.cookies.getAll()) res.cookies.set(c);
  return res;
}
