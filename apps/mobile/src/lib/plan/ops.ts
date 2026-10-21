// Ported from apps/web/lib/plan/ops.ts, cost.ts and nutrition.ts (same rules and the same unit-test cases): pure,
// immutable edits of a PlanDoc plus the honest cost / nutrition summaries (unknown stays unknown, never 0).
import { goalHints, summariseGoals, summariseVariety, summariseWeek, type GoalCandidate, type GoalHint, type GoalId, type GoalMeal, type GoalsSummary, type PlannedMealNutrition, type VarietySummary, type WeeklyNutritionSummary } from '@fr/engine/nutrition';
import { addDays } from './dates';
import type { MealType, PlanDoc, PlanEntry, RecipeLite, SlotRef } from './types';

export const slotKey = (s: SlotRef): string => `${s.date}|${s.mealType}`;
export function parseKey(key: string): SlotRef {
  const [date = '', mealType = 'dinner'] = key.split('|');
  return { date, mealType: mealType as MealType };
}

// Any edit invalidates an AI proposal link and reopens an approved plan as a draft.
const touch = (doc: PlanDoc, entries: Record<string, PlanEntry>): PlanDoc => ({ ...doc, entries, proposalId: undefined, status: 'draft' });

export const getEntry = (doc: PlanDoc, slot: SlotRef): PlanEntry | undefined => doc.entries[slotKey(slot)];

export function setRecipe(doc: PlanDoc, slot: SlotRef, recipeId: string, servings: number): PlanDoc {
  const note = getEntry(doc, slot)?.note;
  return touch(doc, { ...doc.entries, [slotKey(slot)]: { kind: 'recipe', recipeId, servings, ...(note ? { note } : {}) } });
}

/** Swap = replace the recipe but keep the slot's servings and note. */
export function swapRecipe(doc: PlanDoc, slot: SlotRef, recipeId: string, fallbackServings = 4): PlanDoc {
  const prev = getEntry(doc, slot);
  return setRecipe(doc, slot, recipeId, prev?.kind === 'recipe' ? prev.servings : fallbackServings);
}

export function removeEntry(doc: PlanDoc, slot: SlotRef): PlanDoc {
  const entries = { ...doc.entries };
  delete entries[slotKey(slot)];
  return touch(doc, entries);
}

export function setServings(doc: PlanDoc, slot: SlotRef, servings: number): PlanDoc {
  const e = getEntry(doc, slot);
  if (!e || e.kind !== 'recipe') return doc;
  return touch(doc, { ...doc.entries, [slotKey(slot)]: { ...e, servings: Math.min(99, Math.max(1, Math.round(servings))) } });
}

export function setNote(doc: PlanDoc, slot: SlotRef, note: string): PlanDoc {
  const e = getEntry(doc, slot);
  if (!e) return doc;
  const next = { ...e } as PlanEntry;
  if (note.trim()) next.note = note.trim().slice(0, 200);
  else delete next.note;
  return touch(doc, { ...doc.entries, [slotKey(slot)]: next });
}

export function markSlot(doc: PlanDoc, slot: SlotRef, kind: 'eating_out' | 'leftovers'): PlanDoc {
  const note = getEntry(doc, slot)?.note;
  return touch(doc, { ...doc.entries, [slotKey(slot)]: { kind, ...(note ? { note } : {}) } });
}

/** Put a stored leftover / freezer batch in a slot (P2-C, D417): no shopping; its portions leave the ledger when eaten. */
export function setLeftover(doc: PlanDoc, slot: SlotRef, batchId: string, portions: number): PlanDoc {
  const note = getEntry(doc, slot)?.note;
  return touch(doc, { ...doc.entries, [slotKey(slot)]: { kind: 'leftovers', batchId, portions: Math.min(100, Math.max(1, Math.round(portions))), ...(note ? { note } : {}) } });
}

/** Move: the target takes the source entry; if it was occupied the two swap. Duplicate leaves the source. */
export function moveEntry(doc: PlanDoc, from: SlotRef, to: SlotRef, mode: 'move' | 'duplicate'): PlanDoc {
  const fk = slotKey(from);
  const tk = slotKey(to);
  if (fk === tk) return doc;
  const src = doc.entries[fk];
  if (!src) return doc;
  const entries = { ...doc.entries };
  if (mode === 'duplicate') {
    entries[tk] = { ...src };
  } else {
    const dst = entries[tk];
    entries[tk] = src;
    if (dst) entries[fk] = dst;
    else delete entries[fk];
  }
  return touch(doc, entries);
}

export const setMealTypes = (doc: PlanDoc, mealTypes: MealType[]): PlanDoc => ({ ...doc, mealTypes });

/** Reuse a previous week: same entries re-dated onto `weekStart`, as a fresh unsaved draft. */
export function shiftToWeek(doc: PlanDoc, weekStart: string, newId: string, now = new Date()): PlanDoc {
  const offset = Math.round((Date.parse(`${weekStart}T00:00:00Z`) - Date.parse(`${doc.weekStart}T00:00:00Z`)) / 86_400_000);
  const entries: Record<string, PlanEntry> = {};
  for (const [k, v] of Object.entries(doc.entries)) {
    const s = parseKey(k);
    entries[slotKey({ date: addDays(s.date, offset), mealType: s.mealType })] = { ...v };
  }
  return { ...doc, id: newId, weekStart, entries, status: 'draft', proposalId: undefined, prompt: undefined, updatedAt: now.toISOString() };
}

export const mealCount = (doc: PlanDoc): number => Object.values(doc.entries).filter((e) => e.kind === 'recipe').length;

// ---- cost ----
export const formatPence = (p: number): string => `£${(p / 100).toFixed(2)}`;

export type MealCost = { status: 'estimate'; pence: number; partial?: boolean } | { status: 'uncosted' } | { status: 'none' };

export function mealCost(entry: PlanEntry, recipes: ReadonlyMap<string, RecipeLite>): MealCost {
  if (entry.kind !== 'recipe') return { status: 'none' }; // eating out / leftovers add no shopping cost
  const r = recipes.get(entry.recipeId);
  if (!r || r.costPerServingPence == null) return { status: 'uncosted' };
  return { status: 'estimate', pence: Math.round(r.costPerServingPence * entry.servings), ...(r.costPartial ? { partial: true } : {}) };
}

export interface WeekCost {
  knownPence: number;
  costedMeals: number;
  uncostedMeals: number;
  partialMeals: number;
  status: 'estimate' | 'partial' | 'uncosted' | 'empty';
}

export function weekCost(doc: PlanDoc, recipes: ReadonlyMap<string, RecipeLite>): WeekCost {
  let knownPence = 0;
  let costed = 0;
  let uncosted = 0;
  let partial = 0;
  for (const e of Object.values(doc.entries)) {
    const c = mealCost(e, recipes);
    if (c.status === 'estimate') {
      knownPence += c.pence;
      costed++;
      if (c.partial) partial++;
    } else if (c.status === 'uncosted') uncosted++;
  }
  const status = costed + uncosted === 0 ? 'empty' : uncosted === 0 && partial === 0 ? 'estimate' : costed === 0 ? 'uncosted' : 'partial';
  return { knownPence, costedMeals: costed, uncostedMeals: uncosted, partialMeals: partial, status };
}

const meals = (n: number) => `${n} meal${n === 1 ? '' : 's'}`;
export function weekCostLabel(c: WeekCost): string {
  switch (c.status) {
    case 'empty': return 'No meals planned yet';
    case 'uncosted': return `Uncosted: no price data for ${meals(c.uncostedMeals)}`;
    case 'partial': {
      const parts = [c.uncostedMeals > 0 ? `${meals(c.uncostedMeals)} uncosted` : '', c.partialMeals > 0 ? `${meals(c.partialMeals)} with unpriced ingredients` : ''].filter(Boolean);
      return `At least ${formatPence(c.knownPence)} (estimate); ${parts.join(', ')}`;
    }
    case 'estimate': return `About ${formatPence(c.knownPence)} (estimate)`;
  }
}

// ---- nutrition ----
export interface WeekNutrition {
  summary: WeeklyNutritionSummary;
  meals: number;
  mealsWithoutNutrition: number;
}

export function weekNutrition(doc: PlanDoc, recipes: ReadonlyMap<string, RecipeLite>): WeekNutrition | null {
  const list: PlannedMealNutrition[] = [];
  for (const [key, e] of Object.entries(doc.entries)) {
    if (e.kind !== 'recipe') continue;
    const r = recipes.get(e.recipeId);
    const slot = parseKey(key);
    list.push({
      plannedMealId: key, recipeId: e.recipeId, ...(r ? { title: r.title } : {}), date: slot.date, mealType: slot.mealType,
      servings: e.servings, ...(r?.nutritionPerServing ? { perServing: r.nutritionPerServing } : {}),
    });
  }
  if (list.length === 0) return null;
  const summary = summariseWeek(list);
  return { summary, meals: list.length, mealsWithoutNutrition: summary.mealsWithoutNutrition.length };
}

// ---- variety ("5 a day", D376) ----
export interface WeekVariety {
  summary: VarietySummary;
  meals: number;
}

/** Fruit/veg portions, protein kinds and plant count for the planned recipe meals (engine summariseVariety; an estimate). */
export function weekVariety(doc: PlanDoc, recipes: ReadonlyMap<string, RecipeLite>): WeekVariety | null {
  const meals = Object.entries(doc.entries).flatMap(([key, e]) => {
    if (e.kind !== 'recipe') return [];
    const r = recipes.get(e.recipeId);
    return [{ id: key, date: parseKey(key).date, ...(r ? { title: r.title } : {}), variety: r?.variety ?? null }];
  });
  if (meals.length === 0) return null;
  return { summary: summariseVariety(meals), meals: meals.length };
}

/** Same over cooked meals (P1-A cooking log); null when none. */
export function cookedVariety(cooked: readonly { date: string; recipeId: string }[], recipes: ReadonlyMap<string, RecipeLite>): WeekVariety | null {
  if (cooked.length === 0) return null;
  const meals = cooked.map((c, i) => ({ id: `c${i}`, date: c.date, variety: recipes.get(c.recipeId)?.variety ?? null }));
  return { summary: summariseVariety(meals), meals: meals.length };
}

// ---- my nutrition goals this week (P3-B, D433): the signed-in person's own goals, the same engine summary as the web planner ----
export interface MyGoalsView {
  goals: GoalId[];
  portionShare: number;
}
export interface WeekGoals {
  summary: GoalsSummary;
  hints: GoalHint[];
  meals: number;
}

const goalMeal = (id: string, date: string, mealType: GoalMeal['mealType'], r: RecipeLite | undefined, recipeId: string): GoalMeal => ({
  id, recipeId, date, mealType, ...(r ? { title: r.title } : {}),
  perServing: r?.nutritionPerServing ?? null, variety: r?.variety ?? null, goals: r?.goals ?? null,
});

/** Saved recipes that could be suggested in a swap: no household exclusion hit, with the meal types they suit. */
export function swapCandidates(recipes: ReadonlyMap<string, RecipeLite>): GoalCandidate[] {
  return [...recipes.values()]
    .filter((r) => r.excludedBy.length === 0)
    .map((r) => ({ recipeId: r.id, title: r.title, mealTypes: r.mealTypes, perServing: r.nutritionPerServing ?? null, variety: r.variety ?? null, goals: r.goals ?? null }));
}

function buildGoals(my: MyGoalsView, meals: GoalMeal[], recipes: ReadonlyMap<string, RecipeLite>, hints: boolean): WeekGoals | null {
  if (my.goals.length === 0) return null;
  const summary = summariseGoals(my.goals, meals, { portionShare: my.portionShare });
  return { summary, meals: meals.length, hints: hints ? goalHints(summary.progress, meals, swapCandidates(recipes)) : [] };
}

export function weekGoals(my: MyGoalsView | null | undefined, doc: PlanDoc, recipes: ReadonlyMap<string, RecipeLite>): WeekGoals | null {
  if (!my) return null;
  const meals: GoalMeal[] = [];
  for (const [key, e] of Object.entries(doc.entries)) {
    if (e.kind !== 'recipe') continue;
    const slot = parseKey(key);
    meals.push(goalMeal(key, slot.date, slot.mealType, recipes.get(e.recipeId), e.recipeId));
  }
  return buildGoals(my, meals, recipes, true);
}

export function cookedGoals(my: MyGoalsView | null | undefined, cooked: readonly { date: string; recipeId: string }[], recipes: ReadonlyMap<string, RecipeLite>): WeekGoals | null {
  if (!my || cooked.length === 0) return null;
  return buildGoals(my, cooked.map((c, i) => goalMeal(`c${i}`, c.date, 'dinner', recipes.get(c.recipeId), c.recipeId)), recipes, false);
}
