// TODO: replace with @fr/engine/pantry after merge batch 2 (vendored verbatim from L22a-pantry/src/expiry.ts)
import type { IsoDate, IsoDateTime, MealType, Uuid } from './contract';
import { addDays, daysBetween, today } from './common';
import type { PantryItem } from './types';

export interface ExpiringItem { item: PantryItem; daysLeft: number; expired: boolean }

/** Items expiring within `withinDays` (inclusive of today), plus already-expired ones, soonest first. */
export function expiringSoon(items: readonly PantryItem[], now: IsoDateTime, withinDays = 3): ExpiringItem[] {
  const t = today(now);
  return items
    .filter((i): i is PantryItem & { expiry: IsoDate } => !!i.expiry)
    .map((item) => ({ item, daysLeft: daysBetween(t, item.expiry), expired: daysBetween(t, item.expiry) < 0 }))
    .filter((e) => e.daysLeft <= withinDays)
    .sort((a, b) => a.daysLeft - b.daysLeft || a.item.name.localeCompare(b.item.name));
}

export interface CookedBatch {
  recipeId: Uuid; recipeTitle?: string; cookedOn: IsoDate;
  portionsCooked: number; portionsEaten: number;
  /** Days the leftovers keep (fridge). Default 3. */
  keepDays?: number; freezable?: boolean;
}
export interface OpenSlot { id: Uuid; date: IsoDate; mealType: MealType }
export interface LeftoverSuggestion { slotId: Uuid; date: IsoDate; mealType: MealType; portions: number; explanation: string }
export interface LeftoverPlan {
  portionsRemaining: number; useByDate: IsoDate;
  suggestions: LeftoverSuggestion[]; unplaced: number; advice: string[];
}

/**
 * Leftover / batch-cooking helper: portions left from a cooked meal -> suggested open slots on or before
 * the use-by date (earliest first). Snacks are never suggested; leftovers go to lunch/dinner/breakfast slots as given.
 */
export function planLeftovers(batch: CookedBatch, openSlots: readonly OpenSlot[], portionsPerSlot = 1): LeftoverPlan {
  const remaining = Math.max(0, batch.portionsCooked - batch.portionsEaten);
  const useBy = addDays(batch.cookedOn, batch.keepDays ?? 3);
  const name = batch.recipeTitle ?? 'leftovers';
  const eligible = openSlots
    .filter((s) => s.mealType !== 'snack' && s.date >= batch.cookedOn && s.date <= useBy)
    .sort((a, b) => a.date.localeCompare(b.date) || order(a.mealType) - order(b.mealType));
  const suggestions: LeftoverSuggestion[] = [];
  let left = remaining;
  for (const s of eligible) {
    if (left <= 0) break;
    const p = Math.min(portionsPerSlot, left);
    suggestions.push({ slotId: s.id, date: s.date, mealType: s.mealType, portions: p, explanation: `${p} portion(s) of ${name} on ${s.date} ${s.mealType} (use by ${useBy})` });
    left -= p;
  }
  const advice: string[] = [];
  if (left > 0) {
    advice.push(batch.freezable
      ? `${left} portion(s) of ${name} will not fit before ${useBy} — freeze them`
      : `${left} portion(s) of ${name} have no slot before ${useBy} and it is not marked freezable — eat sooner or add slots`);
  }
  if (remaining === 0) advice.push(`No portions of ${name} remaining`);
  return { portionsRemaining: remaining, useByDate: useBy, suggestions, unplaced: left, advice };
}
const order = (m: MealType): number => ({ breakfast: 0, lunch: 1, dinner: 2, snack: 3 })[m];
