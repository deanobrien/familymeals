import { createServerClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
import { requirePublicEnv } from './env';

/**
 * User-scoped Supabase client for server components, server actions and route handlers.
 * RLS applies as the signed-in user. Cookie writes are best-effort: server components cannot set
 * cookies, and middleware already refreshes the session on every request.
 */
export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const { url, anonKey } = requirePublicEnv();
  const store = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a server component: ignore (middleware refreshes the session).
        }
      },
    },
  });
}
