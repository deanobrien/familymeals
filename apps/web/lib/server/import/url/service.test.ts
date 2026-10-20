import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockAiProvider, type AiProvider } from '@fr/ai';
import { InMemoryRecipeRepository } from '../../../recipes/memory-repository';
import { LocalImageStore } from '../../images/local-store';
import { DiskUploadFiles } from '../../uploads/dev-store';
import { saveImport } from '../pipeline';
import { RepositoryRecipeSink } from '../sink';
import { FetchError, type Transport } from './fetch-page';
import { MAX_PER_SITE, resetUrlImportLimits } from './rate-limit';
import { cleanSourceUrl, startUrlImport } from './service';
import type { LookupFn } from './ssrf';

const OWNER = { userId: 'u1', householdId: 'h1' };

const BLOG = `<html><head><title>Lentil Dahl</title><meta property="og:site_name" content="Example Kitchen">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Recipe","name":"Lentil Dahl",
"author":{"@type":"Person","name":"Sam Example"},"image":"https://img.example-kitchen.test/dahl.jpg","recipeYield":"4 servings",
"keywords":"vegan, dinner","prepTime":"PT10M","cookTime":"PT25M",
"recipeIngredient":["250g red lentils","1 onion, chopped","400ml tin coconut milk","salt"],
"recipeInstructions":[{"@type":"HowToStep","text":"Fry the onion."},{"@type":"HowToStep","text":"Add lentils and milk, simmer 25 minutes."}]}</script>
</head><body><main>Dahl</main></body></html>`;

const PLAIN = `<html><head><title>Gran Pudding</title></head><body><main><h1>Gran's rice pudding</h1><p>${'Pudding rice and milk, baked slowly. '.repeat(10)}</p>
<ul><li>100g pudding rice</li><li>1 litre milk</li></ul><ol><li>Bake for two hours.</li></ol></main></body></html>`;

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fr-urlimport-')); resetUrlImportLimits(); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const lookup: LookupFn = async () => [{ address: '93.184.216.34', family: 4 }];

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 320, height: 200, channels: 3, background: '#33aa66' } }).jpeg().toBuffer();
}

interface Page { status?: number; type?: string; body: string | Buffer }
function transportFor(pages: Record<string, Page>): { transport: Transport; urls: string[] } {
  const urls: string[] = [];
  const transport: Transport = async ({ url }) => {
    urls.push(url.toString());
    const p = pages[url.toString()];
    if (!p) throw new FetchError('NETWORK', 'no route');
    return { status: p.status ?? 200, headers: { 'content-type': p.type ?? 'text/html; charset=utf-8' }, body: Readable.from([Buffer.from(p.body)]) };
  };
  return { transport, urls };
}

function deps(pages: Record<string, Page>, provider?: AiProvider) {
  const repo = new InMemoryRecipeRepository();
  const sink = new RepositoryRecipeSink(repo);
  const t = transportFor(pages);
  return {
    repo, t,
    d: {
      fetch: { lookup, transport: t.transport },
      sink,
      images: new LocalImageStore(new DiskUploadFiles(dir)),
      provider: provider ?? new MockAiProvider({ env: { NODE_ENV: 'test' } }),
    },
  };
}

describe('startUrlImport: structured data first', () => {
  it('builds a draft from JSON-LD with attribution, a downloaded cover and an unverified diet label', async () => {
    const { d, t } = deps({
      'https://www.example-kitchen.test/dahl?utm_source=news': { body: BLOG },
      'https://img.example-kitchen.test/dahl.jpg': { type: 'image/jpeg', body: await jpeg() },
    });
    const out = await startUrlImport({ url: 'https://www.example-kitchen.test/dahl?utm_source=news#x', owner: OWNER }, d);
    if (!out.ok) throw new Error(out.error.message);
    expect(out.via).toBe('structured');
    expect(out.sourceUrl).toBe('https://www.example-kitchen.test/dahl');
    expect(out.draft.title.value).toBe('Lentil Dahl');
    expect(out.draft.servings.value).toBe(4);
    expect(out.draft.source).toBe('Sam Example on Example Kitchen');
    expect(out.draft.sourcePublisher).toBe('Example Kitchen');
    expect(out.draft.sourceReference).toBe('https://www.example-kitchen.test/dahl');
    expect(out.draft.ingredients).toHaveLength(4);
    expect(out.draft.coverPage).toBe(1);
    expect(out.draft.sourceImageRefs).toHaveLength(1);
    // the page's own "vegan" keyword is NOT trusted: our label comes from the ingredients, and is marked unverified
    expect(out.draft.tags).toContain('diet-unverified');
    expect(out.draft.warnings?.join(' ') ?? JSON.stringify(out.draft)).toMatch(/not verified/i);
    // one page + its picture: two fetches, nothing else (no crawling)
    expect(t.urls).toHaveLength(2);
  });

  it('saves through the normal save route with the source link and the page picture as the cover', async () => {
    const { d, repo } = deps({
      'https://www.example-kitchen.test/dahl': { body: BLOG },
      'https://img.example-kitchen.test/dahl.jpg': { type: 'image/jpeg', body: await jpeg() },
    });
    const out = await startUrlImport({ url: 'https://www.example-kitchen.test/dahl', owner: OWNER }, d);
    if (!out.ok) throw new Error(out.error.message);
    // a hostile client tries to rewrite the provenance: the server copy wins for publisher/reference
    const client = structuredClone(out.draft); // over the wire the client holds its own copy
    client.sourceReference = 'https://evil.test/';
    client.sourcePublisher = 'Evil';
    const saved = await saveImport({ uploadId: out.uploadId, draft: client, owner: OWNER }, d);
    if (!saved.ok) throw new Error(JSON.stringify(saved));
    const recipe = await repo.get(saved.id);
    expect(recipe?.sourceUrl).toBe('https://www.example-kitchen.test/dahl');
    expect(recipe?.sourceAttribution).toBe('Sam Example on Example Kitchen');
    expect(recipe?.imageUrl).toBeTruthy();
    expect(recipe?.originalText).toContain('250g red lentils');
  });

  it('still works when the picture cannot be fetched (no cover)', async () => {
    const { d } = deps({ 'https://www.example-kitchen.test/dahl': { body: BLOG } });
    const out = await startUrlImport({ url: 'https://www.example-kitchen.test/dahl', owner: OWNER }, d);
    if (!out.ok) throw new Error(out.error.message);
    expect(out.draft.coverPage).toBeUndefined();
    expect(out.draft.sourceImageRefs).toEqual([]);
  });

  it('ignores a "picture" that is not an image', async () => {
    const { d } = deps({
      'https://www.example-kitchen.test/dahl': { body: BLOG },
      'https://img.example-kitchen.test/dahl.jpg': { type: 'text/html', body: '<html>not an image</html>' },
    });
    const out = await startUrlImport({ url: 'https://www.example-kitchen.test/dahl', owner: OWNER }, d);
    expect(out.ok && out.draft.sourceImageRefs).toEqual([]);
  });
});

describe('startUrlImport: AI fallback', () => {
  it('reads the page text with the AI only when there is no recipe data, and says so', async () => {
    let seen = '';
    const ai = {
      extractRecipeFromText: async (text: string) => {
        seen = text;
        return new MockAiProvider({ env: { NODE_ENV: 'test' } }).extractRecipeFromText(text, 'Gran pudding');
      },
    } as unknown as AiProvider;
    const { d } = deps({ 'https://gran.test/pudding': { body: PLAIN } }, ai);
    const out = await startUrlImport({ url: 'https://gran.test/pudding', owner: OWNER }, d);
    if (!out.ok) throw new Error(out.error.message);
    expect(out.via).toBe('ai');
    expect(seen).toContain('100g pudding rice');
    expect(out.draft.sourceReference).toBe('https://gran.test/pudding');
    expect(out.draft.sourcePublisher).toBe('gran.test');
    expect(JSON.stringify(out.draft)).toMatch(/read from its text by AI/);
  });

  it('does not call the AI when structured data is present', async () => {
    const ai = { extractRecipeFromText: async () => { throw new Error('must not be called'); } } as unknown as AiProvider;
    const { d } = deps({ 'https://www.example-kitchen.test/dahl': { body: BLOG } }, ai);
    expect((await startUrlImport({ url: 'https://www.example-kitchen.test/dahl', owner: OWNER }, d)).ok).toBe(true);
  });

  it('reports "no recipe found" for a page with almost no text, without calling the AI', async () => {
    const ai = { extractRecipeFromText: async () => { throw new Error('must not be called'); } } as unknown as AiProvider;
    const { d } = deps({ 'https://x.test/': { body: '<html><body><main>Hi</main></body></html>' } }, ai);
    const out = await startUrlImport({ url: 'https://x.test/', owner: OWNER }, d);
    expect(out).toMatchObject({ ok: false, status: 422, error: { code: 'NO_RECIPE_FOUND' } });
  });
});

describe('startUrlImport: refusals and errors', () => {
  it('refuses private, internal and non-web addresses before any request', async () => {
    const { d, t } = deps({});
    for (const url of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data/', 'http://localhost:8080/', 'file:///etc/passwd', 'http://[::1]/', 'ftp://example.com/x']) {
      const out = await startUrlImport({ url, owner: OWNER }, d);
      expect(out).toMatchObject({ ok: false, status: 400 });
    }
    expect(t.urls).toHaveLength(0);
  });

  it('refuses a name that resolves to a private address', async () => {
    const { d, t } = deps({});
    d.fetch.lookup = async () => [{ address: '10.0.0.7', family: 4 }];
    const out = await startUrlImport({ url: 'https://sneaky.test/', owner: OWNER }, d);
    expect(out).toMatchObject({ ok: false, status: 400, error: { code: 'BLOCKED_ADDRESS' } });
    expect(t.urls).toHaveLength(0);
  });

  it('refuses a redirect into the internal network', async () => {
    const { d } = deps({ 'https://short.test/a': { status: 302, body: '' } });
    const base = d.fetch.transport;
    d.fetch.transport = async (req) => {
      const r = await base(req);
      return { ...r, headers: { ...r.headers, location: 'http://169.254.169.254/latest/meta-data/' } };
    };
    const out = await startUrlImport({ url: 'https://short.test/a', owner: OWNER }, d);
    expect(out).toMatchObject({ ok: false, status: 400, error: { code: 'BLOCKED_ADDRESS' } });
  });

  it.each([
    [404, 422, 'PAGE_NOT_FOUND'],
    [403, 422, 'SITE_REFUSED'],
    [429, 422, 'SITE_REFUSED'],
    [500, 502, 'SITE_ERROR'],
  ])('maps HTTP %i to %i %s', async (status, httpStatus, code) => {
    const { d } = deps({ 'https://x.test/': { status, body: 'nope' } });
    const out = await startUrlImport({ url: 'https://x.test/', owner: OWNER }, d);
    expect(out).toMatchObject({ ok: false, status: httpStatus, error: { code } });
  });

  it('rejects a PDF / download', async () => {
    const { d } = deps({ 'https://x.test/a.pdf': { type: 'application/pdf', body: '%PDF' } });
    expect(await startUrlImport({ url: 'https://x.test/a.pdf', owner: OWNER }, d)).toMatchObject({ ok: false, error: { code: 'NOT_A_WEB_PAGE' } });
  });

  it('limits how many pages one household can pull from one site per hour', async () => {
    const { d } = deps({ 'https://www.example-kitchen.test/dahl': { body: BLOG } });
    for (let i = 0; i < MAX_PER_SITE; i++) expect((await startUrlImport({ url: 'https://www.example-kitchen.test/dahl', owner: OWNER }, d)).ok).toBe(true);
    expect(await startUrlImport({ url: 'https://www.example-kitchen.test/dahl', owner: OWNER }, d)).toMatchObject({ ok: false, status: 429, error: { code: 'RATE_LIMITED' } });
    // another household is unaffected
    expect((await startUrlImport({ url: 'https://www.example-kitchen.test/dahl', owner: { userId: 'u2', householdId: 'h2' } }, d)).ok).toBe(true);
  });
});

describe('cleanSourceUrl', () => {
  it('drops tracking parameters and fragments, keeps real ones', () => {
    expect(cleanSourceUrl('https://a.test/r?id=7&utm_source=x&fbclid=1#top')).toBe('https://a.test/r?id=7');
    expect(cleanSourceUrl(`https://a.test/r?${'q=1&'.repeat(200)}`).length).toBeLessThanOrEqual(500);
  });
});
