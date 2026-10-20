// Recipe from a web link (P1-B, D370-D374). One shared server module behind POST /api/import/url (web and Android):
//   user URL -> SSRF-guarded single-page fetch -> schema.org Recipe (JSON-LD / microdata) -> else AI reading of the page text
//   -> the SAME RecipeDraft the photo import produces -> review -> /api/extract/save with source URL + attribution.
// Personal household copy only: one page per request, the source link stays prominent, no bulk fetching.
import 'server-only';
import { prepareImages, type AiProvider } from '@fr/ai';
import {
  buildDraft, extractStructuredRecipe, pageMeta, parseHtml, structuredToExtraction, visibleText,
  type RecipeDraft, type RecipeExtraction, type RecipeSummary,
} from '@fr/recipe-import';
import { dietTags, inferDiet } from '@fr/recipe-sources';
import { getAiProvider, describeActiveProvider } from '../../ai/provider';
import { getIngredientCatalogue } from '../../refdata/catalogue';
import { LocalImageStore } from '../../images/local-store';
import type { ImageStore } from '../../images/store';
import { ingredientMatcher, ingredientParser } from '../engine-adapter';
import { toError, type PipelineError } from '../pipeline';
import { getRecipeSink, type RecipeSink } from '../sink';
import { putUpload, type UploadOwner } from '../upload-store';
import { FetchError, UrlRejectedError, decodeHtml, guardedGet, type FetchOptions } from './fetch-page';
import { allowUrlImport } from './rate-limit';
import { parseImportUrl } from './ssrf';

export interface UrlImportDeps {
  /** Test seams: DNS lookup / transport / limits for the guarded fetch. */
  fetch?: FetchOptions;
  provider?: AiProvider;
  sink?: RecipeSink;
  images?: ImageStore;
}

export interface ProviderInfo { label: string; isMock: boolean; configured: boolean }

export type UrlImportOutcome =
  | {
    ok: true; uploadId: string; draft: RecipeDraft; existing: RecipeSummary[];
    /** How the recipe was read: the page's own recipe data, or an AI reading of the page text (reviewer is told). */
    via: 'structured' | 'ai';
    sourceUrl: string;
    provider?: ProviderInfo;
  }
  | { ok: false; status: number; error: PipelineError };

const fail = (status: number, code: string, message: string, retryable = false): UrlImportOutcome => ({ ok: false, status, error: { code, message, retryable } });

/** The words that carry a diet into the library: stripped from page keywords, then replaced by our own conservative label. */
const DIET_WORDS = new Set(['vegan', 'vegetarian', 'veggie', 'fish', 'seafood', 'pescatarian', 'diet-unverified']);

const TRACKING = /^(?:utm_[a-z]+|fbclid|gclid|mc_cid|mc_eid|igshid|ref|ref_src|source|share|cmp|ocid)$/i;

/** The page address kept with the recipe: fragment and tracking parameters removed, 500 characters at most. */
export function cleanSourceUrl(finalUrl: string): string {
  const u = new URL(finalUrl);
  u.hash = '';
  for (const k of [...u.searchParams.keys()]) if (TRACKING.test(k)) u.searchParams.delete(k);
  const s = u.toString();
  if (s.length <= 500) return s;
  u.search = '';
  return u.toString().slice(0, 500);
}

const siteFromHost = (host: string): string => host.replace(/^www\./, '');

function messageForFetch(e: FetchError): UrlImportOutcome {
  if (e.code === 'HTTP_STATUS') {
    const s = e.status ?? 0;
    if (s === 404 || s === 410) return fail(422, 'PAGE_NOT_FOUND', 'That page was not found. Check the address and try again.');
    if (s === 401 || s === 403 || s === 429 || s === 451) {
      return fail(422, 'SITE_REFUSED', 'That site would not let us read the page. Try importing from a photo or screenshot instead, or copy the recipe in by hand.');
    }
    return fail(502, 'SITE_ERROR', 'That site had a problem. Please try again later.', true);
  }
  switch (e.code) {
    case 'TIMEOUT': return fail(504, 'SITE_TIMEOUT', 'That site took too long to answer. Please try again.', true);
    case 'TOO_LARGE': return fail(413, 'PAGE_TOO_LARGE', 'That page is too large to read.');
    case 'NOT_HTML': return fail(422, 'NOT_A_WEB_PAGE', 'That address is not a web page (it may be a file or a download).');
    case 'TOO_MANY_REDIRECTS': case 'BAD_REDIRECT': return fail(422, 'REDIRECT_PROBLEM', 'That address kept redirecting. Try opening it in your browser and sharing the final address.');
    default: return fail(502, 'SITE_UNREACHABLE', 'That site could not be reached. Check the address and try again.', true);
  }
}

/** Best-effort download of the page's own picture as the cover (the CSP does not allow hotlinking other sites). */
async function fetchCover(imageUrl: string | undefined, opts: FetchOptions): Promise<Uint8Array | undefined> {
  if (!imageUrl) return undefined;
  try {
    const got = await guardedGet(imageUrl, { ...opts, expect: 'image', maxBytes: 6 * 1024 * 1024, timeoutMs: 8000, maxRedirects: 2 });
    const [prepared] = await prepareImages([got.bytes]);
    return prepared?.data;
  } catch {
    return undefined; // no cover is fine: the recipe is saved without a picture
  }
}

export async function startUrlImport(input: { url: string; owner: UploadOwner }, deps: UrlImportDeps = {}): Promise<UrlImportOutcome> {
  const sink = deps.sink ?? getRecipeSink();

  let parsed;
  try {
    parsed = parseImportUrl(input.url);
  } catch (e) {
    if (e instanceof UrlRejectedError) return fail(400, e.code, e.message);
    throw e;
  }
  if (!allowUrlImport(input.owner.householdId, parsed.host)) {
    return fail(429, 'RATE_LIMITED', 'That is a lot of web links in a short time. Please wait a while, then try again.', true);
  }

  let page;
  try {
    page = await guardedGet(parsed.url.toString(), deps.fetch);
  } catch (e) {
    if (e instanceof UrlRejectedError) return fail(400, e.code, e.message);
    if (e instanceof FetchError) return messageForFetch(e);
    console.error('[import-url] unexpected fetch error', e instanceof Error ? e.name : 'unknown');
    return fail(502, 'SITE_UNREACHABLE', 'That site could not be reached. Check the address and try again.', true);
  }

  const finalUrl = page.finalUrl;
  const finalHost = new URL(finalUrl).hostname.replace(/^\[|\]$/g, '');
  const root = parseHtml(decodeHtml(page.bytes, page.contentType));
  const meta = pageMeta(root, finalUrl);
  const sr = extractStructuredRecipe(root, finalUrl);
  const publisher = (sr?.publisher ?? meta.siteName ?? siteFromHost(finalHost)).slice(0, 120);
  const sourceUrl = cleanSourceUrl(finalUrl);

  let extraction: RecipeExtraction;
  let via: 'structured' | 'ai';
  let provider: ProviderInfo | undefined;
  if (sr) {
    via = 'structured';
    extraction = structuredToExtraction(sr, ingredientParser, { publisher, sourceUrl });
  } else {
    via = 'ai';
    const text = visibleText(root);
    if (text.length < 200) return fail(422, 'NO_RECIPE_FOUND', 'We could not find a recipe on that page. Try the page for the recipe itself, or import from a photo.');
    try {
      const ai = deps.provider ?? (await getAiProvider());
      const info = deps.provider ? undefined : await describeActiveProvider();
      if (info) provider = { label: info.label, isMock: info.isMock, configured: info.configured };
      extraction = await ai.extractRecipeFromText(text, meta.title, { householdId: input.owner.householdId });
    } catch (e) {
      return { ok: false, ...toError(e) };
    }
    extraction.warnings = [
      'This page has no recipe data we can read directly, so the recipe was read from its text by AI. Check every ingredient, amount and step against the page (open the link) before saving.',
      ...extraction.warnings,
    ];
    extraction.sourcePublisher = publisher;
    extraction.sourceReference = sourceUrl;
  }

  // Dietary label: ours, from the ingredient lines, always unverified. Whatever the page or the AI claimed is dropped.
  const cat = getIngredientCatalogue();
  const diet = inferDiet(
    { title: extraction.title, ingredients: extraction.ingredients.map((i) => ({ name: i.name, measure: '' })) },
    (name) => { const m = cat.matcher.match(name); return m.status === 'matched' && m.ingredientId ? cat.get(m.ingredientId)?.category : undefined; },
  );
  extraction.tags = [...new Set([...extraction.tags.filter((t) => !DIET_WORDS.has(t.toLowerCase())), ...dietTags(diet)])].slice(0, 30);
  extraction.warnings.push(`Dietary label is worked out from the ingredient list and is not verified: ${diet.reason}.`);

  // Cover picture, downloaded through the same guard and kept as the upload's single "page".
  const cover = await fetchCover(sr?.imageUrl ?? meta.imageUrl, deps.fetch ?? {});
  const rec = putUpload(cover ? [cover] : [], undefined, input.owner);
  const refs: string[] = [];
  if (cover) {
    try {
      const store = deps.images ?? new LocalImageStore();
      await store.sweep();
      await store.put('page', rec.id, 'page-1.jpg', cover);
      refs.push(`import-uploads/${rec.id}/page-1`);
    } catch (err) {
      console.error('[import-url] could not store cover', err instanceof Error ? err.message : err);
      rec.images = [];
    }
  }

  const attribution = sr?.author && sr.author.toLowerCase() !== publisher.toLowerCase() ? `${sr.author} on ${publisher}` : publisher;
  const draft = buildDraft(extraction, { parser: ingredientParser, matcher: ingredientMatcher }, { source: attribution, sourceImageRefs: refs });
  if (refs.length) draft.coverPage = 1;
  rec.draft = draft;
  return { ok: true, uploadId: rec.id, draft, existing: await sink.list(), via, sourceUrl, ...(provider ? { provider } : {}) };
}
