/**
 * @fr/ai - SERVER-ONLY. Never import from browser/client bundles (holds provider keys, uses sharp).
 */
import 'server-only';
import { createAnthropicProvider, type AnthropicProviderOptions } from './anthropic.js';
import { MockAiProvider } from './mock.js';
import type { AiProvider } from './provider.js';

export * from './schemas.js';
export * from './errors.js';
export * from './usage.js';
export * from './image.js';
export * from './provider.js';
export { AnthropicProvider, createAnthropicProvider, DEFAULT_TEXT_MODEL, DEFAULT_VISION_MODEL } from './anthropic.js';
export type { AnthropicProviderOptions, MessagesClient } from './anthropic.js';
export { MockAiProvider, createMockProvider } from './mock.js';
export type { MockProviderOptions } from './mock.js';

/**
 * Select a provider from env. AI_PROVIDER=mock|anthropic (default anthropic).
 * Never silently falls back to the mock: a missing key throws PROVIDER_AUTH.
 */
export function createAiProvider(
  env: Record<string, string | undefined> = process.env,
  extra: Partial<Omit<AnthropicProviderOptions, 'client'>> = {},
): AiProvider {
  if (env.AI_PROVIDER === 'mock') return new MockAiProvider({ env, limits: extra.limits });
  return createAnthropicProvider(env, extra);
}
