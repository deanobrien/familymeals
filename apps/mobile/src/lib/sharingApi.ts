// Shared cookbook on Android (P3-A, D420-D424): the client for the web app's /api/shares routes, the link parsing for deep links
// (`familyrecipes://s/<token>` and the https App Link `https://<web host>/s/<token>`), and defensive parsers. What a share carries is
// only what the sharer chose: title, description, times, ingredients, steps and a photo. Unknown parts are dropped.
import type { ServerApi } from './serverApi';

export const SHARE_TOKEN_RE = /^[0-9a-f]{64}$/;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export function buildShareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, '')}/s/${token}`;
}

/** Token from `familyrecipes://s/<t>`, `https://host/s/<t>` or the Expo Go `exp://host/--/s/<t>` form, else null. */
export function parseShareUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const path = url.split(/[?#]/)[0] ?? '';
  const m = /^[a-z][a-z0-9+.-]*:\/\/(?:[^/]*\/)?(?:--\/)?s\/([^/]+)\/?$/i.exec(path);
  const token = m?.[1]?.toLowerCase();
  return token && SHARE_TOKEN_RE.test(token) ? token : null;
}

export interface SharedRecipe {
  id: string;
  title: string;
  description: string;
  sourceAttribution: string;
  sourceUrl: string;
  prepMinutes: number | null;
  cookMinutes: number | null;
  servings: number;
  cuisine: string;
  tags: string[];
  ingredients: Array<{ text: string; optional: boolean }>;
  steps: string[];
  imagePath: string | null;
}

export type SharePreview =
  | { kind: 'invalid' }
  | { kind: 'minimal'; scope: 'recipe' | 'collection'; title: string | null; sharedBy: string | null; recipeCount: number }
  | { kind: 'full'; scope: 'recipe' | 'collection'; title: string | null; attribution: string; recipes: SharedRecipe[]; expiresAt: string | null; signedIn: boolean; own: boolean };

function parseRecipe(r: Obj): SharedRecipe | null {
  if (typeof r.id !== 'string' || typeof r.title !== 'string') return null;
  return {
    id: r.id, title: r.title, description: str(r.description), sourceAttribution: str(r.sourceAttribution), sourceUrl: str(r.sourceUrl),
    prepMinutes: num(r.prepMinutes), cookMinutes: num(r.cookMinutes), servings: num(r.servings) ?? 4, cuisine: str(r.cuisine),
    tags: arr(r.tags).filter((t): t is string => typeof t === 'string'),
    ingredients: arr(r.ingredients).filter(isObj).map((i) => ({ text: str(i.text), optional: i.optional === true })).filter((i) => i.text),
    steps: arr(r.steps).filter((s): s is string => typeof s === 'string'),
    imagePath: typeof r.imagePath === 'string' && r.imagePath.startsWith('/api/shares/') ? r.imagePath : null,
  };
}

export function parsePreview(v: unknown): SharePreview {
  if (!isObj(v)) return { kind: 'invalid' };
  const scope = v.scope === 'collection' ? 'collection' : 'recipe';
  if (v.kind === 'minimal') return { kind: 'minimal', scope, title: typeof v.title === 'string' ? v.title : null, sharedBy: typeof v.sharedBy === 'string' ? v.sharedBy : null, recipeCount: num(v.recipeCount) ?? 0 };
  if (v.kind === 'full') {
    return {
      kind: 'full', scope, title: typeof v.title === 'string' ? v.title : null, attribution: str(v.attribution, 'Shared by another household'),
      recipes: arr(v.recipes).filter(isObj).map(parseRecipe).filter((r): r is SharedRecipe => !!r), expiresAt: typeof v.expiresAt === 'string' ? v.expiresAt : null,
      signedIn: v.signedIn === true, own: v.own === true,
    };
  }
  return { kind: 'invalid' };
}

export interface ShareSummary {
  id: string;
  scope: 'recipe' | 'collection';
  title: string | null;
  recipes: Array<{ id: string; title: string }>;
  createdAt: string;
  expiresAt: string | null;
  status: 'active' | 'expired' | 'revoked';
  publicPreview: boolean;
  openedBy: number;
  saved: number;
}

export function parseShares(v: unknown): ShareSummary[] {
  const list = isObj(v) ? arr(v.shares) : [];
  return list.filter(isObj).flatMap((s) => {
    if (typeof s.id !== 'string') return [];
    const status = s.status === 'revoked' || s.status === 'expired' ? s.status : 'active';
    return [{
      id: s.id, scope: s.scope === 'collection' ? ('collection' as const) : ('recipe' as const), title: typeof s.title === 'string' ? s.title : null,
      recipes: arr(s.recipes).filter(isObj).map((r) => ({ id: str(r.id), title: str(r.title) })), createdAt: str(s.createdAt), expiresAt: typeof s.expiresAt === 'string' ? s.expiresAt : null,
      status, publicPreview: s.publicPreview === true, openedBy: num(s.openedBy) ?? 0, saved: num(s.saved) ?? 0,
    }];
  });
}

export const EXPIRY_CHOICES: ReadonlyArray<{ days: number | null; label: string }> = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
  { days: null, label: 'No expiry' },
];

export interface CreateShareInput {
  scope: 'recipe' | 'collection';
  recipeIds?: string[];
  collection?: 'favourites' | 'quick' | 'budget' | 'vegetarian';
  title?: string;
  expiresInDays: number | null;
  publicPreview: boolean;
}

export interface SharingClient {
  list(): Promise<ShareSummary[]>;
  /** The token comes back ONCE. */
  create(input: CreateShareInput): Promise<{ id: string; token: string; expiresAt: string | null }>;
  revoke(shareId: string): Promise<void>;
  /** Public: works signed out (a minimal preview). */
  preview(token: string): Promise<{ preview: SharePreview; signedIn: boolean }>;
  save(token: string, recipeId: string): Promise<{ recipeId: string; title: string; imageCopied: boolean }>;
}

export function createSharingClient(api: ServerApi, householdId: string | null): SharingClient {
  const hh = householdId ? { householdId } : {};
  return {
    list: async () => parseShares(await api.get<unknown>('/api/shares', { ...hh })),
    create: async (input) => {
      const body = await api.post<unknown>('/api/shares', { ...hh, action: 'create', ...input });
      const s = isObj(body) && isObj(body.share) ? body.share : {};
      if (typeof s.token !== 'string' || !SHARE_TOKEN_RE.test(s.token)) throw new Error('The server did not return a link.');
      return { id: str(s.id), token: s.token, expiresAt: typeof s.expiresAt === 'string' ? s.expiresAt : null };
    },
    revoke: async (shareId) => {
      await api.post('/api/shares', { ...hh, action: 'revoke', shareId });
    },
    preview: async (token) => {
      const body = await api.post<unknown>('/api/shares/preview', { ...hh, token });
      return { preview: parsePreview(isObj(body) ? body.preview : null), signedIn: isObj(body) && body.signedIn === true };
    },
    save: async (token, recipeId) => {
      const body = await api.post<unknown>('/api/shares/save', { ...hh, token, recipeId });
      const o = isObj(body) ? body : {};
      if (typeof o.recipeId !== 'string') throw new Error('The copy could not be saved.');
      return { recipeId: o.recipeId, title: str(o.title), imageCopied: o.imageCopied === true };
    },
  };
}
