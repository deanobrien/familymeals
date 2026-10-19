// Pure, immutable edit operations on a PlanDoc. All client-safe.
import { addDays } from './dates';
import type { MealType, PlanDoc, PlanEntry, SlotRef } from './types';

export const slotKey = (s: SlotRef) => `${s.date}|${s.mealType}`;
export function parseKey(key: string): SlotRef {
  const [date = '', mealType = 'dinner'] = key.split('|');
  return { date, mealType: mealType as MealType };
}

const touch = (doc: PlanDoc, entries: Record<string, PlanEntry>): PlanDoc => ({
  ...doc,
  entries,
  // Any edit invalidates an AI proposal link and reopens an approved plan as a draft.
  proposalId: undefined,
  status: 'draft',
});

export function getEntry(doc: PlanDoc, slot: SlotRef): PlanEntry | undefined {
  return doc.entries[slotKey(slot)];
}

export function setRecipe(doc: PlanDoc, slot: SlotRef, recipeId: string, servings: number): PlanDoc {
  const prev = getEntry(doc, slot);
  const note = prev?.note;
  return touch(doc, { ...doc.entries, [slotKey(slot)]: { kind: 'recipe', recipeId, servings, ...(note ? { note } : {}) } });
}

/** Swap = replace the recipe but keep the slot's servings and note. */
export function swapRecipe(doc: PlanDoc, slot: SlotRef, recipeId: string, fallbackServings = 4): PlanDoc {
  const prev = getEntry(doc, slot);
  const servings = prev?.kind === 'recipe' ? prev.servings : fallbackServings;
  return setRecipe(doc, slot, recipeId, servings);
}

export function removeEntry(doc: PlanDoc, slot: SlotRef): PlanDoc {
  const entries = { ...doc.entries };
  delete entries[slotKey(slot)];
  return touch(doc, entries);
}

export function setServings(doc: PlanDoc, slot: SlotRef, servings: number): PlanDoc {
  const e = getEntry(doc, slot);
  if (!e || e.kind !== 'recipe') return doc;
  return touch(doc, { ...doc.entries, [slotKey(slot)]: { ...e, servings: Math.max(1, Math.round(servings)) } });
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

/** Move: target takes the source entry; if target was occupied the two swap. Duplicate leaves the source. */
export function moveEntry(doc: PlanDoc, from: SlotRef, to: SlotRef, mode: 'move' | 'duplicate'): PlanDoc {
  const fk = slotKey(from);
  const tk = slotKey(to);
  if (fk === tk) return doc;
  const src = doc.entries[fk];
  if (!src) return doc;
  const entries = { ...doc.entries };
  if (mode === 'duplicate') {
    entries[tk] = structuredClone(src);
  } else {
    const dst = entries[tk];
    entries[tk] = src;
    if (dst) entries[fk] = dst;
    else delete entries[fk];
  }
  return touch(doc, entries);
}

export function setMealTypes(doc: PlanDoc, mealTypes: MealType[]): PlanDoc {
  return { ...doc, mealTypes };
}

/** Reuse a previous week: same entries re-dated onto `weekStart`, as a fresh unsaved draft. */
export function shiftToWeek(doc: PlanDoc, weekStart: string, newId: string, now = new Date()): PlanDoc {
  const offset = Math.round((Date.parse(`${weekStart}T00:00:00Z`) - Date.parse(`${doc.weekStart}T00:00:00Z`)) / 86_400_000);
  const entries: Record<string, PlanEntry> = {};
  for (const [k, v] of Object.entries(doc.entries)) {
    const s = parseKey(k);
    entries[slotKey({ date: addDays(s.date, offset), mealType: s.mealType })] = structuredClone(v);
  }
  return { ...doc, id: newId, weekStart, entries, status: 'draft', proposalId: undefined, prompt: undefined, updatedAt: now.toISOString() };
}

export function emptyDoc(id: string, householdId: string, weekStart: string, mealTypes: MealType[] = ['dinner'], now = new Date()): PlanDoc {
  return { id, householdId, weekStart, mealTypes, entries: {}, status: 'draft', updatedAt: now.toISOString() };
}

export function mealCount(doc: PlanDoc): number {
  return Object.values(doc.entries).filter((e) => e.kind === 'recipe').length;
}
