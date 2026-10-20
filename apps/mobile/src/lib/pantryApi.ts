/**
 * Client + defensive parsers for the pantry JSON API (apps/web `/api/pantry`, D340/D342). The server owns all pantry logic
 * (engine, validation, purchase planning); the app sends intents and renders the `PantryView` it gets back. Types are
 * app-side copies of the contract (never imported from the web app or @fr/ai).
 */
import type { ServerApi } from './serverApi';

export type PurchaseMode = 'off' | 'suggest' | 'auto';
export type Tone = 'neutral' | 'warning' | 'danger' | 'success';

export const UNIT_OPTIONS = [
  'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'item', 'clove', 'can', 'pack', 'bunch', 'slice', 'sprig', 'stick',
] as const;

export interface Badge { tone: Tone; label: string }
export interface PantryItemView {
  id: string;
  name: string;
  ingredientId?: string;
  quantityLabel: string;
  value?: number;
  unit?: string;
  expiry?: string;
  expiryBadge?: Badge;
  status: string;
  confidenceMessage: string;
  stale: boolean;
}
export interface PantryCategoryView { category: string; label: string; items: PantryItemView[] }
export interface ExpiringItemView { id: string; name: string; quantityLabel: string; expiry: string; daysLeft: number; expired: boolean; badge: Badge }
export interface SuggestionView {
  recipeId: string;
  title: string;
  coveragePct: number;
  covered: string[];
  missing: string[];
  headline: string;
}
export interface PendingView { eventId: string; name: string; quantityLabel: string; reason: string; ingredientId?: string }
export interface LeftoverPlanView { key: string; title: string; portionsRemaining: number; useBy: string; suggestions: string[]; advice: string[]; summary: string }
export interface PantrySettings { purchaseMode: PurchaseMode; staleAfterDays: number }
export interface PantryViewModel {
  settings: PantrySettings;
  totalItems: number;
  categories: PantryCategoryView[];
  staleItems: PantryItemView[];
  expiring: ExpiringItemView[];
  suggestions: SuggestionView[];
  pending: PendingView[];
  leftovers: LeftoverPlanView[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const numOr = (v: unknown, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');
const TONES: readonly string[] = ['neutral', 'warning', 'danger', 'success'];

function badge(v: unknown): Badge | undefined {
  if (!isObj(v) || typeof v.label !== 'string') return undefined;
  return { tone: (TONES.includes(str(v.tone)) ? v.tone : 'neutral') as Tone, label: v.label };
}

function item(v: unknown): PantryItemView | null {
  if (!isObj(v) || typeof v.id !== 'string' || typeof v.name !== 'string') return null;
  const b = badge(v.expiryBadge);
  return {
    id: v.id, name: v.name, quantityLabel: str(v.quantityLabel), status: str(v.status, 'confident'),
    confidenceMessage: str(v.confidenceMessage), stale: v.stale === true,
    ...(typeof v.ingredientId === 'string' ? { ingredientId: v.ingredientId } : {}),
    ...(typeof v.value === 'number' ? { value: v.value } : {}),
    ...(typeof v.unit === 'string' ? { unit: v.unit } : {}),
    ...(typeof v.expiry === 'string' ? { expiry: v.expiry } : {}),
    ...(b ? { expiryBadge: b } : {}),
  };
}

const items = (v: unknown): PantryItemView[] => arr(v).map(item).filter((i): i is PantryItemView => !!i);

/** Defensive: an unexpected shape throws (the screen shows an error + retry) rather than rendering a wrong pantry. */
export function parsePantryView(body: unknown): PantryViewModel {
  const view = isObj(body) && isObj(body.view) ? body.view : undefined;
  if (!view) throw new Error('The server returned an unexpected pantry response.');
  const s = isObj(view.settings) ? view.settings : {};
  const mode = str(s.purchaseMode);
  const categories: PantryCategoryView[] = arr(view.categories)
    .filter(isObj)
    .map((c) => ({ category: str(c.category, 'other'), label: str(c.label, str(c.category, 'Other')), items: items(c.items) }));
  const expiring: ExpiringItemView[] = arr(view.expiring).filter(isObj).flatMap((e) => {
    const b = badge(e.badge);
    if (typeof e.id !== 'string' || typeof e.name !== 'string' || !b) return [];
    return [{ id: e.id, name: e.name, quantityLabel: str(e.quantityLabel), expiry: str(e.expiry), daysLeft: numOr(e.daysLeft, 0), expired: e.expired === true, badge: b }];
  });
  const suggestions: SuggestionView[] = arr(view.suggestions).filter(isObj).flatMap((r) =>
    typeof r.recipeId === 'string' && typeof r.title === 'string'
      ? [{ recipeId: r.recipeId, title: r.title, coveragePct: numOr(r.coveragePct, 0), covered: strs(r.covered), missing: strs(r.missing), headline: str(r.headline) }]
      : []);
  const pending: PendingView[] = arr(view.pending).filter(isObj).flatMap((p) =>
    typeof p.eventId === 'string' && typeof p.name === 'string'
      ? [{ eventId: p.eventId, name: p.name, quantityLabel: str(p.quantityLabel), reason: str(p.reason), ...(typeof p.ingredientId === 'string' ? { ingredientId: p.ingredientId } : {}) }]
      : []);
  return {
    settings: {
      purchaseMode: (mode === 'off' || mode === 'auto' ? mode : 'suggest') as PurchaseMode,
      staleAfterDays: numOr(s.staleAfterDays, 14),
    },
    totalItems: numOr(view.totalItems, categories.reduce((n, c) => n + c.items.length, 0)),
    categories, staleItems: items(view.staleItems), expiring, suggestions, pending,
    leftovers: arr(view.leftovers).filter(isObj).map(parseLeftover).filter((l): l is LeftoverPlanView => !!l),
  };
}

function parseLeftover(v: Obj): LeftoverPlanView | null {
  if (typeof v.title !== 'string') return null;
  return {
    key: str(v.key, v.title), title: v.title, portionsRemaining: numOr(v.portionsRemaining, 0), useBy: str(v.useBy),
    suggestions: strs(v.suggestions), advice: strs(v.advice), summary: str(v.summary),
  };
}

/* ---------- client-side validation (mirrors the server so most mistakes never leave the phone) ---------- */

export function parseQuantity(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** '' means "no expiry". Returns an error message, or null when valid. */
export function expiryError(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return 'Enter the date as YYYY-MM-DD, for example 2026-11-05.';
  const d = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t ? 'That is not a real date.' : null;
}

/* ---------- calls ---------- */

export async function fetchPantry(api: ServerApi, householdId: string): Promise<PantryViewModel> {
  return parsePantryView(await api.get<unknown>('/api/pantry', { householdId }));
}

/** Returns the server's success message (e.g. "Added Quinoa"); a refusal throws ServerApiError with the server's text. */
async function act(api: ServerApi, householdId: string, action: string, payload: Obj = {}): Promise<string> {
  const body = await api.post<unknown>('/api/pantry', { action, householdId, ...payload });
  return isObj(body) && typeof body.message === 'string' ? body.message : 'Done';
}

export interface AddPayload { name?: string; ingredientId?: string; value: number; unit: string; expiry?: string }
export const addItem = (api: ServerApi, hh: string, p: AddPayload) => act(api, hh, 'add', { ...p });
/** `expiry: null` clears the date. */
export const correctItem = (api: ServerApi, hh: string, p: { id: string; value: number; unit: string; expiry: string | null }) =>
  act(api, hh, 'correct', { ...p });
export const confirmItem = (api: ServerApi, hh: string, id: string) => act(api, hh, 'confirm', { id });
export const removeItem = (api: ServerApi, hh: string, id: string) => act(api, hh, 'remove', { id });
export const saveSettings = (api: ServerApi, hh: string, s: PantrySettings) => act(api, hh, 'settings', { ...s });
export const acceptAdjustment = (api: ServerApi, hh: string, eventId: string, expiry?: string) =>
  act(api, hh, 'acceptAdjustment', { eventId, ...(expiry ? { expiry } : {}) });
export const dismissAdjustment = (api: ServerApi, hh: string, eventId: string) => act(api, hh, 'dismissAdjustment', { eventId });

export interface LeftoverRequest { title: string; portionsCooked: number; portionsEaten: number; keepDays?: number; freezable?: boolean }
export async function planLeftovers(api: ServerApi, hh: string, r: LeftoverRequest): Promise<LeftoverPlanView> {
  const body = await api.post<unknown>('/api/pantry', { action: 'leftovers', householdId: hh, ...r });
  const plan = isObj(body) && isObj(body.plan) ? parseLeftover(body.plan) : null;
  if (!plan) throw new Error('The server returned an unexpected leftovers response.');
  return plan;
}
