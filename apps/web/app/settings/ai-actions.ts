'use server';

import { describeActiveProvider, testConnection, type ActiveProviderInfo, type TestConnectionResult } from '../../lib/server/ai/provider';
import {
  KEYED_PROVIDERS, getAiSettingsStore, type KeyedProvider, type PublicAiSettings,
} from '../../lib/server/ai/settings-store';

/**
 * Server actions behind Settings > AI provider. The API key travels browser -> this server action -> encrypted
 * storage only (local file, or the household row in Supabase mode where only the OWNER may write, D126). Nothing here
 * ever returns a key (only a masked hint), and nothing logs one.
 */
export interface AiSettingsView {
  settings: PublicAiSettings;
  active: ActiveProviderInfo;
}

const view = async (): Promise<AiSettingsView> => ({ settings: await getAiSettingsStore().getPublic(), active: await describeActiveProvider() });

export async function loadAiSettingsAction(): Promise<AiSettingsView> {
  return view();
}

export type SaveAiSettingsResult = { ok: true; view: AiSettingsView } | { ok: false; message: string; field?: string };

export async function saveAiSettingsAction(input: unknown): Promise<SaveAiSettingsResult> {
  const r = await getAiSettingsStore().save(input);
  if (!r.ok) return { ok: false, message: r.message, ...(r.field ? { field: r.field } : {}) };
  return { ok: true, view: await view() };
}

export async function removeAiKeyAction(kind: string): Promise<SaveAiSettingsResult> {
  if (!(KEYED_PROVIDERS as readonly string[]).includes(kind)) return { ok: false, message: 'Unknown provider.' };
  const r = await getAiSettingsStore().removeKey(kind as KeyedProvider);
  if (!r.ok) return { ok: false, message: r.message };
  return { ok: true, view: await view() };
}

/** Makes one tiny live call with the SAVED settings and reports success or a clear error. */
export async function testAiConnectionAction(): Promise<TestConnectionResult> {
  return testConnection();
}
