import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role client: BYPASSES RLS. Exception path only. Callers must re-verify the acting user's
 * membership in code before use (threat R2) and take the user id from the session, never from the request.
 * This is the only module that reads SUPABASE_SERVICE_ROLE_KEY.
 */
export function createSupabaseAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase service role is not configured');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
