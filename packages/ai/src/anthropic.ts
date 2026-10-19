import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { AiError } from './errors.js';
import { DEFAULT_IMAGE_LIMITS, prepareImage, prepareImages, type ImageLimits } from './image.js';
import { matchPrompt, planPrompt, recipePrompt, subsPrompt, SYSTEM, tagsPrompt } from './prompts.js';
import type { AiProvider, CallContext, ImageInput, MatchCandidate, SubstitutionRequest, TaggableRecipe } from './provider.js';
import {
  IngredientMatchSchema, PlanConstraintsSchema, ReceiptParseSchema, RecipeExtractionSchema,
  SubstitutionSchema, TagSuggestionSchema, type HouseholdContext,
} from './schemas.js';
import {
  allowAllLimits, enforceLimit, noopSink, safeRecord,
  type AiOperation, type LimitChecker, type UsageSink,
} from './usage.js';

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
  if (s === 400 || s === 404 || s === 413 || s === 422) return new AiError('BAD_REQUEST', `status ${s}: ${e?.message ?? ''}`, { cause: e });
  return new AiError('PROVIDER_UNAVAILABLE', String(e?.message ?? e), { retryable: true, cause: e });
}

interface RunArgs<S extends z.ZodType> {
  operation: AiOperation;
  model: string;
  system: string;
  userContent: unknown[];
  schema: S;
  toolName: string;
  toolDescription: string;
  ctx?: CallContext;
}

export class AnthropicProvider implements AiProvider {
  private readonly o: Required<Omit<AnthropicProviderOptions, 'client'>> & { client: MessagesClient };

  constructor(opts: AnthropicProviderOptions) {
    this.o = {
      client: opts.client,
      visionModel: opts.visionModel ?? DEFAULT_VISION_MODEL,
      textModel: opts.textModel ?? DEFAULT_TEXT_MODEL,
      maxAttempts: Math.max(1, opts.maxAttempts ?? 3),
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
      usageSink: opts.usageSink ?? noopSink,
      limits: opts.limits ?? allowAllLimits,
      imageLimits: opts.imageLimits ?? DEFAULT_IMAGE_LIMITS,
      sleep: opts.sleep ?? realSleep,
      now: opts.now ?? Date.now,
    };
  }

  async extractRecipe(images: ImageInput[], hint?: string, ctx?: CallContext) {
    await enforceLimit(this.o.limits, ctx?.householdId, 'extractRecipe');
    const prepared = await prepareImages(images, this.o.imageLimits);
    return this.run({
      operation: 'extractRecipe', model: this.o.visionModel, system: SYSTEM.recipe, ctx,
      userContent: [...prepared.map(imgBlock), { type: 'text', text: recipePrompt(hint) }],
      schema: RecipeExtractionSchema, toolName: 'submit_recipe', toolDescription: 'Submit the extracted recipe.',
    });
  }

  async parseReceipt(image: ImageInput, ctx?: CallContext) {
    await enforceLimit(this.o.limits, ctx?.householdId, 'parseReceipt');
    const p = await prepareImage(image, this.o.imageLimits);
    return this.run({
      operation: 'parseReceipt', model: this.o.visionModel, system: SYSTEM.receipt, ctx,
      userContent: [imgBlock(p), { type: 'text', text: 'Parse this receipt.' }],
      schema: ReceiptParseSchema, toolName: 'submit_receipt', toolDescription: 'Submit the parsed receipt.',
    });
  }

  async suggestTags(recipe: TaggableRecipe, ctx?: CallContext) {
    await enforceLimit(this.o.limits, ctx?.householdId, 'suggestTags');
    return this.run({
      operation: 'suggestTags', model: this.o.textModel, system: SYSTEM.tags, ctx,
      userContent: [{ type: 'text', text: tagsPrompt(recipe) }],
      schema: TagSuggestionSchema, toolName: 'submit_tags', toolDescription: 'Submit tag suggestions.',
    });
  }

  async parsePlanPrompt(prompt: string, householdContext: HouseholdContext, ctx?: CallContext) {
    await enforceLimit(this.o.limits, ctx?.householdId, 'parsePlanPrompt');
    const result = await this.run({
      operation: 'parsePlanPrompt', model: this.o.textModel, system: SYSTEM.plan, ctx,
      userContent: [{ type: 'text', text: planPrompt(prompt, householdContext) }],
      schema: PlanConstraintsSchema, toolName: 'submit_plan_constraints', toolDescription: 'Submit the plan constraints.',
    });
    // Hard exclusions are enforced in code, not trusted to the model.
    const forced = householdContext.exclusions ?? [];
    const have = new Set(result.excludeIngredients.map((s) => s.toLowerCase()));
    for (const x of forced) if (!have.has(x.toLowerCase())) result.excludeIngredients.push(x);
    return result;
  }

  async suggestIngredientMatches(lines: string[], candidates: MatchCandidate[], ctx?: CallContext) {
    await enforceLimit(this.o.limits, ctx?.householdId, 'suggestIngredientMatches');
    const res = await this.run({
      operation: 'suggestIngredientMatches', model: this.o.textModel, system: SYSTEM.match, ctx,
      userContent: [{ type: 'text', text: matchPrompt(lines, candidates) }],
      schema: IngredientMatchSchema, toolName: 'submit_matches', toolDescription: 'Submit ingredient matches.',
    });
    // Never allow a hallucinated candidate id through.
    const ids = new Set(candidates.map((c) => c.id));
    for (const m of res.matches) if (m.candidateId !== null && !ids.has(m.candidateId)) m.candidateId = null;
    return res;
  }

  async suggestSubstitutions(req: SubstitutionRequest, ctx?: CallContext) {
    await enforceLimit(this.o.limits, ctx?.householdId, 'suggestSubstitutions');
    return this.run({
      operation: 'suggestSubstitutions', model: this.o.textModel, system: SYSTEM.subs, ctx,
      userContent: [{ type: 'text', text: subsPrompt(req) }],
      schema: SubstitutionSchema, toolName: 'submit_substitutions', toolDescription: 'Submit substitution suggestions.',
    });
  }

  /** Core call: tool-use structured output, validation, bounded retries, usage record. */
  private async run<S extends z.ZodType>(a: RunArgs<S>): Promise<z.output<S>> {
    const { client, maxAttempts, maxOutputTokens, now, sleep } = this.o;
    const inputSchema = z.toJSONSchema(a.schema, { io: 'input', unrepresentable: 'any' });
    const messages: any[] = [{ role: 'user', content: a.userContent }];
    const started = now();
    let inTok = 0, outTok = 0, attempts = 0;
    let lastErr: AiError | undefined;

    try {
      while (attempts < maxAttempts) {
        attempts++;
        let resp: any;
        try {
          resp = await client.messages.create({
            model: a.model,
            max_tokens: maxOutputTokens,
            system: a.system,
            messages,
            tools: [{ name: a.toolName, description: a.toolDescription, input_schema: inputSchema }],
            tool_choice: { type: 'tool', name: a.toolName },
          });
        } catch (e) {
          const err = toAiError(e);
          lastErr = err;
          if (isTransient(e) && attempts < maxAttempts) {
            await sleep(Math.min(8000, 500 * 2 ** (attempts - 1)));
            continue;
          }
          throw err;
        }
        inTok += resp?.usage?.input_tokens ?? 0;
        outTok += resp?.usage?.output_tokens ?? 0;

        const block = (resp?.content ?? []).find((b: any) => b?.type === 'tool_use' && b.name === a.toolName);
        const parsed = block ? a.schema.safeParse(block.input) : undefined;
        if (parsed?.success) {
          await safeRecord(this.o.usageSink, {
            householdId: a.ctx?.householdId, operation: a.operation, model: a.model,
            inputTokens: inTok, outputTokens: outTok, latencyMs: now() - started, status: 'ok', attempts,
          });
          return parsed.data;
        }
        const problem = !block
          ? (resp?.stop_reason === 'max_tokens' ? 'output truncated (max_tokens)' : 'no tool call in response')
          : z.prettifyError(parsed!.error).slice(0, 1500);
        lastErr = new AiError('INVALID_OUTPUT', problem);
        if (block && attempts < maxAttempts) {
          // Feed the validation problems back so the retry can correct itself.
          messages.push({ role: 'assistant', content: resp.content });
          messages.push({
            role: 'user',
            content: [{ type: 'tool_result', tool_use_id: block.id, is_error: true, content: `Schema validation failed:\n${problem}\nCall the tool again with corrected input.` }],
          });
        }
      }
      throw lastErr ?? new AiError('INVALID_OUTPUT');
    } catch (e) {
      const err = toAiError(e);
      await safeRecord(this.o.usageSink, {
        householdId: a.ctx?.householdId, operation: a.operation, model: a.model,
        inputTokens: inTok, outputTokens: outTok, latencyMs: now() - started, status: 'error', errorCode: err.code, attempts,
      });
      throw err;
    }
  }
}

function imgBlock(p: { mediaType: string; data: Buffer }) {
  return { type: 'image', source: { type: 'base64', media_type: p.mediaType, data: p.data.toString('base64') } };
}

/** Build from env. ANTHROPIC_API_KEY required; AI_MODEL_VISION / AI_MODEL_TEXT / AI_MAX_ATTEMPTS optional. */
export function createAnthropicProvider(
  env: Record<string, string | undefined> = process.env,
  extra: Partial<Omit<AnthropicProviderOptions, 'client'>> = {},
): AnthropicProvider {
  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AiError('PROVIDER_AUTH', 'ANTHROPIC_API_KEY is not set');
  const client = new Anthropic({ apiKey, maxRetries: 0 }) as unknown as MessagesClient; // retries handled here
  return new AnthropicProvider({
    client,
    visionModel: env.AI_MODEL_VISION || undefined,
    textModel: env.AI_MODEL_TEXT || undefined,
    maxAttempts: env.AI_MAX_ATTEMPTS ? Number(env.AI_MAX_ATTEMPTS) : undefined,
    ...extra,
  });
}
