import recipeFx from '../fixtures/recipe-extraction.json' with { type: 'json' };
import receiptFx from '../fixtures/receipt-parse.json' with { type: 'json' };
import tagFx from '../fixtures/tag-suggestion.json' with { type: 'json' };
import planFx from '../fixtures/plan-constraints.json' with { type: 'json' };
import subsFx from '../fixtures/substitutions.json' with { type: 'json' };
import { AiError } from './errors.js';
import { prepareImage, prepareImages } from './image.js';
import type { AiProvider, CallContext, ImageInput, MatchCandidate, SubstitutionRequest, TaggableRecipe } from './provider.js';
import {
  IngredientMatchSchema, PlanConstraintsSchema, ReceiptParseSchema, RecipeExtractionSchema,
  SubstitutionSchema, TagSuggestionSchema, type HouseholdContext,
} from './schemas.js';
import { allowAllLimits, enforceLimit, type AiOperation, type LimitChecker } from './usage.js';

export interface MockProviderOptions {
  /** Explicit opt-in to run the mock when NODE_ENV=production. Also: AI_ALLOW_MOCK_IN_PRODUCTION=true. */
  allowInProduction?: boolean;
  env?: Record<string, string | undefined>;
  limits?: LimitChecker;
  /** Run real image validation (type/size) so mock and real behave alike. Default true. */
  validateImages?: boolean;
}

const clone = <T>(x: T): T => structuredClone(x);

/** Deterministic fixture-backed provider for dev/CI/E2E. Refuses to run in production unless explicitly allowed. */
export class MockAiProvider implements AiProvider {
  private readonly o: Required<Omit<MockProviderOptions, 'env'>> & { env: Record<string, string | undefined> };

  constructor(opts: MockProviderOptions = {}) {
    this.o = {
      allowInProduction: opts.allowInProduction ?? false,
      env: opts.env ?? process.env,
      limits: opts.limits ?? allowAllLimits,
      validateImages: opts.validateImages ?? true,
    };
    this.guard();
  }

  /** Runtime guard, re-checked on every call so a late NODE_ENV change cannot slip through. */
  private guard() {
    const prod = this.o.env.NODE_ENV === 'production';
    const allowed = this.o.allowInProduction || this.o.env.AI_ALLOW_MOCK_IN_PRODUCTION === 'true';
    if (prod && !allowed) {
      throw new AiError('MOCK_FORBIDDEN', 'MockAiProvider used with NODE_ENV=production without explicit allow');
    }
  }

  private async pre(op: AiOperation, ctx?: CallContext) {
    this.guard();
    await enforceLimit(this.o.limits, ctx?.householdId, op);
  }

  async extractRecipe(images: ImageInput[], hint?: string, ctx?: CallContext) {
    await this.pre('extractRecipe', ctx);
    if (this.o.validateImages) await prepareImages(images);
    const r = RecipeExtractionSchema.parse(clone(recipeFx));
    if (hint?.trim()) r.title = hint.trim().slice(0, 200);
    return r;
  }

  async parseReceipt(image: ImageInput, ctx?: CallContext) {
    await this.pre('parseReceipt', ctx);
    if (this.o.validateImages) await prepareImage(image);
    return ReceiptParseSchema.parse(clone(receiptFx));
  }

  async suggestTags(_recipe: TaggableRecipe, ctx?: CallContext) {
    await this.pre('suggestTags', ctx);
    return TagSuggestionSchema.parse(clone(tagFx));
  }

  async parsePlanPrompt(prompt: string, householdContext: HouseholdContext, ctx?: CallContext) {
    await this.pre('parsePlanPrompt', ctx);
    const p = PlanConstraintsSchema.parse(clone(planFx));
    const days = /(\d{1,2})\s*(?:days?|nights?|dinners?|meals?)/i.exec(prompt);
    if (days) p.days = Math.min(31, Math.max(1, Number(days[1])));
    const budget = /£\s*(\d+(?:\.\d{1,2})?)/.exec(prompt);
    if (budget) p.budgetPence = Math.round(Number(budget[1]) * 100);
    if (householdContext.defaultServings) p.servings = householdContext.defaultServings;
    p.excludeIngredients = [...(householdContext.exclusions ?? [])];
    return p;
  }

  async suggestIngredientMatches(lines: string[], candidates: MatchCandidate[], ctx?: CallContext) {
    await this.pre('suggestIngredientMatches', ctx);
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();
    return IngredientMatchSchema.parse({
      matches: lines.map((line) => {
        const n = norm(line);
        const exact = candidates.find((c) => norm(c.name) === n);
        const partial = exact ?? candidates.find((c) => n.includes(norm(c.name)) && norm(c.name).length > 2);
        return partial
          ? { line, candidateId: partial.id, confidence: exact ? 0.95 : 0.6, reason: 'mock name match' }
          : { line, candidateId: null, confidence: 0 };
      }),
    });
  }

  async suggestSubstitutions(_req: SubstitutionRequest, ctx?: CallContext) {
    await this.pre('suggestSubstitutions', ctx);
    return SubstitutionSchema.parse(clone(subsFx));
  }
}

export function createMockProvider(opts?: MockProviderOptions): MockAiProvider {
  return new MockAiProvider(opts);
}
