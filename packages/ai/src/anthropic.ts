import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { BaseAiProvider, type RunArgs, type SendResult } from './base.js';
import { AiError } from './errors.js';
import { DEFAULT_IMAGE_LIMITS, type ImageLimits } from './image.js';
import { allowAllLimits, noopSink, type LimitChecker, type UsageSink } from './usage.js';

/** Minimal structural view of the SDK client so tests can inject a fake. */
export interface MessagesClient {
  messages: { create(params: any, options?: any): Promise<any> };
}

export interface AnthropicProviderOptions {
  client: MessagesClient;
  visionModel?: string;
  textModel?: string;
  /** Total attempts per call (first try + retries), covering transient errors AND schema-invalid output. */
  maxAttempts?: number;
  maxOutputTokens?: number;
  usageSink?: UsageSink;
  limits?: LimitChecker;
  imageLimits?: ImageLimits;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export const DEFAULT_VISION_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_TEXT_MODEL = 'claude-haiku-4-5';

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isTransient(e: any): boolean {
  const s = e?.status;
  if (typeof s === 'number') return s === 408 || s === 409 || s === 429 || s >= 500;
  // Connection / timeout errors carry no HTTP status.
  const n = String(e?.name ?? '') + String(e?.code ?? '');
  return /Connection|Timeout|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND/i.test(n);
}

function toAiError(e: any): AiError {
  if (e instanceof AiError) return e;
  const s = e?.status;
  if (s === 401 || s === 403) return new AiError('PROVIDER_AUTH', `status ${s}`, { cause: e });
  if (s === 429) return new AiError('RATE_LIMITED', 'status 429', { retryable: true, cause: e });
  if (s === 404) return new AiError('MODEL_NOT_FOUND', `status 404: ${e?.message ?? ''}`, { cause: e });
  if (s === 400 || s === 413 || s === 422) return new AiError('BAD_REQUEST', `status ${s}: ${e?.message ?? ''}`, { cause: e });
  return new AiError('PROVIDER_UNAVAILABLE', String(e?.message ?? e), { retryable: true, cause: e });
}

interface Session { messages: any[]; lastBlock?: any; lastContent?: any }

export class AnthropicProvider extends BaseAiProvider {
  private readonly o: { client: MessagesClient; visionModel: string; textModel: string; maxOutputTokens: number };

  constructor(opts: AnthropicProviderOptions) {
    super({
      maxAttempts: Math.max(1, opts.maxAttempts ?? 3),
      usageSink: opts.usageSink ?? noopSink,
      limits: opts.limits ?? allowAllLimits,
      imageLimits: opts.imageLimits ?? DEFAULT_IMAGE_LIMITS,
      sleep: opts.sleep ?? realSleep,
      now: opts.now ?? Date.now,
    });
    this.o = {
      client: opts.client,
      visionModel: opts.visionModel ?? DEFAULT_VISION_MODEL,
      textModel: opts.textModel ?? DEFAULT_TEXT_MODEL,
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
    };
  }

  protected modelFor(kind: 'vision' | 'text') {
    return kind === 'vision' ? this.o.visionModel : this.o.textModel;
  }

  protected classify(e: unknown) { return { error: toAiError(e), transient: isTransient(e) }; }

  protected newSession(a: RunArgs): Session {
    const content = a.parts.map((p) => p.type === 'text'
      ? { type: 'text', text: p.text }
      : { type: 'image', source: { type: 'base64', media_type: p.image.mediaType, data: p.image.data.toString('base64') } });
    return { messages: [{ role: 'user', content }] };
  }

  protected async send(a: RunArgs, session: unknown, feedback: string | undefined): Promise<SendResult> {
    const s = session as Session;
    if (feedback !== undefined && s.lastBlock) {
      // Feed the validation problems back so the retry can correct itself.
      s.messages.push({ role: 'assistant', content: s.lastContent });
      s.messages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: s.lastBlock.id, is_error: true, content: `Schema validation failed:\n${feedback}\nCall the tool again with corrected input.` }],
      });
    }
    const inputSchema = z.toJSONSchema(a.schema, { io: 'input', unrepresentable: 'any' });
    const resp = await this.o.client.messages.create({
      model: a.model,
      max_tokens: this.o.maxOutputTokens,
      system: a.system,
      messages: s.messages,
      tools: [{ name: a.toolName, description: a.toolDescription, input_schema: inputSchema }],
      tool_choice: { type: 'tool', name: a.toolName },
    });
    const inputTokens = resp?.usage?.input_tokens ?? 0;
    const outputTokens = resp?.usage?.output_tokens ?? 0;
    const block = (resp?.content ?? []).find((b: any) => b?.type === 'tool_use' && b.name === a.toolName);
    s.lastBlock = block;
    s.lastContent = resp?.content;
    if (!block) {
      return {
        inputTokens, outputTokens,
        missingReason: resp?.stop_reason === 'max_tokens' ? 'output truncated (max_tokens)' : 'no tool call in response',
      };
    }
    return { candidate: block.input, inputTokens, outputTokens };
  }
}

/** Build from env. ANTHROPIC_API_KEY required; AI_MODEL_VISION / AI_MODEL_TEXT / AI_MAX_ATTEMPTS optional. */
export function createAnthropicProvider(
  env: Record<string, string | undefined> = process.env,
  extra: Partial<Omit<AnthropicProviderOptions, 'client'>> = {},
): AnthropicProvider {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiError('PROVIDER_NOT_CONFIGURED', 'ANTHROPIC_API_KEY is not set');
  const client = new Anthropic({ apiKey, maxRetries: 0 }) as unknown as MessagesClient; // retries handled here
  return new AnthropicProvider({
    client,
    visionModel: env.AI_MODEL_VISION || undefined,
    textModel: env.AI_MODEL_TEXT || undefined,
    maxAttempts: env.AI_MAX_ATTEMPTS ? Number(env.AI_MAX_ATTEMPTS) : undefined,
    ...extra,
  });
}
