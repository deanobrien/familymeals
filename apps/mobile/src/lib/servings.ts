import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Quantity } from '@fr/domain';
import { formatQuantity, scaleToServings } from '@fr/engine/scale';

/**
 * Serving counts on the recipe detail screen. Same rules as the web app (apps/web/lib/recipes/initial-servings.ts): a recipe
 * opens at the household default (fallback 4), never its own servings; a per-member, per-recipe override wins and is kept on
 * the device (the web keeps the same override in localStorage, so the two do not sync).
 */
export const FALLBACK_HOUSEHOLD_SERVINGS = 4;
export const MAX_SERVINGS = 100;

export const validServings = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_SERVINGS;

export function resolveInitialServings(householdDefault: unknown, override?: unknown): number {
  if (validServings(override)) return override;
  return validServings(householdDefault) ? householdDefault : FALLBACK_HOUSEHOLD_SERVINGS;
}

export const servingsOverrideKey = (householdId: string, userId: string, recipeId: string): string =>
  `fr:servings:v1:${householdId}:${userId}:${recipeId}`;

export function parseStoredServings(raw: string | null): number | undefined {
  if (raw == null || !/^\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return validServings(n) ? n : undefined;
}

export async function loadServingsOverride(key: string): Promise<number | undefined> {
  try {
    return parseStoredServings(await AsyncStorage.getItem(key));
  } catch {
    return undefined; // storage unavailable: stay on the household default
  }
}

export async function saveServingsOverride(key: string, servings: number | null): Promise<void> {
  try {
    if (servings === null) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, String(servings));
  } catch {
    /* best effort */
  }
}

/**
 * Display text of one ingredient amount at `wanted` servings, using the engine's scale + format rules: exact amounts and
 * ranges scale and are rounded for easy measuring; "to taste", unparsed text and a bare "a pinch" are left unchanged.
 */
export function scaledAmount(q: Quantity, recipeServings: number, wanted: number): string {
  if (!(recipeServings > 0) || !(wanted > 0) || recipeServings === wanted) return formatQuantity(q);
  return formatQuantity(scaleToServings(q, recipeServings, wanted));
}
