import { describe, expect, it } from 'vitest';
import { AiError, createMockProvider, type AiProvider } from '@fr/ai';
import { applyCorrections } from '@fr/recipe-import';
import { ingredientMatcher, ingredientParser } from './engine-adapter';
import { runExtraction, saveImport } from './pipeline';
import { InMemoryRecipeSink } from './sink';
import { getUpload } from './upload-store';

const PNG = new Uint8Array(
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
);
const mock = () => createMockProvider({ env: { NODE_ENV: 'test' } });

describe('engine adapter (@fr/engine parse + catalogue matcher)', () => {
  it('parses common line shapes', () => {
    expect(ingredientParser.parse('200g red lentils').quantity).toMatchObject({ kind: 'exact', value: 200, unit: 'g' });
    expect(ingredientParser.parse('1 onion, finely chopped')).toMatchObject({ name: 'onion', preparation: 'finely chopped' });
    expect(ingredientParser.parse('1/2 tsp salt').quantity).toMatchObject({ value: 0.5, unit: 'tsp' });
    expect(ingredientParser.parse('2-3 cloves garlic').quantity).toMatchObject({ kind: 'range', min: 2, max: 3, unit: 'clove' });
    expect(ingredientParser.parse('salt to taste').quantity.kind).toBe('to_taste');
    expect(ingredientParser.parse('see the card').quantity.kind).toBe('unparsed');
    // loose amounts stay approximate with no unit (never converted to a weight)
    expect(ingredientParser.parse('a pinch of salt').quantity).toMatchObject({ kind: 'approximate', approxLabel: 'pinch' });
    expect(ingredientParser.parse('a pinch of salt').quantity.unit).toBeUndefined();
  });
  it('matches known ingredients', () => {
    expect(ingredientMatcher.match('onions').ingredientId).toBeDefined();
    expect(ingredientMatcher.match('dragon fruit').ingredientId).toBeUndefined();
    // ids are canonical @fr/refdata uuids
    expect(ingredientMatcher.match('red lentils').ingredientId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('import pipeline with mock AI', () => {
  it('extracts a reviewable draft and keeps the upload', async () => {
    const sink = new InMemoryRecipeSink();
    const out = await runExtraction({ images: [PNG] }, { provider: mock(), sink });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.draft.title.value).toBe("Nana's Lentil Soup");
    expect(out.draft.titleProposed).toBe(true);
    expect(out.draft.ingredients).toHaveLength(6);
    expect(out.draft.issues.filter((i) => i.blocking)).toHaveLength(0);
    expect(out.draft.sourceImageRefs).toHaveLength(1);
    expect(getUpload(out.uploadId)?.images).toHaveLength(1);
  });

  it('uses the user title', async () => {
    const out = await runExtraction({ images: [PNG], title: 'Gran’s soup' }, { provider: mock(), sink: new InMemoryRecipeSink() });
    expect(out.ok && out.draft.title.value).toBe('Gran’s soup');
  });

  it('rejects unsupported images with a user message and stores nothing', async () => {
    const out = await runExtraction({ images: [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])] }, { provider: mock(), sink: new InMemoryRecipeSink() });
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe('UNSUPPORTED_IMAGE_TYPE');
    expect(out.error.message).toMatch(/JPEG, PNG or WebP/);
    expect(out.uploadId).toBeUndefined();
  });

  it('rejects more than 6 images and no images', async () => {
    const sink = new InMemoryRecipeSink();
    const many = await runExtraction({ images: Array(7).fill(PNG) }, { provider: mock(), sink });
    expect(!many.ok && many.error.code).toBe('TOO_MANY_IMAGES');
    const none = await runExtraction({ images: [] }, { provider: mock(), sink });
    expect(!none.ok && none.error.code).toBe('NO_IMAGES');
  });

  it('keeps images for retry after a provider failure, then succeeds', async () => {
    const sink = new InMemoryRecipeSink();
    const real = mock();
    let calls = 0;
    const flaky: AiProvider = Object.assign(Object.create(real) as AiProvider, {
      extractRecipe: async (...a: Parameters<AiProvider['extractRecipe']>) => {
        if (calls++ === 0) throw new AiError('PROVIDER_UNAVAILABLE', 'boom', { retryable: true });
        return real.extractRecipe(...a);
      },
    });
    const first = await runExtraction({ images: [PNG] }, { provider: flaky, sink });
    expect(first.ok).toBe(false);
    if (first.ok) return;
    expect(first.error.message).toMatch(/temporarily unavailable/);
    expect(first.error.retryable).toBe(true);
    expect(first.uploadId).toBeDefined();
    const retry = await runExtraction({ uploadId: first.uploadId }, { provider: flaky, sink });
    expect(retry.ok).toBe(true);
  });

  it('reports an expired upload', async () => {
    const out = await runExtraction({ uploadId: 'nope' }, { provider: mock() });
    expect(!out.ok && out.status).toBe(410);
  });

  it('saves a corrected draft with original + corrected version and finds duplicates afterwards', async () => {
    const sink = new InMemoryRecipeSink();
    const out = await runExtraction({ images: [PNG, PNG] }, { provider: mock(), sink });
    if (!out.ok) throw new Error('extract failed');
    const edited = applyCorrections(out.draft, { servings: 6 });
    const saved = await saveImport({ uploadId: out.uploadId, draft: edited }, { sink });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const stored = await sink.get(saved.id);
    expect(stored?.recipe.servings).toBe(6);
    expect(stored?.version.original).toEqual(out.draft.original);
    expect(stored?.version.corrected.servings).toBe(6);
    expect(stored?.version.sourceImageRefs).toHaveLength(2);
    expect(getUpload(out.uploadId)).toBeUndefined();

    const again = await runExtraction({ images: [PNG] }, { provider: mock(), sink });
    expect(again.ok && again.existing.map((r) => r.id)).toContain(saved.id);
  });

  it('blocks saving when issues are blocking, recomputed server-side', async () => {
    const sink = new InMemoryRecipeSink();
    const out = await runExtraction({ images: [PNG] }, { provider: mock(), sink });
    if (!out.ok) throw new Error('extract failed');
    const edited = applyCorrections(out.draft, { title: '   ' });
    edited.issues = []; // a tampered client cannot clear blocking issues
    const saved = await saveImport({ uploadId: out.uploadId, draft: edited }, { sink });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.status).toBe(422);
    expect((await sink.list()).length).toBe(0);
  });

  it('rejects an invalid quantity in the draft', async () => {
    const sink = new InMemoryRecipeSink();
    const out = await runExtraction({ images: [PNG] }, { provider: mock(), sink });
    if (!out.ok) throw new Error('extract failed');
    const bad = structuredClone(out.draft);
    bad.ingredients[0]!.quantity.value = { kind: 'exact', originalText: 'x' }; // exact without value
    const saved = await saveImport({ uploadId: out.uploadId, draft: bad }, { sink });
    expect(!saved.ok && saved.status).toBe(400);
  });
});
