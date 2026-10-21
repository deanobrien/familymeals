// The shared family cookbook (P3-A, D420-D424). One module, two callers: web server actions / the /s/<token> page and the bearer JSON
// routes under /api/shares (Android). Nothing here reads cookies or redirects; the caller says who is asking.
//
// What a share exposes is decided in ONE place on each backend (the whitelisted RPC `share_recipe_doc`, or the field-by-field
// mapping in the memory store): title, description, times, servings, cuisine, tags, ingredient lines, steps, the cover photo and the
// original source attribution. A saved copy is built from exactly that view, so private notes, ratings, favourites, cooking history
// and original page photos cannot reach the recipient by construction.
import 'server-only';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { getRecipeRepositoryFor } from '../../recipes/factory';
import { COLLECTIONS, type RecipeInput } from '../../recipes/schema';
import { formatQuantity } from '../../shopping/format';
import {
  SHARE_ERROR_MESSAGE, SHARE_MAX_DAYS, SHARE_MAX_RECIPES, SHARE_TOKEN_RE, sharePath,
  type CreatedShare, type ShareError, type SharePreview, type ShareResult, type ShareSummary, type SharedRecipeView,
} from '../../sharing/types';
import { LocalImageStore } from '../images/local-store';
import { SupabaseImageStore } from '../images/supabase-store';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { saveRecipe } from '../recipes/service';
import {
  CREATE_LIMIT, SAVE_LIMIT, allowed, limiterKey, lookupAllowed, noteLookup, record,
} from './rate-limit';
import {
  MemoryShareStore, ShareStoreError, SupabaseShareStore, type ShareReadResult, type ShareStore, type ShareViewer, type SharedRecipeDoc,
} from './store';

/** Who is asking, for writes: verified user + household and their own client (null in mock / memory mode). */
export interface ShareCaller {
  householdId: string;
  userId: string;
  displayName: string | null;
  client: SupabaseClient | null;
  readOnly: boolean;
}

/** Who is looking at a link: possibly signed out; `client` is the user's (or anon) client in Supabase mode, null in memory mode. */
export interface ShareViewerCtx extends ShareViewer {
  client: SupabaseClient | null;
}

export const storeFor = (client: SupabaseClient | null): ShareStore => (client ? new SupabaseShareStore(client) : new MemoryShareStore());

const err = (error: ShareError, fieldErrors?: Record<string, string>): { ok: false; error: ShareError; message: string; fieldErrors?: Record<string, string> } => ({
  ok: false, error, message: SHARE_ERROR_MESSAGE[error], ...(fieldErrors ? { fieldErrors } : {}),
});
const mapErr = (e: unknown) => err(e instanceof ShareStoreError ? e.code : 'unknown');

// ------------------------------------------------------------------------------------------------------------- create / list

const createSchema = z.object({
  scope: z.enum(['recipe', 'collection']),
  recipeIds: z.array(z.string().uuid()).max(SHARE_MAX_RECIPES).optional(),
  /** A named collection (favourites, quick ...): resolved on the server to the recipes in it right now. */
  collection: z.enum(COLLECTIONS).optional(),
  title: z.string().trim().max(80).optional(),
  expiresInDays: z.number().int().min(1).max(SHARE_MAX_DAYS).nullable().optional(),
  publicPreview: z.boolean().optional(),
});

const COLLECTION_LABEL: Record<string, string> = { favourites: 'Our favourites', quick: 'Quick meals', budget: 'Budget meals', vegetarian: 'Vegetarian meals' };

/** Make a link. The token comes back ONCE; only its hash is stored. */
export async function createShare(caller: ShareCaller, raw: unknown): Promise<ShareResult<{ share: CreatedShare }>> {
  if (caller.readOnly) return err('read_only');
  const parsed = createSchema.safeParse(raw);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join('.') || 'form'] ??= i.message;
    return err('invalid_input', fieldErrors);
  }
  const input = parsed.data;
  const rl = `create:${caller.userId}`;
  if (!allowed(rl, CREATE_LIMIT)) return err('rate_limited');
  let recipeIds = input.recipeIds ?? [];
  let title = input.title?.trim() || null;
  if (input.scope === 'collection' && input.collection && recipeIds.length === 0) {
    const page = await getRecipeRepositoryFor(caller.householdId).list({ q: '', tags: [], sort: 'name', page: 1, pageSize: SHARE_MAX_RECIPES, collection: input.collection });
    recipeIds = page.items.map((r) => r.id);
    title ??= COLLECTION_LABEL[input.collection] ?? 'Recipes';
  }
  if (input.scope === 'recipe' && recipeIds.length !== 1) return err('invalid_input', { recipeIds: 'Choose one recipe.' });
  if (input.scope === 'collection') {
    if (recipeIds.length === 0) return err('invalid_input', { recipeIds: 'There are no recipes in that collection yet.' });
    if (!title) return err('invalid_input', { title: 'Give the collection a name.' });
  }
  try {
    record(rl, CREATE_LIMIT);
    const made = await storeFor(caller.client).create({
      householdId: caller.householdId, userId: caller.userId, displayName: caller.displayName, scope: input.scope, title, recipeIds,
      ttlDays: input.expiresInDays ?? null, publicPreview: input.publicPreview === true,
    });
    return { ok: true, share: { id: made.id, token: made.token, path: sharePath(made.token), expiresAt: made.expiresAt } };
  } catch (e) {
    return mapErr(e);
  }
}

export async function listShares(caller: Pick<ShareCaller, 'householdId' | 'userId' | 'client'>): Promise<ShareResult<{ shares: ShareSummary[] }>> {
  try {
    return { ok: true, shares: await storeFor(caller.client).list(caller.householdId, caller.userId) };
  } catch (e) {
    return mapErr(e);
  }
}

export async function revokeShare(caller: ShareCaller, shareId: unknown): Promise<ShareResult> {
  if (caller.readOnly) return err('read_only');
  if (!z.string().uuid().safeParse(shareId).success) return err('not_found');
  try {
    // The same answer whether the share is not there or is not this household's.
    return (await storeFor(caller.client).revoke(caller.householdId, caller.userId, shareId as string)) ? { ok: true } : err('not_found');
  } catch (e) {
    return mapErr(e);
  }
}

// ------------------------------------------------------------------------------------------------------------------ preview


export function recipeViewOf(d: SharedRecipeDoc, token: string, canSeeImages: boolean): SharedRecipeView {
  return {
    id: d.id, title: d.title, description: d.description, sourceUrl: d.sourceUrl, sourceAttribution: d.sourceAttribution,
    prepMinutes: d.prepMinutes, cookMinutes: d.cookMinutes, servings: d.servings, cuisine: d.cuisine, tags: d.tags,
    ingredients: d.ingredients.map((i) => ({ text: [formatQuantity(i.quantity), i.name].filter(Boolean).join(' ') + (i.preparation ? `, ${i.preparation}` : ''), optional: i.optional })),
    steps: d.steps, imagePath: canSeeImages && d.hasCover ? `/api/shares/${token}/image/${d.id}` : null,
  };
}

const attributionOf = (sharedBy: string | null): string => (sharedBy ? `Shared by ${sharedBy}'s household` : 'Shared by another household');

export function previewOf(read: ShareReadResult, token: string): SharePreview {
  if (read.minimal) return { kind: 'minimal', scope: read.scope, title: read.title, sharedBy: read.sharedBy, recipeCount: read.recipeCount };
  return {
    kind: 'full', scope: read.scope, title: read.title, attribution: attributionOf(read.sharedBy), expiresAt: read.expiresAt, signedIn: read.signedIn, own: read.own,
    // Photos need the viewer to be signed in (Storage is private); a public preview is text only.
    recipes: read.recipes.map((r) => recipeViewOf(r, token, read.signedIn)),
  };
}

/**
 * Look at a link. Unknown, expired, revoked and malformed tokens all give `{ kind: 'invalid' }` (one outcome: nothing to probe).
 * `req` (when there is one) keys the rate limiter for signed-out visitors by address.
 */
export async function previewShare(viewer: ShareViewerCtx, token: unknown, req: { headers: { get(name: string): string | null } } | null = null): Promise<ShareResult<{ preview: SharePreview }>> {
  const key = limiterKey(req, viewer.userId);
  if (!lookupAllowed(key)) return err('rate_limited');
  if (typeof token !== 'string' || !SHARE_TOKEN_RE.test(token)) {
    noteLookup(key, false);
    return { ok: true, preview: { kind: 'invalid' } };
  }
  try {
    const read = await storeFor(viewer.client).read(token, viewer);
    noteLookup(key, read !== null);
    return { ok: true, preview: read ? previewOf(read, token) : { kind: 'invalid' } };
  } catch (e) {
    noteLookup(key, false);
    return mapErr(e);
  }
}

// ------------------------------------------------------------------------------------------------------------------- images

const SIGNED_SECONDS = 120;
const COVER_BUCKET = 'recipe-images';

/** A short-lived URL for one recipe's cover INSIDE a live share the viewer opened. null = no such image (never says why). */
export async function shareImageUrl(viewer: ShareViewerCtx, token: unknown, recipeId: unknown, req: { headers: { get(name: string): string | null } } | null = null): Promise<string | null> {
  if (viewer.userId === null) return null;
  const key = limiterKey(req, viewer.userId);
  if (!lookupAllowed(key)) return null;
  if (typeof token !== 'string' || !SHARE_TOKEN_RE.test(token) || !z.string().uuid().safeParse(recipeId).success) {
    noteLookup(key, false);
    return null;
  }
  try {
    const ref = await storeFor(viewer.client).coverRef(token, recipeId as string, viewer);
    noteLookup(key, ref !== null);
    if (!ref) return null;
    if (!viewer.client) return ref.startsWith('/') || /^https:\/\//i.test(ref) ? ref : null;
    const { data, error } = await viewer.client.storage.from(COVER_BUCKET).createSignedUrl(ref, SIGNED_SECONDS);
    return error || !data ? null : data.signedUrl;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------------------------- copy

/** A copy of a shared recipe as a recipe input of the RECIPIENT's household (no notes, ratings or history exist in the view). */
export function copyInputFor(d: SharedRecipeDoc, sharedBy: string | null): RecipeInput {
  const own = d.sourceAttribution.trim();
  const sharer = sharedBy ? `Shared by ${sharedBy}'s household` : 'Shared by another household';
  return {
    title: d.title.slice(0, 160),
    description: d.description.slice(0, 2000),
    imageUrl: null,
    sourceAttribution: (own ? `${sharer}. Originally: ${own}` : sharer).slice(0, 200),
    sourceUrl: d.sourceUrl,
    originalText: '',
    prepMinutes: d.prepMinutes,
    cookMinutes: d.cookMinutes,
    servings: d.servings,
    cuisine: d.cuisine,
    mealType: d.mealType,
    diet: d.diet,
    tags: d.tags.map((t) => t.slice(0, 40)).slice(0, 30),
    ingredients: d.ingredients.map((i) => ({
      name: i.name.slice(0, 120), ingredientId: i.ingredientId, quantity: i.quantity as RecipeInput['ingredients'][number]['quantity'], preparation: i.preparation, optional: i.optional,
    })),
    steps: d.steps.length ? d.steps.map((s) => s.slice(0, 2000)) : ['See the ingredients.'],
  };
}

/** Copy the sharer's cover into the recipient's own storage. Best effort: a recipe without its photo is better than no recipe. */
async function copyCover(caller: ShareCaller, token: string, doc: SharedRecipeDoc): Promise<string | null> {
  if (!doc.hasCover) return null;
  const viewer: ShareViewer = { userId: caller.userId, householdId: caller.householdId };
  try {
    const ref = await storeFor(caller.client).coverRef(token, doc.id, viewer);
    if (!ref) return null;
    const id = randomUUID();
    if (caller.client) {
      const { data, error } = await caller.client.storage.from(COVER_BUCKET).download(ref);
      if (error || !data) return null;
      return await new SupabaseImageStore(caller.client, caller.householdId).put('cover', id, 'cover.jpg', new Uint8Array(await data.arrayBuffer()));
    }
    const local = /^\/api\/uploads\/([0-9a-f-]{36})\/(cover\.jpg)$/i.exec(ref);
    if (local) {
      const store = new LocalImageStore();
      const bytes = await store.get('cover', local[1]!, local[2]!);
      return bytes ? await store.put('cover', id, 'cover.jpg', bytes) : null;
    }
    return /^https:\/\//i.test(ref) ? ref : null; // an external photo URL is referenced, not downloaded
  } catch (e) {
    console.warn('[sharing] could not copy the cover image:', e instanceof Error ? e.name : 'unknown');
    return null;
  }
}

/**
 * "Save a copy to my household": the recipient's own recipe, built from the share view only, with the cover copied into their
 * storage and the sharer credited in the source attribution. Not available for a household's own link.
 */
export async function saveShareCopy(caller: ShareCaller, token: unknown, recipeId: unknown, req: { headers: { get(name: string): string | null } } | null = null): Promise<ShareResult<{ recipeId: string; title: string; imageCopied: boolean }>> {
  if (caller.readOnly) return err('read_only');
  const key = limiterKey(req, caller.userId);
  if (!lookupAllowed(key) || !allowed(`save:${caller.userId}`, SAVE_LIMIT)) return err('rate_limited');
  if (typeof token !== 'string' || !SHARE_TOKEN_RE.test(token) || !z.string().uuid().safeParse(recipeId).success) {
    noteLookup(key, false);
    return err('not_found');
  }
  const viewer: ShareViewer = { userId: caller.userId, householdId: caller.householdId };
  const store = storeFor(caller.client);
  let read: ShareReadResult | null;
  try {
    read = await store.read(token, viewer);
  } catch (e) {
    return mapErr(e);
  }
  noteLookup(key, read !== null);
  if (!read || read.minimal) return err('not_found');
  if (read.own) return err('own_share');
  const doc = read.recipes.find((r) => r.id === recipeId);
  if (!doc) return err('not_found');
  record(`save:${caller.userId}`, SAVE_LIMIT);

  const input = copyInputFor(doc, read.sharedBy);
  const cover = await copyCover(caller, token, doc);
  const saved = await saveRecipe(getRecipeRepositoryFor(caller.householdId), getIngredientCatalogue(), null, { ...input, imageUrl: cover }, true);
  if (!saved.ok) return err('invalid_input', saved.fieldErrors);
  try {
    await store.recordSave(token, doc.id, saved.id, viewer);
  } catch {
    /* the copy exists; only the "saved N times" count is missing */
  }
  return { ok: true, recipeId: saved.id, title: input.title, imageCopied: cover !== null };
}

