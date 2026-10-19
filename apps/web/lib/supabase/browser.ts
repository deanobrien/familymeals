'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { requirePublicEnv } from './env';

let client: SupabaseClient | undefined;

/** Browser client (anon key + user session cookie). Safe to use in client components. */
export function createSupabaseBrowserClient(): SupabaseClient {
  if (!client) {
    const { url, anonKey } = requirePublicEnv();
    client = createBrowserClient(url, anonKey);
  }
  return client;
}
