import { describe, expect, it } from 'vitest';
import { AiError, MockAiProvider, createAiProvider, createMockProvider, RecipeExtractionSchema } from '../src/index.js';
import { jpeg } from './helpers.js';

describe('MockAiProvider', () => {
  it('is deterministic and schema-valid', async () => {
    const m = createMockProvider({ env: { NODE_ENV: 'test' } });
    const img = await jpeg();
    const a = await m.extractRecipe([img]);
    const b = await m.extractRecipe([img]);
    expect(a).toEqual(b);
    expect(RecipeExtractionSchema.safeParse(a).success).toBe(true);
    expect(await m.parseReceipt(img)).toEqual(await m.parseReceipt(img));
  });

  it('returns independent copies (mutation does not leak)', async () => {
    const m = createMockProvider({ env: {} });
    const a = await m.extractRecipe([await jpeg()]);
    a.title = 'changed';
    expect((await m.extractRecipe([await jpeg()])).title).toContain('Lentil');
  });

  it('parses simple plan prompts deterministically and applies exclusions', async () => {
    const m = createMockProvider({ env: {} });
    const p = await m.parsePlanPrompt('plan 5 dinners under £45.50', { exclusions: ['peanuts'], defaultServings: 3 });
    expect(p).toMatchObject({ days: 5, budgetPence: 4550, servings: 3, excludeTerms: ['peanuts'] });
  });

  it('matches ingredient lines by name', async () => {
    const m = createMockProvider({ env: {} });
    const r = await m.suggestIngredientMatches(['Garlic', 'unobtainium'], [{ id: 'g', name: 'garlic' }]);
    expect(r.matches.map((x) => x.candidateId)).toEqual(['g', null]);
  });

  it('still enforces image validation like the real provider', async () => {
    const m = createMockProvider({ env: {} });
    expect((await m.extractRecipe([new Uint8Array([1, 2, 3])]).catch((e) => e)).code).toBe('UNSUPPORTED_IMAGE_TYPE');
  });
});

describe('production guard', () => {
  it('throws MOCK_FORBIDDEN when constructed in production without allow', () => {
    let err: unknown;
    try { new MockAiProvider({ env: { NODE_ENV: 'production' } }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe('MOCK_FORBIDDEN');
  });

  it('allows when explicitly permitted by option or env', () => {
    expect(() => new MockAiProvider({ env: { NODE_ENV: 'production' }, allowInProduction: true })).not.toThrow();
    expect(() => new MockAiProvider({ env: { NODE_ENV: 'production', AI_ALLOW_MOCK_IN_PRODUCTION: 'true' } })).not.toThrow();
  });

  it('re-checks on each call if NODE_ENV flips later', async () => {
    const env: Record<string, string | undefined> = { NODE_ENV: 'development' };
    const m = new MockAiProvider({ env });
    env.NODE_ENV = 'production';
    expect((await m.suggestTags({ title: 'x', ingredientNames: [] }).catch((e) => e)).code).toBe('MOCK_FORBIDDEN');
  });

  it('factory never silently falls back to mock when key is missing', () => {
    expect(() => createAiProvider({})).toThrow(/ANTHROPIC_API_KEY/);
    expect(createAiProvider({ AI_PROVIDER: 'mock', NODE_ENV: 'test' })).toBeInstanceOf(MockAiProvider);
    expect(() => createAiProvider({ AI_PROVIDER: 'mock', NODE_ENV: 'production' })).toThrow(AiError);
  });
});
