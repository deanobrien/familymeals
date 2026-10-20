import recipeFx from '../fixtures/recipe-extraction.json' with { type: 'json' };
import mealkitFx from '../fixtures/recipe-extraction-mealkit.json' with { type: 'json' };
import receiptFx from '../fixtures/receipt-parse.json' with { type: 'json' };
import tagFx from '../fixtures/tag-suggestion.json' with { type: 'json' };
import planFx from '../fixtures/plan-constraints.json' with { type: 'json' };
import subsFx from '../fixtures/substitutions.json' with { type: 'json' };
import subsByIngredientFx from '../fixtures/substitutions-by-ingredient.json' with { type: 'json' };
import scanFx from '../fixtures/pantry-scan.json' with { type: 'json' };
import listFx from '../fixtures/shopping-list-scan.json' with { type: 'json' };
import { planRequestToConstraints } from './plan.js';
import { AiError } from './errors.js';
import { DEFAULT_IMAGE_LIMITS, prepareImage, prepareImages } from './image.js';
import { PantryScanSchema, SCAN_MAX_IMAGES, normaliseScan, type PantryScanContext } from './pantry-scan.js';
import { SHOPPING_SCAN_MAX_IMAGES, ShoppingListScanSchema, normaliseShoppingListScan, type ShoppingListScanContext } from './shopping-list-scan.js';
import type { AiProvider, CallContext, ImageInput, MatchCandidate, SubstitutionRequest, TaggableRecipe } from './provider.js';
import {
  IngredientMatchSchema, PlanRequestSchema, ReceiptParseSchema, RecipeExtractionSchema,
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
    // A hint mentioning a meal kit returns the two-sided card fixture (printed nutrition/allergens, bracket quantities).
    const r = RecipeExtractionSchema.parse(clone(hint && /meal[ -]?kit/i.test(hint) ? mealkitFx : recipeFx));
    if (hint?.trim() && !/meal[ -]?kit/i.test(hint)) r.title = hint.trim().slice(0, 200);
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
    const p = PlanRequestSchema.parse(clone(planFx));
    const days = /(\d{1,2})\s*(?:days?|nights?|dinners?|meals?)/i.exec(prompt);
    if (days) p.days = Math.min(31, Math.max(1, Number(days[1])));
    const budget = /£\s*(\d+(?:\.\d{1,2})?)/.exec(prompt);
    if (budget) p.budgetPence = Math.round(Number(budget[1]) * 100);
    if (householdContext.defaultServings) p.servings = householdContext.defaultServings;
    return planRequestToConstraints(p, householdContext);
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

  /**
   * Deterministic sample scan. Relative dates in the fixture ("+2d") resolve against `context.today`.
   * A close-up (`focusItem`) returns that one item with a readable use-by date so the close-up flow can be exercised.
   */
  async scanPantry(images: ImageInput[], context: PantryScanContext = {}, ctx?: CallContext) {
    await this.pre('scanPantry', ctx);
    let count = images.length;
    if (this.o.validateImages) count = (await prepareImages(images, { ...DEFAULT_IMAGE_LIMITS, maxImages: SCAN_MAX_IMAGES })).length;
    const today = context.today && /^\d{4}-\d{2}-\d{2}$/.test(context.today) ? context.today : new Date().toISOString().slice(0, 10);
    const resolve = (v: string): string => {
      const m = /^\+(\d+)d$/.exec(v);
      if (!m) return v;
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + Number(m[1]));
      return d.toISOString().slice(0, 10);
    };
    if (context.focusItem?.trim()) {
      return normaliseScan(PantryScanSchema.parse({
        items: [{
          name: context.focusItem.trim().slice(0, 120), form: 'chilled', packaging: 'pack', count: 1,
          dates: { useBy: resolve('+3d'), legible: true, needsCloseUp: false }, confidence: 0.96, frameRefs: [1],
        }],
        warnings: [],
      }), count);
    }
    const raw = clone(scanFx) as { items: Array<{ dates: { useBy?: string; bestBefore?: string } }>; warnings: string[] };
    for (const it of raw.items) {
      if (it.dates.useBy) it.dates.useBy = resolve(it.dates.useBy);
      if (it.dates.bestBefore) it.dates.bestBefore = resolve(it.dates.bestBefore);
    }
    return normaliseScan(PantryScanSchema.parse(raw), count);
  }

  /** Deterministic sample handwritten list (11 lines: quantities, a note, a crossed-out line, an illegible one). */
  async scanShoppingList(images: ImageInput[], _context: ShoppingListScanContext = {}, ctx?: CallContext) {
    await this.pre('scanShoppingList', ctx);
    let count = images.length;
    if (this.o.validateImages) count = (await prepareImages(images, { ...DEFAULT_IMAGE_LIMITS, maxImages: SHOPPING_SCAN_MAX_IMAGES })).length;
    return normaliseShoppingListScan(ShoppingListScanSchema.parse(clone(listFx)), count);
  }

  async ping() {
    this.guard();
    return { model: 'mock' };
  }

  /**
   * Deterministic: keyed on the ingredient's words (butter, milk, egg, cream, flour, sugar, onion), else the single
   * fixture. It deliberately IGNORES `avoid` (it even offers peanut butter for butter): a real model can ignore the
   * instruction too, so the household exclusion re-check on the server is what keeps the output safe, and tests rely on it.
   */
  async suggestSubstitutions(req: SubstitutionRequest, ctx?: CallContext) {
    await this.pre('suggestSubstitutions', ctx);
    const words = req.ingredient.toLowerCase().split(/[^a-z]+/).filter(Boolean).map((w) => w.replace(/(?:es|s)$/, ''));
    const table = subsByIngredientFx as Record<string, Array<{ substitute: string; ratioNote: string; effect: string; dietSafe: boolean }>>;
    const key = Object.keys(table).find((k) => words.includes(k));
    if (!key) return SubstitutionSchema.parse({ ...clone(subsFx), suggestions: clone(subsFx).suggestions.map((s) => ({ ...s, original: req.ingredient })) });
    return SubstitutionSchema.parse({
      suggestions: table[key]!.map((s) => ({ original: req.ingredient, ...s })),
      notes: 'Mock fixture.',
    });
  }
}

export function createMockProvider(opts?: MockProviderOptions): MockAiProvider {
  return new MockAiProvider(opts);
}
