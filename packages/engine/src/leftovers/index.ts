// Leftovers and batch cooking ledger (P2-C, D416-D418). Pure and deterministic, shared by web and Android.
//
// Model: a BATCH is a number of portions made on a day and stored in the fridge or freezer. Portions are never stored as a
// running balance: `portionsLeft = portionsMade - sum(consumptions)`, and every consumption carries an idempotency KEY
// (for example `plan:<planId>|<date>|<mealType>`), so marking the same meal eaten twice, or replaying a request, can never
// take the portions twice. A planned leftover meal needs no shopping (it is not a recipe entry) and its portions only leave
// the ledger when the meal is marked eaten.

export type StoredIn = 'fridge' | 'freezer';
export type ConsumptionKind = 'eaten' | 'discarded';

export const FRIDGE_USE_BY_DAYS = 2;
export const FREEZER_USE_BY_MONTHS = 3;
export const MAX_BATCH_MULTIPLIER = 6;
export const MAX_PORTIONS = 100;

export interface LeftoverBatch {
  id: string;
  title: string;
  recipeId?: string | undefined;
  portionsMade: number;
  storedIn: StoredIn;
  /** YYYY-MM-DD the food was cooked (or frozen from, see moveToFreezer). */
  cookedOn: string;
  /** YYYY-MM-DD: eat or freeze by (fridge) / best eaten by (freezer). */
  useBy: string;
}

export interface LeftoverConsumption {
  batchId: string;
  /** Idempotency key: the same key for the same batch is applied once. */
  key: string;
  portions: number;
  kind: ConsumptionKind;
}

const isoToUtc = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const toIso = (d: Date): string => d.toISOString().slice(0, 10);

export function addDaysIso(iso: string, n: number): string {
  const d = isoToUtc(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return toIso(d);
}

/** Calendar months, clamping the day (31 Jan + 1 month = 28/29 Feb). */
export function addMonthsIso(iso: string, n: number): string {
  const d = isoToUtc(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const dim = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, dim));
  return toIso(d);
}

export const daysBetweenIso = (from: string, to: string): number => Math.round((isoToUtc(to).getTime() - isoToUtc(from).getTime()) / 86_400_000);

/** Default use-by: 2 days in the fridge, 3 months in the freezer, counted from the day it was stored. */
export function defaultUseBy(storedOn: string, storedIn: StoredIn): string {
  return storedIn === 'fridge' ? addDaysIso(storedOn, FRIDGE_USE_BY_DAYS) : addMonthsIso(storedOn, FREEZER_USE_BY_MONTHS);
}

/** Portions left after the ledger: made minus everything eaten or discarded. Never negative. */
export function portionsLeft(batch: Pick<LeftoverBatch, 'id' | 'portionsMade'>, consumptions: readonly LeftoverConsumption[]): number {
  const used = consumptions.filter((c) => c.batchId === batch.id).reduce((n, c) => n + c.portions, 0);
  return Math.max(0, batch.portionsMade - used);
}

export type ConsumeResult =
  | { ok: true; consumptions: LeftoverConsumption[]; applied: boolean; portionsLeft: number }
  | { ok: false; error: 'invalid_portions' | 'not_enough'; portionsLeft: number };

/**
 * Take `portions` out of a batch, once per key. A repeated key is a no-op that reports `applied: false` (so "mark eaten" is
 * safe to retry, and offline replays never double count). Taking more than is left is refused, never clamped silently.
 */
export function consume(
  batch: Pick<LeftoverBatch, 'id' | 'portionsMade'>,
  consumptions: readonly LeftoverConsumption[],
  input: { key: string; portions: number; kind?: ConsumptionKind },
): ConsumeResult {
  const left = portionsLeft(batch, consumptions);
  if (!Number.isInteger(input.portions) || input.portions < 1 || input.portions > MAX_PORTIONS || !input.key) return { ok: false, error: 'invalid_portions', portionsLeft: left };
  if (consumptions.some((c) => c.batchId === batch.id && c.key === input.key)) return { ok: true, consumptions: [...consumptions], applied: false, portionsLeft: left };
  if (input.portions > left) return { ok: false, error: 'not_enough', portionsLeft: left };
  const next = [...consumptions, { batchId: batch.id, key: input.key, portions: input.portions, kind: input.kind ?? 'eaten' }];
  return { ok: true, consumptions: next, applied: true, portionsLeft: left - input.portions };
}

/** The key a planned meal uses when it is marked eaten. */
export const eatenKey = (planId: string, date: string, mealType: string): string => `plan:${planId}|${date}|${mealType}`;

export interface BatchFromCookInput {
  title: string;
  recipeId?: string | undefined;
  /** Servings eaten tonight (the cook's own servings number). */
  servings: number;
  /** Cooked this many times the servings (1 = no batch). */
  multiplier: number;
  storedIn: StoredIn;
  cookedOn: string;
}

/** "Cook x2": the extra portions become a batch. Returns null when nothing is left over (multiplier 1) or the input is not valid. */
export function batchFromCook(input: BatchFromCookInput, id: string): LeftoverBatch | null {
  const { servings, multiplier } = input;
  if (!Number.isInteger(servings) || servings < 1 || !Number.isInteger(multiplier) || multiplier < 2 || multiplier > MAX_BATCH_MULTIPLIER) return null;
  const portions = servings * (multiplier - 1);
  if (portions < 1 || portions > MAX_PORTIONS) return null;
  const title = input.title.trim().slice(0, 120);
  if (!title) return null;
  return { id, title, ...(input.recipeId ? { recipeId: input.recipeId } : {}), portionsMade: portions, storedIn: input.storedIn, cookedOn: input.cookedOn, useBy: defaultUseBy(input.cookedOn, input.storedIn) };
}

export type FreezeResult = { ok: true; batch: LeftoverBatch } | { ok: false; error: 'already_frozen' | 'past_use_by' };

/** Move to the freezer: allowed only while still in date (you cannot freeze food that is past its fridge use-by). */
export function moveToFreezer(batch: LeftoverBatch, today: string): FreezeResult {
  if (batch.storedIn === 'freezer') return { ok: false, error: 'already_frozen' };
  if (today > batch.useBy) return { ok: false, error: 'past_use_by' };
  return { ok: true, batch: { ...batch, storedIn: 'freezer', cookedOn: today, useBy: defaultUseBy(today, 'freezer') } };
}

export type BatchStatus = 'ok' | 'use_soon' | 'past_use_by';

/** `use_soon` = within a day (fridge) or two weeks (freezer) of the use-by. */
export function batchStatus(batch: Pick<LeftoverBatch, 'storedIn' | 'useBy'>, today: string): BatchStatus {
  const left = daysBetweenIso(today, batch.useBy);
  if (left < 0) return 'past_use_by';
  return left <= (batch.storedIn === 'fridge' ? 1 : 14) ? 'use_soon' : 'ok';
}

export interface PlannedLeftover { batchId: string; portions: number; date: string; mealType: string; eaten: boolean }

/** Portions already promised to plan slots that have not been eaten yet (what suggestions and checks must not hand out twice). */
export function plannedPortions(planned: readonly PlannedLeftover[], batchId: string): number {
  return planned.filter((p) => p.batchId === batchId && !p.eaten).reduce((n, p) => n + p.portions, 0);
}

export interface OpenLeftoverSlot { date: string; mealType: string }

export interface LeftoverSuggestion {
  batchId: string;
  title: string;
  storedIn: StoredIn;
  portions: number;
  date: string;
  mealType: string;
  /** "Freezer meal: Chilli, 2 portions" / "Leftovers: Chilli, 2 portions (use by Fri 23 Oct)". */
  label: string;
  /** Why this slot (busy evening, use-by, plain open slot). */
  reason: string;
}

export interface SuggestInput {
  batches: readonly LeftoverBatch[];
  consumptions: readonly LeftoverConsumption[];
  planned: readonly PlannedLeftover[];
  openSlots: readonly OpenLeftoverSlot[];
  /** Dates flagged busy (merged): freezer meals go there first. */
  busyDates: readonly string[];
  today: string;
  /** Portions to put in one slot (people at the table); the last slot of a batch may get fewer. */
  portionsPerSlot: number;
}

const fmtDay = (iso: string): string => isoToUtc(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const plural = (n: number): string => `${n} portion${n === 1 ? '' : 's'}`;

/**
 * Suggest which open plan slots could take which batch. Only portions not already promised to a slot are offered; fridge
 * batches go first (soonest use-by first, never past their date), freezer batches fill the rest, preferring busy evenings.
 * One suggestion per slot. A batch past its use-by is never suggested.
 */
export function suggestLeftoverSlots(input: SuggestInput): LeftoverSuggestion[] {
  const busy = new Set(input.busyDates);
  const slots = [...input.openSlots]
    .filter((s) => s.mealType !== 'snack' && s.date >= input.today)
    .sort((a, b) => a.date.localeCompare(b.date) || a.mealType.localeCompare(b.mealType));
  const taken = new Set<string>();
  const out: LeftoverSuggestion[] = [];
  const per = Math.max(1, Math.floor(input.portionsPerSlot));
  const batches = input.batches
    .filter((b) => b.useBy >= input.today)
    .map((b) => ({ b, free: portionsLeft(b, input.consumptions) - plannedPortions(input.planned, b.id) }))
    .filter((x) => x.free > 0)
    .sort((x, y) => (x.b.storedIn === y.b.storedIn ? x.b.useBy.localeCompare(y.b.useBy) : x.b.storedIn === 'fridge' ? -1 : 1));
  for (const { b, free } of batches) {
    let left = free;
    const eligible = slots.filter((s) => (b.storedIn === 'fridge' ? s.date <= b.useBy : true));
    const ordered = b.storedIn === 'freezer' ? [...eligible.filter((s) => busy.has(s.date)), ...eligible.filter((s) => !busy.has(s.date))] : eligible;
    for (const s of ordered) {
      if (left <= 0) break;
      const key = `${s.date}|${s.mealType}`;
      if (taken.has(key)) continue;
      const p = Math.min(per, left);
      taken.add(key);
      left -= p;
      const base = b.storedIn === 'freezer' ? `Freezer meal: ${b.title}, ${plural(p)}` : `Leftovers: ${b.title}, ${plural(p)}`;
      out.push({
        batchId: b.id, title: b.title, storedIn: b.storedIn, portions: p, date: s.date, mealType: s.mealType,
        label: b.storedIn === 'fridge' ? `${base} (use by ${fmtDay(b.useBy)})` : base,
        reason: busy.has(s.date) ? 'A busy evening: nothing to cook' : b.storedIn === 'fridge' ? `Eat before ${fmtDay(b.useBy)}` : 'An open slot',
      });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.mealType.localeCompare(b.mealType));
}

export type PlacementCheck = { ok: true } | { ok: false; message: string };

/**
 * May `portions` of a batch go in a slot? `alreadyPlanned` = portions of this batch in OTHER unconsumed slots. Refuses a batch
 * that is past its use-by on the slot's date (fridge) and more portions than remain after the other slots.
 */
export function checkPlacement(batch: LeftoverBatch, left: number, alreadyPlanned: number, portions: number, slotDate: string): PlacementCheck {
  if (!Number.isInteger(portions) || portions < 1 || portions > MAX_PORTIONS) return { ok: false, message: 'Portions must be a whole number of at least 1.' };
  if (batch.storedIn === 'fridge' && slotDate > batch.useBy) return { ok: false, message: `${batch.title} should be eaten or frozen by ${fmtDay(batch.useBy)}.` };
  if (portions + alreadyPlanned > left) return { ok: false, message: `Only ${plural(Math.max(0, left - alreadyPlanned))} of ${batch.title} left to plan.` };
  return { ok: true };
}
