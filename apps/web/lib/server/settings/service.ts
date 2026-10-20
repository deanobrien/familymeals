import type { SupabaseClient } from '@supabase/supabase-js';
import { exclusionsSchema, preferencesSchema } from '../../../app/settings/schema';
import { MemorySettingsStore } from './memory-store';
import { SupabaseSettingsStore } from './supabase-store';
import { SettingsError, type HouseholdSettings, type SettingsStore } from './types';

export type { HouseholdSettings } from './types';
export { SettingsError } from './types';

/** Who is asking: the verified user + household, and their own client (null in mock auth mode). Never from the request body. */
export interface SettingsCaller {
  householdId: string;
  userId: string;
  client: SupabaseClient | null;
  readOnly: boolean;
}

export type SettingsResult =
  | { ok: true; settings: HouseholdSettings }
  | { ok: false; error: 'forbidden' | 'read_only' | 'invalid_input' | 'unknown'; fieldErrors?: Record<string, string> };

export function storeFor(caller: Pick<SettingsCaller, 'client'>): SettingsStore {
  return caller.client ? new SupabaseSettingsStore(caller.client) : new MemorySettingsStore();
}

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const i of issues) {
    const k = String(i.path[0] ?? 'form');
    if (!(k in out)) out[k] = i.message;
  }
  return out;
}

async function guard(caller: SettingsCaller, write: boolean, fn: (s: SettingsStore) => Promise<void>): Promise<SettingsResult> {
  if (write && caller.readOnly) return { ok: false, error: 'read_only' };
  const store = storeFor(caller);
  try {
    await fn(store);
    return { ok: true, settings: await store.get(caller.householdId, caller.userId) };
  } catch (e) {
    if (e instanceof SettingsError) return { ok: false, error: e.code };
    return { ok: false, error: 'unknown' };
  }
}

export const loadSettings = (caller: SettingsCaller): Promise<SettingsResult> => guard(caller, false, async () => undefined);

/** Validates with the same schema as the form. Units / locale are display-only and are not stored here (device / cookie). */
export async function savePreferences(caller: SettingsCaller, raw: unknown): Promise<SettingsResult> {
  const r = preferencesSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: 'invalid_input', fieldErrors: fieldErrors(r.error.issues) };
  return guard(caller, true, (s) => s.savePreferences(caller.householdId, { defaultServings: r.data.defaultServings, weeklyBudgetPence: r.data.weeklyBudget }));
}

/** Replaces the exclusion list. A non-empty list needs `consent: true` (recorded for the signed-in member). */
export async function saveDietary(caller: SettingsCaller, raw: unknown): Promise<SettingsResult> {
  const r = exclusionsSchema.safeParse(raw);
  if (!r.success) return { ok: false, error: 'invalid_input', fieldErrors: fieldErrors(r.error.issues) };
  return guard(caller, true, (s) => s.saveExclusions(caller.householdId, caller.userId, r.data.tags));
}

export const withdrawConsent = (caller: SettingsCaller): Promise<SettingsResult> => guard(caller, true, (s) => s.withdrawConsent(caller.householdId, caller.userId));

export const removeAllDietary = (caller: SettingsCaller): Promise<SettingsResult> => guard(caller, true, (s) => s.removeAllDietary(caller.householdId, caller.userId));
