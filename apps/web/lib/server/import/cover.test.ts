import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiError, MockAiProvider, RecipeExtractionSchema, type AiProvider, type RecipeExtraction } from '@fr/ai';
import { InMemoryRecipeRepository } from '../../recipes/memory-repository';
import { DiskUploadFiles, UPLOAD_ID_RE } from '../uploads/dev-store';
import { runExtraction, saveImport } from './pipeline';
import { RepositoryRecipeSink } from './sink';

let dir: string;
let uploads: DiskUploadFiles;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fr-uploads-')); uploads = new DiskUploadFiles(dir); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

async function landscape(w = 400, h = 200, orientation?: number): Promise<Uint8Array> {
  let img = sharp({ create: { width: w, height: h, channels: 3, background: '#cc8844' } }).jpeg();
  if (orientation) img = img.withMetadata({ orientation });
  return new Uint8Array(await img.toBuffer());
}

const cardExtraction = (over: Record<string, unknown> = {}): RecipeExtraction => RecipeExtractionSchema.parse({
  title: 'Card Wraps',
  ingredients: [{ originalText: '1 onion', name: 'onion', quantity: { kind: 'exact', value: 1, unit: 'item', originalText: '1' }, confidence: 0.9 }],
  steps: ['Cook it.'],
  servings: 2,
  printedNutrition: { basis: 'per person', values: [{ nutrient: 'Calories', amount: 640, unit: 'kcal' }] },
  printedAllergens: ['A1: gluten'],
  sourcePublisher: 'Example Co',
  sourceReference: 'Bag 12',
  frontImageIndex: 2,
  frontImageRotation: 90,
  ...over,
});

const stub = (ex: RecipeExtraction | AiError): AiProvider => ({
  extractRecipe: async () => { if (ex instanceof AiError) throw ex; return ex; },
} as unknown as AiProvider);

const deps = (provider: AiProvider) => {
  const sink = new RepositoryRecipeSink(new InMemoryRecipeRepository());
  return { provider, sink, uploads };
};

describe('photo import: pages, cover image and printed data', () => {
  it('stores upright page photos, picks the AI front page as the draft cover, and previews them', async () => {
    const d = deps(stub(cardExtraction()));
    // page 1 is a landscape photo tagged "rotate 90" by the phone (EXIF), page 2 is the card front
    const out = await runExtraction({ images: [await landscape(400, 200, 6), await landscape()] }, d);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(UPLOAD_ID_RE.test(out.uploadId)).toBe(true);
    expect(out.draft.coverPage).toBe(2);
    expect(out.draft.coverRotation).toBe(90);
    expect(out.draft.printedNutrition).toMatchObject({ source: 'recipe card', calculated: false });
    const p1 = uploads.read(out.uploadId, 'page-1.jpg')!;
    const m = await sharp(p1).metadata();
    // EXIF auto-rotate applied before storing: portrait now
    expect([m.width, m.height]).toEqual([200, 400]);
    expect(uploads.read(out.uploadId, 'page-2.jpg')).toBeDefined();
    expect(uploads.read(out.uploadId, 'cover.jpg')).toBeUndefined(); // only written on save
  });

  it('defaults the cover to page 1 when the model did not say', async () => {
    const d = deps(stub(cardExtraction({ frontImageIndex: undefined, frontImageRotation: undefined })));
    const out = await runExtraction({ images: [await landscape()] }, d);
    expect(out.ok && out.draft.coverPage).toBe(1);
  });

  it('save writes a rotated cover.jpg, links it as the recipe image, and keeps printed data labelled', async () => {
    const d = deps(stub(cardExtraction()));
    const out = await runExtraction({ images: [await landscape(), await landscape(400, 200)] }, d);
    if (!out.ok) throw new Error('extract failed');
    const saved = await saveImport({ uploadId: out.uploadId, draft: out.draft }, d);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const cover = uploads.read(out.uploadId, 'cover.jpg')!;
    const m = await sharp(cover).metadata();
    expect([m.width, m.height]).toEqual([200, 400]); // landscape page 2 turned 90 degrees clockwise
    const r = await d.sink.get(saved.id);
    expect(r?.recipe.imageRef).toBe(`/api/uploads/${out.uploadId}/cover.jpg`);
    // the library recipe has the cover, printed nutrition and source
    const view = await new InMemoryRecipeRepositoryFromSink(d.sink).view(saved.id);
    expect(view?.imageUrl).toBe(`/api/uploads/${out.uploadId}/cover.jpg`);
    expect(view?.printedNutrition).toMatchObject({ basis: 'per person', source: 'recipe card' });
    expect(view?.printedAllergens).toEqual(['A1: gluten']);
    expect(view?.sourceAttribution).toBe('Example Co (Bag 12)');
    // saved folders are exempt from the unsaved sweep
    const old = Date.now() + 3 * 24 * 3600 * 1000;
    uploads.sweep(old);
    expect(uploads.read(out.uploadId, 'cover.jpg')).toBeDefined();
  });

  it('a user-chosen cover page is used unrotated; invalid choices fall back to the AI pick', async () => {
    const d = deps(stub(cardExtraction()));
    const out = await runExtraction({ images: [await landscape(), await landscape(300, 100)] }, d);
    if (!out.ok) throw new Error('extract failed');
    const chosen = { ...out.draft, coverPage: 1 };
    const s1 = await saveImport({ uploadId: out.uploadId, draft: chosen }, d);
    expect(s1.ok).toBe(true);
    const m = await sharp(uploads.read(out.uploadId, 'cover.jpg')!).metadata();
    expect([m.width, m.height]).toEqual([400, 200]); // page 1, no rotation

    const out2 = await runExtraction({ images: [await landscape(), await landscape(300, 100)] }, d);
    if (!out2.ok) throw new Error('extract failed');
    const s2 = await saveImport({ uploadId: out2.uploadId, draft: { ...out2.draft, coverPage: 9 } }, d);
    expect(s2.ok).toBe(true);
    const m2 = await sharp(uploads.read(out2.uploadId, 'cover.jpg')!).metadata();
    expect([m2.width, m2.height]).toEqual([100, 300]); // page 2 turned 90
  });

  it('printed nutrition / allergens come from the server copy, not the client draft', async () => {
    const d = deps(stub(cardExtraction()));
    const out = await runExtraction({ images: [await landscape(), await landscape()] }, d);
    if (!out.ok) throw new Error('extract failed');
    const tampered = structuredClone(out.draft);
    tampered.printedNutrition!.values[0]!.amount = 1;
    tampered.printedAllergens = ['none'];
    tampered.coverImageRef = '/etc/passwd';
    const saved = await saveImport({ uploadId: out.uploadId, draft: tampered }, d);
    if (!saved.ok) throw new Error('save failed');
    const r = await d.sink.get(saved.id);
    expect(r?.recipe.printedNutrition?.values[0]?.amount).toBe(640);
    expect(r?.recipe.printedAllergens).toEqual(['A1: gluten']);
    expect(r?.recipe.imageRef).toBe(`/api/uploads/${out.uploadId}/cover.jpg`);
  });

  it('phone-sized photos (large JPEG with EXIF) pass the size limits', async () => {
    const big = new Uint8Array(await sharp({ create: { width: 4000, height: 3000, channels: 3, background: '#88aa44' } }).jpeg({ quality: 92 }).withMetadata({ orientation: 6 }).toBuffer());
    const out = await runExtraction({ images: [big] }, deps(new MockAiProvider({ env: { NODE_ENV: 'test' } })));
    expect(out.ok).toBe(true);
  });
});

describe('provider errors keep the photos and point at Settings', () => {
  it.each([
    ['PROVIDER_AUTH', 502],
    ['MODEL_NOT_FOUND', 502],
    ['PROVIDER_UNREACHABLE', 503],
    ['PROVIDER_NOT_CONFIGURED', 412],
  ] as const)('%s -> status %i with uploadId kept for retry', async (code, status) => {
    const out = await runExtraction({ images: [await landscape()] }, deps(stub(new AiError(code))));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.status).toBe(status);
    expect(out.error.code).toBe(code);
    expect(out.error.message).toMatch(/Settings/);
    expect(out.uploadId).toBeDefined();
  });

  it('a mock in production (MOCK_FORBIDDEN) is reported as "no provider set up"', async () => {
    const out = await runExtraction({ images: [await landscape()] }, deps(stub(new AiError('MOCK_FORBIDDEN'))));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.error.code).toBe('PROVIDER_NOT_CONFIGURED');
    expect(out.error.message).toMatch(/Settings > AI provider/);
  });
});

describe('DiskUploadFiles', () => {
  it('only serves plain expected file names for valid ids (no path traversal)', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    uploads.writePages(id, [new Uint8Array([1, 2, 3])]);
    expect(uploads.read(id, 'page-1.jpg')).toBeDefined();
    for (const bad of ['../page-1.jpg', 'page-1.jpg/..', '..\\x', 'page-1.png', 'cover.jpg.bak', '.saved', 'app-secret', '']) {
      expect(uploads.read(id, bad), bad).toBeUndefined();
    }
    for (const badId of ['..', '../x', 'x', `${id}/..`, '11111111-2222-3333-4444-55555555555']) {
      expect(uploads.read(badId, 'page-1.jpg'), badId).toBeUndefined();
    }
    expect(() => uploads.writePages('../evil', [new Uint8Array([1])])).toThrow();
  });

  it('sweeps unsaved folders older than a day and keeps saved ones', () => {
    const a = '11111111-2222-3333-4444-555555555551';
    const b = '11111111-2222-3333-4444-555555555552';
    uploads.writePages(a, [new Uint8Array([1])]);
    uploads.writePages(b, [new Uint8Array([1])]);
    uploads.markSaved(b);
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    utimesSync(join(dir, a), old, old);
    utimesSync(join(dir, b), old, old);
    mkdirSync(join(dir, 'not-an-id'));
    writeFileSync(join(dir, 'not-an-id', 'x'), 'x');
    uploads.sweep();
    expect(existsSync(join(dir, a))).toBe(false);
    expect(existsSync(join(dir, b))).toBe(true);
    expect(existsSync(join(dir, 'not-an-id'))).toBe(true);
  });
});

/** Tiny helper: read the library view that the sink wrote (the sink is repository-backed). */
class InMemoryRecipeRepositoryFromSink {
  constructor(private readonly sink: RepositoryRecipeSink) {}
  async view(id: string) {
    // RepositoryRecipeSink keeps its repo private; reach through the instance for the assertion only.
    return (this.sink as unknown as { repo: InMemoryRecipeRepository }).repo.get(id);
  }
}
