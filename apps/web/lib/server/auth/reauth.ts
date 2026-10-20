import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { readPublicEnv } from '../../supabase/env';

/**
 * Re-authentication for destructive actions (DX1, D258; DATA-EXPORT-DELETION.md section 3: "require
 * re-authentication"). Checks the password of the SIGNED-IN user's email on a throwaway, non-persisting anon client,
 * then revokes only that temporary session (scope 'local'), so the user's real session is untouched. The password is
 * never logged or stored. Returns false on any failure (wrong password, rate limit, network).
 */
export async function verifyCurrentPassword(email: string | null, password: string): Promise<boolean> {
  const env = readPublicEnv();
  if (!env || !email || !password || password.length > 200) return false;
  const client = createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  try {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error || !data.session) return false;
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}
