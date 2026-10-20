import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { RecipeExtractionSchema, type AiProvider } from '@fr/ai';
import { InMemoryRecipeRepository } from '../../recipes/memory-repository';
import { fakeStorage } from '../images/fake-storage';
import { parseImagePath } from '../images/paths';
import { SupabaseImageStore } from '../images/supabase-store';
import { runExtraction, saveImport } from './pipeline';
import { RepositoryRecipeSink } from './sink';

const HH = 'aa000000-0000-4000-8000-0000000000aa';
const owner = { userId: 'u1', householdId: HH };

const jpeg = async (w = 300, h = 200) =>
  new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: '#88aa44' } }).jpeg().toBuffer());

const provider = {
  extractRecipe: async () => RecipeExtractionSchema.parse({
    title: 'Stored Soup',
    ingredients: [{ originalText: '1 onion', name: 'onion', quantity: { kind: 'exact', value: 1, unit: 'item', originalText: '1' }, confidence: 0.9 }],
    steps: ['Cook it.'],
    servings: 2,
  }),
} as unknown as AiProvider;

describe('photo import with the Supabase image store (D190)', () => {
  it('stores pages under the household folder, saves the cover as a storage path, then drops the temporary pages', async () => {
    const fake = fakeStorage();
    const images = new SupabaseImageStore(fake, HH);
    const repo = new InMemoryRecipeRepository();
    const sink = new RepositoryRecipeSink(repo);
    const out = await runExtraction({ images: [await jpeg(), await jpeg()], owner }, { provider, sink, images });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const pages = [...fake.objects.keys()].sort();
    expect(pages).toEqual([
      `recipe-images/${HH}/page/${out.uploadId}/page-1.jpg`,
      `recipe-images/${HH}/page/${out.uploadId}/page-2.jpg`,
    ]);

    const saved = await saveImport({ uploadId: out.uploadId, draft: out.draft, owner }, { sink, images });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    const coverPath = `${HH}/cover/${out.uploadId}/cover.jpg`;
    // the recipe stores the storage PATH (never a URL); it is rendered through the signed-URL route
    expect((await repo.get(saved.id))?.imageUrl).toBe(coverPath);
    expect(parseImagePath(coverPath)).not.toBeNull();
    // only the cover remains; page photos were temporary
    expect([...fake.objects.keys()]).toEqual([`recipe-images/${HH}/cover/${out.uploadId}/cover.jpg`]);
    const meta = await sharp(fake.objects.get(`recipe-images/${coverPath}`)!).metadata();
    expect(meta.format).toBe('jpeg');
  });

  it('still saves (cover from the in-memory copy) when the page upload to storage failed', async () => {
    const fake = fakeStorage();
    fake.failNextUpload = 'storage unavailable';
    const images = new SupabaseImageStore(fake, HH);
    const repo = new InMemoryRecipeRepository();
    const sink = new RepositoryRecipeSink(repo);
    const out = await runExtraction({ images: [await jpeg()], owner }, { provider, sink, images });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const saved = await saveImport({ uploadId: out.uploadId, draft: out.draft, owner }, { sink, images });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect((await repo.get(saved.id))?.imageUrl).toBe(`${HH}/cover/${out.uploadId}/cover.jpg`);
  });
});
