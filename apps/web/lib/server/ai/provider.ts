import 'server-only';
import {
  AiError, createProviderFromConfig, createResolvingProvider,
  DEFAULT_AZURE_API_VERSION, DEFAULT_OPENAI_BASE_URL, DEFAULT_OPENAI_MODEL,
  type AiProvider, type AiProviderConfig,
} from '@fr/ai';
import { DEFAULT_ANTHROPIC_MODEL, getAiSettingsStore, type AiSettingsStore } from './settings-store';

type Env = Record<string, string | undefined>;

export interface ActiveProviderInfo {
  kind: AiProviderConfig['kind'] | 'none';
  /** Human label for the UI, e.g. "OpenAI - gpt-4.1". Never contains a key. */
  label: string;
  model?: string;
  source: 'settings' | 'env' | 'default';
  /** False when a real provider is selected but cannot be built (missing key etc). */
  configured: boolean;
  /** True for the built-in sample-data provider. */
  isMock: boolean;
  problem?: string;
}

export interface ResolvedAi {
  config?: AiProviderConfig;
  info: ActiveProviderInfo;
}

const notConfigured = (kind: ActiveProviderInfo['kind'], source: ActiveProviderInfo['source'], problem: string): ResolvedAi => ({
  info: { kind, label: 'No AI provider configured', source, configured: false, isMock: false, problem },
});

function labelFor(c: AiProviderConfig): { label: string; model?: string } {
  switch (c.kind) {
    case 'mock': return { label: 'Sample data (mock AI, nothing is read from your photos)' };
    case 'openai': { const m = c.model || DEFAULT_OPENAI_MODEL; return { label: `OpenAI - ${m}`, model: m }; }
    case 'azure': return { label: `Azure OpenAI - ${c.deployment}`, model: c.deployment };
    case 'anthropic': { const m = c.model || DEFAULT_ANTHROPIC_MODEL; return { label: `Anthropic - ${m}`, model: m }; }
  }
}

/**
 * Decide the active provider. Precedence: Settings (owner-saved) > env (AI_PROVIDER + keys) > dev default (mock).
 * A real provider with a missing key is reported as NOT configured: it never silently falls back to the mock.
 */
export async function resolveAi(store: AiSettingsStore = getAiSettingsStore(), env: Env = process.env): Promise<ResolvedAi> {
  const { stored, keys } = await store.readWithKeys();
  if (stored) {
    const p = stored.provider;
    if (p === 'mock') return finish({ kind: 'mock' }, 'settings');
    if (p === 'openai') {
      const apiKey = keys.openai ?? env.OPENAI_API_KEY;
      if (!apiKey) return notConfigured('openai', 'settings', 'The saved OpenAI key is missing or unreadable. Enter it again in Settings.');
      return finish({
        kind: 'openai', apiKey,
        baseUrl: stored.openai.baseUrl || DEFAULT_OPENAI_BASE_URL,
        model: stored.openai.model || DEFAULT_OPENAI_MODEL,
        ...(stored.openai.organization ? { organization: stored.openai.organization } : {}),
      }, 'settings');
    }
    if (p === 'azure') {
      const apiKey = keys.azure ?? env.AZURE_OPENAI_API_KEY;
      if (!apiKey || !stored.azure.endpoint || !stored.azure.deployment) {
        return notConfigured('azure', 'settings', 'Azure OpenAI needs an endpoint, deployment name and key. Complete them in Settings.');
      }
      return finish({
        kind: 'azure', apiKey, endpoint: stored.azure.endpoint, deployment: stored.azure.deployment,
        apiVersion: stored.azure.apiVersion || DEFAULT_AZURE_API_VERSION,
      }, 'settings');
    }
    const apiKey = keys.anthropic ?? env.ANTHROPIC_API_KEY;
    if (!apiKey) return notConfigured('anthropic', 'settings', 'The saved Anthropic key is missing or unreadable. Enter it again in Settings.');
    return finish({ kind: 'anthropic', apiKey, model: stored.anthropic.model || DEFAULT_ANTHROPIC_MODEL }, 'settings');
  }

  switch (env.AI_PROVIDER) {
    case 'openai':
      return env.OPENAI_API_KEY
        ? finish({ kind: 'openai', apiKey: env.OPENAI_API_KEY, ...(env.OPENAI_BASE_URL ? { baseUrl: env.OPENAI_BASE_URL } : {}), ...(env.OPENAI_MODEL ? { model: env.OPENAI_MODEL } : {}), ...(env.OPENAI_ORG ? { organization: env.OPENAI_ORG } : {}) }, 'env')
        : notConfigured('openai', 'env', 'AI_PROVIDER=openai but OPENAI_API_KEY is not set. Add a provider in Settings.');
    case 'azure':
      return env.AZURE_OPENAI_API_KEY && env.AZURE_OPENAI_ENDPOINT && env.AZURE_OPENAI_DEPLOYMENT
        ? finish({ kind: 'azure', apiKey: env.AZURE_OPENAI_API_KEY, endpoint: env.AZURE_OPENAI_ENDPOINT, deployment: env.AZURE_OPENAI_DEPLOYMENT, ...(env.AZURE_OPENAI_API_VERSION ? { apiVersion: env.AZURE_OPENAI_API_VERSION } : {}) }, 'env')
        : notConfigured('azure', 'env', 'AI_PROVIDER=azure but the AZURE_OPENAI_* variables are incomplete. Add a provider in Settings.');
    case 'anthropic':
      return env.ANTHROPIC_API_KEY
        ? finish({ kind: 'anthropic', apiKey: env.ANTHROPIC_API_KEY, ...(env.AI_MODEL_VISION ? { model: env.AI_MODEL_VISION } : {}) }, 'env')
        : notConfigured('anthropic', 'env', 'AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is not set. Add a provider in Settings.');
    case 'mock':
      return finish({ kind: 'mock' }, 'env');
    default:
      // DECISIONS D6: development default is the deterministic mock. In production the mock refuses to run
      // (MOCK_FORBIDDEN), which the import flow reports as "no provider set up".
      return finish({ kind: 'mock' }, 'default');
  }
}

function finish(config: AiProviderConfig, source: ActiveProviderInfo['source']): ResolvedAi {
  const { label, model } = labelFor(config);
  return { config, info: { kind: config.kind, label, ...(model ? { model } : {}), source, configured: true, isMock: config.kind === 'mock' } };
}

/** Build the provider for THIS request from the current settings. Throws AiError PROVIDER_NOT_CONFIGURED if unusable. */
export async function getAiProvider(store?: AiSettingsStore, env?: Env): Promise<AiProvider> {
  const r = await resolveAi(store, env);
  if (!r.config) throw new AiError('PROVIDER_NOT_CONFIGURED', r.info.problem);
  return createProviderFromConfig(r.config);
}

export async function describeActiveProvider(store?: AiSettingsStore, env?: Env): Promise<ActiveProviderInfo> {
  return (await resolveAi(store, env)).info;
}

/** Long-lived provider handle for singletons (planner): re-resolves settings on every call. */
export const settingsAiProvider: AiProvider = createResolvingProvider(() => getAiProvider());

export type TestConnectionResult =
  | { ok: true; label: string; model: string; ms: number }
  | { ok: false; code: string; message: string };

/** Minimal live call with the saved settings: proves endpoint, key and model/deployment together. */
export async function testConnection(store?: AiSettingsStore, env?: Env): Promise<TestConnectionResult> {
  const r = await resolveAi(store, env);
  if (!r.config) return { ok: false, code: 'PROVIDER_NOT_CONFIGURED', message: r.info.problem ?? 'No AI provider is set up yet.' };
  const started = Date.now();
  try {
    const p = createProviderFromConfig(r.config, { openai: { maxAttempts: 1 }, anthropic: { maxAttempts: 1 } });
    if (!p.ping) return { ok: true, label: r.info.label, model: r.info.model ?? 'n/a', ms: Date.now() - started };
    const { model } = await p.ping();
    return { ok: true, label: r.info.label, model, ms: Date.now() - started };
  } catch (e) {
    if (e instanceof AiError) return { ok: false, code: e.code, message: e.userMessage };
    return { ok: false, code: 'UNEXPECTED', message: 'The test failed unexpectedly. Check the server log.' };
  }
}
