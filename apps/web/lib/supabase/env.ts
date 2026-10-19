/**
 * Supabase / auth mode resolution. Pure and edge-safe (used by middleware).
 *
 * Only NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are read here: both are safe to expose
 * (the anon key only grants what RLS allows). SUPABASE_SERVICE_ROLE_KEY is read exclusively in
 * lib/server/auth/admin.ts and must never be imported from client code.
 *
 * Modes:
 *  - 'supabase'     URL and anon key present: real cookie-based auth.
 *  - 'mock'         env missing and NODE_ENV !== 'production': local dev/CI without a Supabase stack.
 *  - 'unconfigured' env missing and NODE_ENV === 'production': mock auth is REFUSED; protected routes return 503.
 */
export type AuthMode = 'supabase' | 'mock' | 'unconfigured';

export interface PublicSupabaseEnv {
  url: string;
  anonKey: string;
}

export interface EnvSource {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  NODE_ENV?: string;
}

/** Literal property access so Next can inline NEXT_PUBLIC_* into client bundles. */
export function defaultEnv(): EnvSource {
  return {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NODE_ENV: process.env.NODE_ENV,
  };
}

export function readPublicEnv(env: EnvSource = defaultEnv()): PublicSupabaseEnv | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return { url, anonKey };
}

export function resolveAuthMode(env: EnvSource = defaultEnv()): AuthMode {
  if (readPublicEnv(env)) return 'supabase';
  return env.NODE_ENV === 'production' ? 'unconfigured' : 'mock';
}

/** Throws unless real Supabase env is present. */
export function requirePublicEnv(env: EnvSource = defaultEnv()): PublicSupabaseEnv {
  const e = readPublicEnv(env);
  if (!e) throw new Error('Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).');
  return e;
}
