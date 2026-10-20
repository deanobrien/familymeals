/**
 * "What can I make now?" (P1-B, D375): client + defensive parser for `GET/POST /api/pantry/make-now`. The server owns the
 * ranking (engine rankRecipesByPantry, expiring stock weighted up), the allergy exclusions (with consent) and the shopping
 * list; the app renders the view it gets and sends one intent (add missing items for a recipe, idempotent).
 */
import type { ServerApi } from './serverApi';

export interface MakeNowMissing { name: string; quantityLabel: string }
export interface MakeNowItem {
  recipeId: string;
  title: string;
  coveragePct: number;
  urgencyPct: number;
  makeable: boolean;
  usesExpiring: boolean;
  covered: string[];
  missing: MakeNowMissing[];
  headline: string;
}
export interface MakeNowView {
  items: MakeNowItem[];
  hiddenByAllergy: number;
  exclusionsActive: boolean;
  withheldExclusions: number;
  totalRecipes: number;
  pantryEmpty: boolean;
}
export interface MakeNowAddResult { added: number; alreadyOnList: number; message: string }

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');

/** An unexpected shape throws so the section can be left out instead of showing something wrong. */
export function parseMakeNowView(body: unknown): MakeNowView {
  const v = isObj(body) && isObj(body.view) ? body.view : undefined;
  if (!v) throw new Error('The server returned an unexpected suggestions response.');
  const items = arr(v.items).filter(isObj).flatMap((i): MakeNowItem[] =>
    typeof i.recipeId === 'string' && typeof i.title === 'string'
      ? [{
          recipeId: i.recipeId, title: i.title, coveragePct: Math.max(0, Math.min(100, num(i.coveragePct))), urgencyPct: Math.max(0, Math.min(100, num(i.urgencyPct))),
          makeable: i.makeable === true, usesExpiring: i.usesExpiring === true, covered: strs(i.covered), headline: str(i.headline),
          missing: arr(i.missing).filter(isObj).flatMap((m): MakeNowMissing[] => (typeof m.name === 'string' ? [{ name: m.name, quantityLabel: str(m.quantityLabel) }] : [])),
        }]
      : []);
  return {
    items, hiddenByAllergy: Math.max(0, Math.floor(num(v.hiddenByAllergy))), exclusionsActive: v.exclusionsActive === true,
    withheldExclusions: Math.max(0, Math.floor(num(v.withheldExclusions))), totalRecipes: Math.max(0, Math.floor(num(v.totalRecipes))), pantryEmpty: v.pantryEmpty === true,
  };
}

export async function fetchMakeNow(api: ServerApi, householdId: string, limit = 6): Promise<MakeNowView> {
  return parseMakeNowView(await api.get<unknown>('/api/pantry/make-now', { householdId, limit }));
}

/** Adds what the pantry lacks for one recipe to the shopping list. Repeats add nothing; a refusal throws with the server's text. */
export async function addMissingToList(api: ServerApi, householdId: string, recipeId: string): Promise<MakeNowAddResult> {
  const body = await api.post<unknown>('/api/pantry/make-now', { action: 'add_missing', householdId, recipeId });
  if (!isObj(body) || body.ok !== true) throw new Error('The server returned an unexpected response.');
  return { added: Math.max(0, Math.floor(num(body.added))), alreadyOnList: Math.max(0, Math.floor(num(body.alreadyOnList))), message: str(body.message, 'Done') };
}
