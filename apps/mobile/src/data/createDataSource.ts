import { getSupabase, isSupabaseConfigured } from '@/lib/supabase';
import type { DataSource } from './DataSource';
import { MockDataSource } from './mockDataSource';
import { SupabaseDataSource } from './supabaseDataSource';

/** Supabase when EXPO_PUBLIC_SUPABASE_URL (+ anon key) is set, otherwise the in-memory mock. */
export function createDataSource(): DataSource {
  return isSupabaseConfigured() ? new SupabaseDataSource({ client: getSupabase() }) : new MockDataSource();
}
