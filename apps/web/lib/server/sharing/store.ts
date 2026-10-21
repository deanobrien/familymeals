// Storage for shared-cookbook links (P3-A, D420-D424). Supabase: the SECURITY DEFINER RPCs of migration 20261021003000 (a token is
// the only way into another household's recipes; the client is the CALLER's own, or the anon client for a signed-out visitor).
// Memory: an in-process demo store with the same rules (hash-only tokens, one generic "not available", private data never copied).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Quantity } from '../../recipes/types';
import type { DietCategory, MealType } from '../../recipes/types';
import { getRecipeRepositoryFor } from '../../recipes/factory';
import { SHARE_MAX_RECIPES, type ShareScope, type ShareStatus, type ShareSummary } from '../../sharing/types';
import { safeQuantity } from '../supabase/recipe-mapper';

export class ShareStoreError extends Error {
  constructor(readonly code: 'forbidden' | 'invalid_input' | 'not_found' | 'unknown') {
    super(code);
    this.name = 'ShareStoreError';
  }
}

/** One recipe as the share exposes it (internal: keeps the catalogue ids the copy needs; never sent to a browser as-is). */
export interface SharedRecipeDoc {
  id: string;
  title: string;
  description: string;
  sourceUrl: string;
  sourceAttribution: string;
  prepMinutes: number | null;
  cookMinutes: number | null;
  servings: number;
  cuisine: string;
  mealType: MealType;
  diet: DietCategory;
  tags: string[];
  hasCover: boolean;
  ingredients: Array<{ name: string; ingredientId: string | null; quantity: Quantity; preparation: string | undefined; optional: boolean }>;
  steps: string[];
}

export type ShareReadResult =
  | { minimal: true; scope: ShareScope; title: string | null; sharedBy: string | null; recipeCount: number }
  | { minimal: false; scope: ShareScope; title: string | null; sharedBy: string | null; recipeCount: number; expiresAt: string | null; recipes: SharedRecipeDoc[]; signedIn: boolean; own: boolean };

export interface ShareViewer {
  /** null = signed out. */
  userId: string | null;
  householdId: string | null;
}

export interface CreateShareRow {
  householdId: string;
  userId: string;
  displayName: string | null;
  scope: ShareScope;
  title: string | null;
  recipeIds: string[];
  /** null = never expires. */
  ttlDays: number | null;
  publicPreview: boolean;
}

export interface ShareStore {
  create(input: CreateShareRow): Promise<{ id: string; token: string; expiresAt: string | null }>;
  list(householdId: string, userId: string): Promise<ShareSummary[]>;
  revoke(householdId: string, userId: string, shareId: string): Promise<boolean>;
  read(token: string, viewer: ShareViewer): Promise<ShareReadResult | null>;
  /** The cover reference of one recipe in a live share (a storage path, or a URL in memory mode), or null. */
  coverRef(token: string, recipeId: string, viewer: ShareViewer): Promise<string | null>;
  recordSave(token: string, sourceRecipeId: string, newRecipeId: string, viewer: ShareViewer): Promise<boolean>;
}

type Row = Record<string, unknown>;
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const MEAL: readonly MealType[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const DIET: readonly DietCategory[] = ['meat', 'fish', 'vegetarian', 'vegan'];

export const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');
export const newToken = (): string => randomBytes(32).toString('hex');

function fail(e: unknown): never {
  const code = (e as { code?: string } | null)?.code;
  if (code === '42501' || code === 'PGRST301') throw new ShareStoreError('forbidden');
  if (code === '22023' || code === '22P02' || code === '23514' || code === '23502') throw new ShareStoreError('invalid_input');
  if (code === '23503') throw new ShareStoreError('not_found');
  throw new ShareStoreError('unknown');
}

const statusOf = (revokedAt: string | null, expiresAt: string | null, now: number): ShareStatus =>
  revokedAt ? 'revoked' : expiresAt && Date.parse(expiresAt) <= now ? 'expired' : 'active';

/** A recipe document from the RPC (snake_case, whitelisted) -> SharedRecipeDoc. Tolerant: odd rows degrade, never throw. */
export function recipeDocFromRpc(d: Row): SharedRecipeDoc {
  const ingredients = (Array.isArray(d.ingredients) ? (d.ingredients as Row[]) : []).map((r) => ({
    name: str(r.display_name) || str(r.original_text),
    ingredientId: typeof r.ingredient_id === 'string' ? r.ingredient_id : null,
    quantity: safeQuantity(r),
    preparation: typeof r.preparation === 'string' && r.preparation ? r.preparation : undefined,
    optional: r.optional === true,
  }));
  const meal = MEAL.find((m) => m === d.meal_type);
  const diet = DIET.find((m) => m === d.diet_category);
  return {
    id: str(d.id), title: str(d.title), description: str(d.description), sourceUrl: str(d.source_url), sourceAttribution: str(d.source_attribution),
    prepMinutes: numOrNull(d.prep_minutes), cookMinutes: numOrNull(d.cook_minutes), servings: numOrNull(d.default_servings) ?? 4, cuisine: str(d.cuisine),
    mealType: meal ?? 'dinner', diet: diet ?? 'meat', tags: (Array.isArray(d.tags) ? d.tags : []).filter((t): t is string => typeof t === 'string'),
    hasCover: d.has_cover === true, ingredients,
    steps: (Array.isArray(d.steps) ? (d.steps as Row[]) : []).map((s) => str(s.instructions)).filter(Boolean),
  };
}

export class SupabaseShareStore implements ShareStore {
  constructor(private readonly db: SupabaseClient) {}

  async create(i: CreateShareRow): Promise<{ id: string; token: string; expiresAt: string | null }> {
    const { data, error } = await this.db.rpc('create_recipe_share', {
      p_household_id: i.householdId, p_scope: i.scope, p_title: i.title, p_recipe_ids: i.recipeIds,
      p_ttl: i.ttlDays === null ? null : `${i.ttlDays} days`, p_public_preview: i.publicPreview,
    });
    if (error) fail(error);
    const row = (Array.isArray(data) ? data[0] : data) as Row | undefined;
    if (!row || typeof row.token !== 'string') throw new ShareStoreError('unknown');
    return { id: str(row.share_id), token: row.token, expiresAt: typeof row.expires_at === 'string' ? row.expires_at : null };
  }

  async list(householdId: string): Promise<ShareSummary[]> {
    const { data, error } = await this.db.rpc('list_recipe_shares', { p_household_id: householdId });
    if (error) fail(error);
    const now = Date.now();
    return (Array.isArray(data) ? (data as Row[]) : []).map((r) => {
      const expiresAt = typeof r.expires_at === 'string' ? r.expires_at : null;
      const revokedAt = typeof r.revoked_at === 'string' ? r.revoked_at : null;
      return {
        id: str(r.id), scope: r.scope === 'collection' ? 'collection' : 'recipe', title: typeof r.title === 'string' ? r.title : null,
        recipes: (Array.isArray(r.recipes) ? (r.recipes as Row[]) : []).map((x) => ({ id: str(x.id), title: str(x.title) })),
        createdAt: str(r.created_at), expiresAt, revokedAt, publicPreview: r.public_preview === true, status: statusOf(revokedAt, expiresAt, now),
        openedBy: Number(r.opened_by ?? 0), saved: Number(r.saved ?? 0), createdByMe: r.created_by_me === true,
      } satisfies ShareSummary;
    });
  }

  async revoke(_h: string, _u: string, shareId: string): Promise<boolean> {
    const { data, error } = await this.db.rpc('revoke_recipe_share', { p_share_id: shareId });
    if (error) fail(error);
    return data === true;
  }

  async read(token: string): Promise<ShareReadResult | null> {
    const { data, error } = await this.db.rpc('read_recipe_share', { p_token: token });
    if (error) fail(error);
    if (!data || typeof data !== 'object') return null;
    const d = data as Row;
    const scope: ShareScope = d.scope === 'collection' ? 'collection' : 'recipe';
    const base = { scope, title: typeof d.title === 'string' ? d.title : null, sharedBy: typeof d.shared_by === 'string' ? d.shared_by : null, recipeCount: Number(d.recipe_count ?? 0) };
    if (d.minimal === true) return { minimal: true, ...base };
    return {
      minimal: false, ...base, expiresAt: typeof d.expires_at === 'string' ? d.expires_at : null,
      recipes: (Array.isArray(d.recipes) ? (d.recipes as Row[]) : []).map(recipeDocFromRpc), signedIn: d.signed_in === true, own: d.own === true,
    };
  }

  async coverRef(token: string, recipeId: string): Promise<string | null> {
    const { data, error } = await this.db.rpc('share_cover_ref', { p_token: token, p_recipe_id: recipeId });
    if (error) fail(error);
    return typeof data === 'string' && data ? data : null;
  }

  async recordSave(token: string, sourceRecipeId: string, newRecipeId: string): Promise<boolean> {
    const { data, error } = await this.db.rpc('record_share_save', { p_token: token, p_source_recipe_id: sourceRecipeId, p_new_recipe_id: newRecipeId });
    if (error) fail(error);
    return data === true;
  }
}

// ---------------------------------------------------------------------------------------------------------------- memory

interface MemShare {
  id: string;
  householdId: string;
  createdBy: string;
  sharedBy: string | null;
  scope: ShareScope;
  title: string | null;
  recipeIds: string[];
  publicPreview: boolean;
  createdAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  /** user id -> times saved */
  recipients: Map<string, number>;
}
const g = globalThis as { __frShares?: Map<string, MemShare> };
/** token hash -> share */
const shares = (): Map<string, MemShare> => (g.__frShares ??= new Map());

export function resetMemoryShares(): void {
  g.__frShares = undefined;
}

/** Test hook: the memory store has no clock of its own; tests change expiry directly. */
export function memoryShareForTest(token: string): MemShare | undefined {
  return shares().get(hashToken(token));
}

const live = (s: MemShare, now = Date.now()): boolean => !s.revokedAt && (!s.expiresAt || Date.parse(s.expiresAt) > now);

export class MemoryShareStore implements ShareStore {
  async create(i: CreateShareRow): Promise<{ id: string; token: string; expiresAt: string | null }> {
    const repo = getRecipeRepositoryFor(i.householdId);
    const ids = [...new Set(i.recipeIds)];
    if ((i.scope === 'recipe' && ids.length !== 1) || (i.scope === 'collection' && (ids.length < 1 || ids.length > SHARE_MAX_RECIPES))) throw new ShareStoreError('invalid_input');
    for (const id of ids) if (!(await repo.get(id))) throw new ShareStoreError('invalid_input');
    const token = newToken();
    const now = new Date();
    shares().set(hashToken(token), {
      id: randomUUID(), householdId: i.householdId, createdBy: i.userId, sharedBy: i.displayName?.trim() || null, scope: i.scope,
      title: i.scope === 'collection' ? (i.title ?? '').slice(0, 80) : null, recipeIds: ids, publicPreview: i.publicPreview, createdAt: now.toISOString(),
      expiresAt: i.ttlDays === null ? null : new Date(now.getTime() + i.ttlDays * 86_400_000).toISOString(), revokedAt: null, recipients: new Map(),
    });
    const s = shares().get(hashToken(token))!;
    return { id: s.id, token, expiresAt: s.expiresAt };
  }

  async list(householdId: string, userId: string): Promise<ShareSummary[]> {
    const repo = getRecipeRepositoryFor(householdId);
    const now = Date.now();
    const out: ShareSummary[] = [];
    for (const s of shares().values()) {
      if (s.householdId !== householdId) continue;
      const recipes: Array<{ id: string; title: string }> = [];
      for (const id of s.recipeIds) {
        const r = await repo.get(id);
        if (r) recipes.push({ id, title: r.title });
      }
      out.push({
        id: s.id, scope: s.scope, title: s.title, recipes, createdAt: s.createdAt, expiresAt: s.expiresAt, revokedAt: s.revokedAt, publicPreview: s.publicPreview,
        status: statusOf(s.revokedAt, s.expiresAt, now), openedBy: s.recipients.size, saved: [...s.recipients.values()].reduce((a, b) => a + b, 0), createdByMe: s.createdBy === userId,
      });
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async revoke(householdId: string, _userId: string, shareId: string): Promise<boolean> {
    for (const s of shares().values()) {
      if (s.id === shareId && s.householdId === householdId) {
        s.revokedAt ??= new Date().toISOString();
        return true;
      }
    }
    return false;
  }

  private find(token: string): MemShare | null {
    if (!/^[0-9a-f]{64}$/.test(token)) return null;
    const s = shares().get(hashToken(token));
    return s && live(s) ? s : null;
  }

  async read(token: string, viewer: ShareViewer): Promise<ShareReadResult | null> {
    const s = this.find(token);
    if (!s) return null;
    const repo = getRecipeRepositoryFor(s.householdId);
    const recipes: SharedRecipeDoc[] = [];
    for (const id of s.recipeIds) {
      const r = await repo.get(id);
      if (!r) continue;
      // Built field by field: the RecipeView also carries favourite, rating, cooking history and cost, none of which may travel.
      recipes.push({
        id: r.id, title: r.title, description: r.description, sourceUrl: r.sourceUrl, sourceAttribution: r.sourceAttribution, prepMinutes: r.prepMinutes,
        cookMinutes: r.cookMinutes, servings: r.servings, cuisine: r.cuisine, mealType: r.mealType, diet: r.diet, tags: [...r.tags], hasCover: !!r.imageUrl,
        ingredients: r.ingredients.map((l) => ({ name: l.name, ingredientId: l.ingredientId ?? null, quantity: structuredClone(l.quantity), preparation: l.preparation, optional: l.optional })),
        steps: r.steps.map((x) => x.text),
      });
    }
    const base = { scope: s.scope, title: s.title, sharedBy: s.sharedBy, recipeCount: recipes.length };
    if (viewer.userId === null && !s.publicPreview) return { minimal: true, ...base };
    const own = viewer.householdId === s.householdId;
    if (viewer.userId !== null && !own && !s.recipients.has(viewer.userId)) s.recipients.set(viewer.userId, 0);
    return { minimal: false, ...base, expiresAt: s.expiresAt, recipes, signedIn: viewer.userId !== null, own };
  }

  async coverRef(token: string, recipeId: string, viewer: ShareViewer): Promise<string | null> {
    const s = this.find(token);
    if (!s || viewer.userId === null || !s.recipeIds.includes(recipeId)) return null;
    const r = await getRecipeRepositoryFor(s.householdId).get(recipeId);
    return r?.imageUrl ?? null;
  }

  async recordSave(token: string, sourceRecipeId: string, _newRecipeId: string, viewer: ShareViewer): Promise<boolean> {
    const s = this.find(token);
    if (!s || viewer.userId === null || !s.recipeIds.includes(sourceRecipeId)) return false;
    s.recipients.set(viewer.userId, (s.recipients.get(viewer.userId) ?? 0) + 1);
    return true;
  }
}
