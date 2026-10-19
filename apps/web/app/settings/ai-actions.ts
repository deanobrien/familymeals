'use server';

import { describeActiveProvider, testConnection, type ActiveProviderInfo, type TestConnectionResult } from '../../lib/server/ai/provider';
import {
  KEYED_PROVIDERS, getAiSettingsStore, type KeyedProvider, type PublicAiSettings,
} from '../../lib/server/ai/settings-store';

/**
 * Server actions behind Settings > AI provider. The API key travels browser -> this server action -> encrypted
 * file only. Nothing here ever returns a key (only a masked hint), and nothing logs one.
 * TODO(auth): restrict to the household owner once auth/household lands (today: single local household).
 */
export interface AiSettingsView {
  settings: PublicAiSettings;
  active: ActiveProviderInfo;
}

const view = (): AiSettingsView => ({ settings: getAiSettingsStore().getPublic(), active: describeActiveProvider() });

export async function loadAiSettingsAction(): Promise<AiSettingsView> {
  return view();
}

export type SaveAiSettingsResult = { ok: true; view: AiSettingsView } | { ok: false; message: string; field?: string };

export async function saveAiSettingsAction(input: unknown): Promise<SaveAiSettingsResult> {
  const r = getAiSettingsStore().save(input);
  if (!r.ok) return { ok: false, message: r.message, ...(r.field ? { field: r.field } : {}) };
  return { ok: true, view: view() };
}

export async function removeAiKeyAction(kind: string): Promise<SaveAiSettingsResult> {
  if (!(KEYED_PROVIDERS as readonly string[]).includes(kind)) return { ok: false, message: 'Unknown provider.' };
  const r = getAiSettingsStore().removeKey(kind as KeyedProvider);
  if (!r.ok) return { ok: false, message: r.message };
  return { ok: true, view: view() };
}

/** Makes one tiny live call with the SAVED settings and reports success or a clear error. */
export async function testAiConnectionAction(): Promise<TestConnectionResult> {
  return testConnection();
}
