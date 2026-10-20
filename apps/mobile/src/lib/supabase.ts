import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Session persistence: tokens go in SecureStore (Keystore-backed), chunked because
 * SecureStore values are size-limited (~2KB). Falls back to AsyncStorage where
 * SecureStore is unavailable (e.g. web).
 * Only EXPO_PUBLIC_* anon values are used. Never put a service-role or AI key in the app.
 */
const CHUNK = 1800;

export const sessionStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const count = await SecureStore.getItemAsync(`${key}.n`);
      if (!count) return null;
      const parts: string[] = [];
      for (let i = 0; i < Number(count); i++) {
        const p = await SecureStore.getItemAsync(`${key}.${i}`);
        if (p == null) return null;
        parts.push(p);
      }
      return parts.join('');
    } catch {
      return AsyncStorage.getItem(key);
    }
  },
  async setItem(key: string, value: string): Promise<void> {
    try {
      const n = Math.ceil(value.length / CHUNK);
      for (let i = 0; i < n; i++) {
        await SecureStore.setItemAsync(`${key}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
      }
      await SecureStore.setItemAsync(`${key}.n`, String(n));
    } catch {
      await AsyncStorage.setItem(key, value);
    }
  },
  async removeItem(key: string): Promise<void> {
    try {
      const count = Number((await SecureStore.getItemAsync(`${key}.n`)) ?? 0);
      for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(`${key}.${i}`);
      await SecureStore.deleteItemAsync(`${key}.n`);
    } catch {
      await AsyncStorage.removeItem(key);
    }
  },
};

let client: SupabaseClient | null = null;

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.EXPO_PUBLIC_SUPABASE_URL && process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY);
}

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Set EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY');
  client = createClient(url, anon, {
    auth: {
      storage: sessionStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      // Email links (confirmation, recovery) carry the tokens in the URL fragment of `familyrecipes://auth/callback`
      // (D214, D320): the implicit flow needs no code verifier, which a link opened after an app restart would lack.
      flowType: 'implicit',
    },
  });
  return client;
}
