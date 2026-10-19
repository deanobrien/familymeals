// AI provider settings in Supabase (lane S2, D126): the household's `household_ai_settings` row, read through
// `get_household_ai_settings` (any active member: the server needs the ciphertext to call the provider on any member's
// behalf) and written through `save_household_ai_settings` (owner of an active household only). The table itself has no
// grants. Keys arrive here already encrypted by AiSettingsStore (AES-256-GCM, APP_SECRET, AAD = household + provider).
import 'server-only';
import type { AiSettingsBackend, KeyedProvider, StoredSettings } from '../ai/settings-store';
import { SettingsWriteRefused } from '../ai/secret';
import { SupabaseRepositoryError, callRpc, type SupabaseClient } from './rpc';

type Row = Record<string, unknown>;

export class SupabaseSettingsBackend implements AiSettingsBackend {
  constructor(private readonly client: SupabaseClient, private readonly householdId: string) {}

  aad(kind: KeyedProvider): string {
    return `ai-key:${this.householdId}:${kind}`;
  }

  async read(): Promise<unknown | null> {
    const r = await callRpc<Row>(this.client, 'get_household_ai_settings', { p_household_id: this.householdId });
    if (!r) return null;
    const config = (r.config ?? {}) as Row;
    return { version: 1, provider: r.provider, ...config, keys: r.keys ?? {}, updatedAt: r.updatedAt };
  }

  async write(s: StoredSettings): Promise<void> {
    try {
      await callRpc(this.client, 'save_household_ai_settings', {
        p_household_id: this.householdId,
        p_provider: s.provider,
        p_config: { openai: s.openai, azure: s.azure, anthropic: s.anthropic },
        p_keys: s.keys,
      });
    } catch (e) {
      if (e instanceof SupabaseRepositoryError && e.code === '42501') {
        throw new SettingsWriteRefused('Only the household owner can change the AI provider (and not while the household is being deleted).');
      }
      throw e;
    }
  }

  /** "Forget all settings" = select the mock with no keys (the row is the owner's to keep). */
  async clear(): Promise<void> {
    await this.client.rpc('save_household_ai_settings', {
      p_household_id: this.householdId, p_provider: 'mock', p_config: {}, p_keys: {},
    });
  }
}
