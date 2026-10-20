import { AnthropicProvider, createAnthropicProvider, type AnthropicProviderOptions } from './anthropic.js';
import { AiError } from './errors.js';
import { MockAiProvider } from './mock.js';
import { OpenAiProvider, createAzureOpenAiProvider, createOpenAiProvider, type OpenAiProviderOptions } from './openai.js';
import type { AiProvider } from './provider.js';

/** Provider-agnostic configuration, produced by a server-side resolver (Settings file, env, ...). */
export type AiProviderConfig =
  | { kind: 'mock' }
  | { kind: 'openai'; apiKey: string; baseUrl?: string; model?: string; organization?: string }
  | { kind: 'azure'; apiKey: string; endpoint: string; deployment: string; apiVersion?: string }
  | { kind: 'anthropic'; apiKey: string; model?: string };

export type AiProviderKind = AiProviderConfig['kind'];

export interface ProviderExtras {
  openai?: Partial<OpenAiProviderOptions>;
  anthropic?: Partial<Omit<AnthropicProviderOptions, 'client'>>;
}

export function createProviderFromConfig(config: AiProviderConfig, extras: ProviderExtras = {}): AiProvider {
  switch (config.kind) {
    case 'mock':
      return new MockAiProvider();
    case 'openai':
      return createOpenAiProvider(
        { OPENAI_API_KEY: config.apiKey, OPENAI_BASE_URL: config.baseUrl, OPENAI_MODEL: config.model, OPENAI_ORG: config.organization },
        extras.openai,
      );
    case 'azure':
      return createAzureOpenAiProvider(
        { AZURE_OPENAI_API_KEY: config.apiKey, AZURE_OPENAI_ENDPOINT: config.endpoint, AZURE_OPENAI_DEPLOYMENT: config.deployment, AZURE_OPENAI_API_VERSION: config.apiVersion },
        extras.openai,
      );
    case 'anthropic':
      return createAnthropicProvider(
        { ANTHROPIC_API_KEY: config.apiKey, AI_MODEL_VISION: config.model },
        extras.anthropic,
      );
    default:
      throw new AiError('PROVIDER_NOT_CONFIGURED', 'unknown provider');
  }
}

/**
 * An AiProvider that asks `resolve` for the real provider on EVERY call, so a settings change takes effect
 * without a restart and long-lived singletons (planner services) never hold a stale key.
 */
export function createResolvingProvider(resolve: () => AiProvider | Promise<AiProvider>): AiProvider {
  const via = <K extends keyof AiProvider>(k: K) =>
    (async (...args: unknown[]) => {
      const p = await resolve();
      return (p[k] as unknown as (...a: unknown[]) => unknown).apply(p, args);
    }) as unknown as AiProvider[K];
  return {
    extractRecipe: via('extractRecipe'),
    parseReceipt: via('parseReceipt'),
    suggestTags: via('suggestTags'),
    parsePlanPrompt: via('parsePlanPrompt'),
    suggestIngredientMatches: via('suggestIngredientMatches'),
    suggestSubstitutions: via('suggestSubstitutions'),
    scanPantry: via('scanPantry'),
    scanShoppingList: via('scanShoppingList'),
    ping: async () => {
      const p = await resolve();
      if (!p.ping) throw new AiError('BAD_REQUEST', 'provider has no ping');
      return p.ping();
    },
  };
}

export { AnthropicProvider, OpenAiProvider };
