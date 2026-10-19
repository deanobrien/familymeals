/**
 * @fr/ai - SERVER-ONLY. Never import from browser/client bundles (holds provider keys, uses sharp).
 */
import 'server-only';
import { createAnthropicProvider, type AnthropicProviderOptions } from './anthropic.js';
import { createAzureOpenAiProvider, createOpenAiProvider } from './openai.js';
import { MockAiProvider } from './mock.js';
import type { AiProvider } from './provider.js';

export * from './schemas.js';
export { SYSTEM, recipePrompt } from './prompts.js';
export * from './errors.js';
export * from './pantry-scan.js';
export * from './usage.js';
export * from './image.js';
export * from './provider.js';
export { AnthropicProvider, createAnthropicProvider, DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL } from './anthropic.js';
export type { AnthropicProviderOptions, MessagesClient } from './anthropic.js';
export { OpenAiProvider, createOpenAiProvider, createAzureOpenAiProvider, DEFAULT_OPENAI_BASE_URL, DEFAULT_OPENAI_MODEL, DEFAULT_AZURE_API_VERSION } from './openai.js';
export type { OpenAiProviderOptions, AzureOpenAiTarget } from './openai.js';
export { createProviderFromConfig, createResolvingProvider } from './config.js';
export type { AiProviderConfig, AiProviderKind, ProviderExtras } from './config.js';
export { toStrictSchema } from './strict-schema.js';
export { MockAiProvider, createMockProvider } from './mock.js';
export type { MockProviderOptions } from './mock.js';

/**
 * Select a provider from env. AI_PROVIDER=mock|anthropic|openai|azure (default anthropic).
 * Never silently falls back to the mock: a missing key throws PROVIDER_NOT_CONFIGURED.
 */
export function createAiProvider(
  env: Record<string, string | undefined> = process.env,
  extra: Partial<Omit<AnthropicProviderOptions, 'client'>> = {},
): AiProvider {
  if (env.AI_PROVIDER === 'mock') return new MockAiProvider({ env, limits: extra.limits });
  if (env.AI_PROVIDER === 'openai') return createOpenAiProvider(env, extra);
  if (env.AI_PROVIDER === 'azure') return createAzureOpenAiProvider(env, extra);
  return createAnthropicProvider(env, extra);
}
