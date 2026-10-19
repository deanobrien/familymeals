import { z } from 'zod';
import { AiError } from './errors.js';
import { prepareImage, prepareImages, type ImageLimits, type PreparedImage } from './image.js';
import { matchPrompt, planPrompt, recipePrompt, subsPrompt, SYSTEM, tagsPrompt } from './prompts.js';
import type { AiProvider, CallContext, ImageInput, MatchCandidate, SubstitutionRequest, TaggableRecipe } from './provider.js';
import {
  IngredientMatchSchema, PlanConstraintsSchema, ReceiptParseSchema, RecipeExtractionSchema,
  SubstitutionSchema, TagSuggestionSchema, type HouseholdContext,
} from './schemas.js';
import {
  enforceLimit, safeRecord,
  type AiOperation, type LimitChecker, type UsageSink,
} from './usage.js';

/** Provider-neutral prompt content. Adapters translate to their wire format. */
export type PromptPart =
  | { type: 'text'; text: string }
  | { type: 'image'; image: PreparedImage };

export interface RunArgs<S extends z.ZodType = z.ZodType> {
  operation: AiOperation;
  /** 'vision' for image operations, 'text' for the rest. */
  modelKind: 'vision' | 'text';
  model: string;
  system: string;
  parts: PromptPart[];
  schema: S;
  toolName: string;
  toolDescription: string;
  ctx?: CallContext;
}

/** What one round trip to the provider produced. `candidate` is the structured output before zod validation. */
export interface SendResult {
  candidate?: unknown;
  /** Why there is no candidate (logged, and shown in the INVALID_OUTPUT detail). */
  missingReason?: string;
  inputTokens: number;
  outputTokens: number;
}

export interface BaseProviderOptions {
  maxAttempts: number;
  usageSink: UsageSink;
  limits: LimitChecker;
  imageLimits: ImageLimits;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/**
 * Shared operation surface + validate/retry/usage loop. Subclasses only implement the wire protocol
 * (`newSession` / `send`) and error classification (`classify`).
 */
export abstract class BaseAiProvider implements AiProvider {
  protected constructor(protected readonly base: BaseProviderOptions) {}

  protected abstract modelFor(kind: 'vision' | 'text'): string;
  /** Per-run conversation state (so a retry can append validation feedback). */
  protected abstract newSession(a: RunArgs): unknown;
  protected abstract send(a: RunArgs, session: unknown, feedback: string | undefined): Promise<SendResult>;
  /** Map a thrown transport error to an AiError and say whether to retry. */
  protected abstract classify(e: unknown): { error: AiError; transient: boolean };

  async extractRecipe(images: ImageInput[], hint?: string, ctx?: CallContext) {
    await enforceLimit(this.base.limits, ctx?.householdId, 'extractRecipe');
    const prepared = await prepareImages(images, this.base.imageLimits);
    return this.run({
      operation: 'extractRecipe', modelKind: 'vision', system: SYSTEM.recipe, ctx,
      parts: [...prepared.map((image): PromptPart => ({ type: 'image', image })), { type: 'text', text: recipePrompt(hint, prepared.length) }],
      schema: RecipeExtractionSchema, toolName: 'submit_recipe', toolDescription: 'Submit the extracted recipe.',
    });
  }

  async parseReceipt(image: ImageInput, ctx?: CallContext) {
    await enforceLimit(this.base.limits, ctx?.householdId, 'parseReceipt');
    const p = await prepareImage(image, this.base.imageLimits);
    return this.run({
      operation: 'parseReceipt', modelKind: 'vision', system: SYSTEM.receipt, ctx,
      parts: [{ type: 'image', image: p }, { type: 'text', text: 'Parse this receipt.' }],
      schema: ReceiptParseSchema, toolName: 'submit_receipt', toolDescription: 'Submit the parsed receipt.',
    });
  }

  async suggestTags(recipe: TaggableRecipe, ctx?: CallContext) {
    await enforceLimit(this.base.limits, ctx?.householdId, 'suggestTags');
    return this.run({
      operation: 'suggestTags', modelKind: 'text', system: SYSTEM.tags, ctx,
      parts: [{ type: 'text', text: tagsPrompt(recipe) }],
      schema: TagSuggestionSchema, toolName: 'submit_tags', toolDescription: 'Submit tag suggestions.',
    });
  }

  async parsePlanPrompt(prompt: string, householdContext: HouseholdContext, ctx?: CallContext) {
    await enforceLimit(this.base.limits, ctx?.householdId, 'parsePlanPrompt');
    const result = await this.run({
      operation: 'parsePlanPrompt', modelKind: 'text', system: SYSTEM.plan, ctx,
      parts: [{ type: 'text', text: planPrompt(prompt, householdContext) }],
      schema: PlanConstraintsSchema, toolName: 'submit_plan_constraints', toolDescription: 'Submit the plan constraints.',
    });
    // Hard exclusions are enforced in code, not trusted to the model.
    const forced = householdContext.exclusions ?? [];
    const have = new Set(result.excludeIngredients.map((s) => s.toLowerCase()));
    for (const x of forced) if (!have.has(x.toLowerCase())) result.excludeIngredients.push(x);
    return result;
  }

  async suggestIngredientMatches(lines: string[], candidates: MatchCandidate[], ctx?: CallContext) {
    await enforceLimit(this.base.limits, ctx?.householdId, 'suggestIngredientMatches');
    const res = await this.run({
      operation: 'suggestIngredientMatches', modelKind: 'text', system: SYSTEM.match, ctx,
      parts: [{ type: 'text', text: matchPrompt(lines, candidates) }],
      schema: IngredientMatchSchema, toolName: 'submit_matches', toolDescription: 'Submit ingredient matches.',
    });
    // Never allow a hallucinated candidate id through.
    const ids = new Set(candidates.map((c) => c.id));
    for (const m of res.matches) if (m.candidateId !== null && !ids.has(m.candidateId)) m.candidateId = null;
    return res;
  }

  async suggestSubstitutions(req: SubstitutionRequest, ctx?: CallContext) {
    await enforceLimit(this.base.limits, ctx?.householdId, 'suggestSubstitutions');
    return this.run({
      operation: 'suggestSubstitutions', modelKind: 'text', system: SYSTEM.subs, ctx,
      parts: [{ type: 'text', text: subsPrompt(req) }],
      schema: SubstitutionSchema, toolName: 'submit_substitutions', toolDescription: 'Submit substitution suggestions.',
    });
  }

  /** Minimal live check of credentials, endpoint and (vision) model. Does not log or return the key. */
  async ping(): Promise<{ model: string }> {
    await this.run({
      operation: 'ping', modelKind: 'vision', system: 'This is a connectivity check. Set ok to true.',
      parts: [{ type: 'text', text: 'ping' }],
      schema: z.object({ ok: z.boolean() }), toolName: 'submit_ping', toolDescription: 'Confirm the connection works.',
    });
    return { model: this.modelFor('vision') };
  }

  /** Core call: structured output, zod validation, bounded retries, usage record. */
  protected async run<S extends z.ZodType>(a0: Omit<RunArgs<S>, 'model'>): Promise<z.output<S>> {
    const a: RunArgs<S> = { ...a0, model: this.modelFor(a0.modelKind) };
    const { maxAttempts, now, sleep } = this.base;
    const session = this.newSession(a);
    const started = now();
    let inTok = 0, outTok = 0, attempts = 0;
    let lastErr: AiError | undefined;
    let feedback: string | undefined;

    try {
      while (attempts < maxAttempts) {
        attempts++;
        let res: SendResult;
        try {
          res = await this.send(a, session, feedback);
        } catch (e) {
          const { error, transient } = this.classify(e);
          lastErr = error;
          if (transient && attempts < maxAttempts) {
            await sleep(Math.min(8000, 500 * 2 ** (attempts - 1)));
            continue;
          }
          throw error;
        }
        inTok += res.inputTokens;
        outTok += res.outputTokens;

        const parsed = res.candidate !== undefined ? a.schema.safeParse(res.candidate) : undefined;
        if (parsed?.success) {
          await safeRecord(this.base.usageSink, {
            householdId: a.ctx?.householdId, operation: a.operation, model: a.model,
            inputTokens: inTok, outputTokens: outTok, latencyMs: now() - started, status: 'ok', attempts,
          });
          return parsed.data;
        }
        const problem = res.candidate === undefined
          ? (res.missingReason ?? 'no structured output in response')
          : z.prettifyError(parsed!.error).slice(0, 1500);
        lastErr = new AiError('INVALID_OUTPUT', problem);
        // Only feed validation problems back when the model actually produced something to correct.
        feedback = res.candidate !== undefined ? problem : undefined;
      }
      throw lastErr ?? new AiError('INVALID_OUTPUT');
    } catch (e) {
      const err = e instanceof AiError ? e : this.classify(e).error;
      await safeRecord(this.base.usageSink, {
        householdId: a.ctx?.householdId, operation: a.operation, model: a.model,
        inputTokens: inTok, outputTokens: outTok, latencyMs: now() - started, status: 'error', errorCode: err.code, attempts,
      });
      throw err;
    }
  }
}
