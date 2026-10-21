// Leftovers and batch cooking service (P2-C, D416-D419). One module, two callers: web server actions and the bearer route
// /api/leftovers (Android). The ledger rules are the pure `@fr/engine/leftovers` module; this file only loads, validates and
// persists. Portions are never a stored balance: left = made - ledger, and each take carries an idempotency key.
import 'server-only';
import {
  batchFromCook, batchStatus, checkPlacement, consume, defaultUseBy, eatenKey, moveToFreezer, plannedPortions, portionsLeft,
  suggestLeftoverSlots, MAX_PORTIONS, type LeftoverBatch, type LeftoverConsumption, type PlannedLeftover, type StoredIn,
} from '@fr/engine/leftovers';
import { isIsoDate, weekDates } from '../../plan/dates';
import { parseKey } from '../../plan/ops';
import type { PlanDoc } from '../../plan/types';
import { getDataContext, useSupabaseBackend } from '../supabase/backend';
import type { CookingCaller } from '../cooking/service';
import type { MealPlanRepository } from '../plan/repository';
import { LEFTOVER_ERROR_MESSAGE, type BatchView, type LeftoverError, type LeftoverResult, type LeftoversView } from '../../leftovers/types';
import { LeftoverStoreError, MemoryLeftoverStore, SupabaseLeftoverStore, type LeftoverStore } from './store';

export type LeftoverCaller = Pick<CookingCaller, 'householdId' | 'userId' | 'client' | 'readOnly'>;

export const storeFor = (caller: Pick<LeftoverCaller, 'client'>): LeftoverStore => (caller.client ? new SupabaseLeftoverStore(caller.client) : new MemoryLeftoverStore());

const err = (error: LeftoverError): { ok: false; error: LeftoverError; message: string } => ({ ok: false, error, message: LEFTOVER_ERROR_MESSAGE[error] });
const mapErr = (e: unknown): { ok: false; error: LeftoverError; message: string } => err(e instanceof LeftoverStoreError ? e.code : 'unknown');

const todayOf = (given?: unknown): string => {
  const server = new Date().toISOString().slice(0, 10);
  if (!isIsoDate(given)) return server;
  const diff = Math.abs(Date.parse(`${given}T00:00:00Z`) - Date.parse(`${server}T00:00:00Z`)) / 86_400_000;
  return diff <= 2 ? given : server; // the device's local date, but never far from the server's
};

const fmtDay = (iso: string): string => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Leftover slots in saved plans: planned (promised) portions per batch, and which are already eaten. */
export function plannedLeftovers(docs: readonly PlanDoc[], consumptions: readonly LeftoverConsumption[]): PlannedLeftover[] {
  const out: PlannedLeftover[] = [];
  for (const d of docs) {
    for (const [key, e] of Object.entries(d.entries)) {
      if (e.kind !== 'leftovers' || !e.batchId) continue;
      const s = parseKey(key);
      const k = eatenKey(d.id, s.date, s.mealType);
      out.push({ batchId: e.batchId, portions: e.portions ?? 1, date: s.date, mealType: s.mealType, eaten: consumptions.some((c) => c.batchId === e.batchId && c.key === k) });
    }
  }
  return out;
}

export function batchView(b: LeftoverBatch, consumptions: readonly LeftoverConsumption[], planned: readonly PlannedLeftover[], today: string): BatchView {
  const left = portionsLeft(b, consumptions);
  const promised = plannedPortions(planned, b.id);
  return {
    id: b.id, title: b.title, ...(b.recipeId ? { recipeId: b.recipeId } : {}), storedIn: b.storedIn, portionsMade: b.portionsMade, portionsLeft: left,
    portionsPlanned: promised, portionsFree: Math.max(0, left - promised), cookedOn: b.cookedOn, useBy: b.useBy, status: batchStatus(b, today),
    useByLabel: `${b.storedIn === 'fridge' ? 'Use by' : 'Best by'} ${fmtDay(b.useBy)}`,
  };
}

export interface ViewInput {
  today?: unknown;
  /** The plan week on screen: its empty slots are where suggestions can go. */
  weekDoc?: PlanDoc | null;
  plans: Pick<MealPlanRepository, 'list'>;
  busyDates?: readonly string[];
  portionsPerSlot?: number;
}

/** Batches with portions left (fridge first, soonest use-by first) and slot suggestions for the week on screen. */
export async function loadLeftovers(caller: Pick<LeftoverCaller, 'householdId' | 'client'>, input: ViewInput): Promise<LeftoversView> {
  try {
    const store = storeFor(caller);
    const today = todayOf(input.today);
    const [batches, consumptions, docs] = await Promise.all([store.listBatches(caller.householdId), store.listConsumptions(caller.householdId), input.plans.list(caller.householdId)]);
    const planned = plannedLeftovers(docs, consumptions);
    const views = batches
      .map((b) => batchView(b, consumptions, planned, today))
      .filter((v) => v.portionsLeft > 0)
      .sort((a, b) => (a.storedIn === b.storedIn ? a.useBy.localeCompare(b.useBy) : a.storedIn === 'fridge' ? -1 : 1));
    const openSlots = input.weekDoc ? weekDates(input.weekDoc.weekStart).flatMap((date) => input.weekDoc!.mealTypes.filter((m) => !input.weekDoc!.entries[`${date}|${m}`]).map((mealType) => ({ date, mealType }))) : [];
    const suggestions = suggestLeftoverSlots({ batches, consumptions, planned, openSlots, busyDates: input.busyDates ?? [], today, portionsPerSlot: input.portionsPerSlot ?? 2 });
    return { batches: views, suggestions, titles: Object.fromEntries(batches.map((b) => [b.id, b.title])) };
  } catch {
    return { batches: [], suggestions: [], titles: {} };
  }
}

export interface CookBatchInput { recipeId: string; title: string; servings: number; multiplier: unknown; storedIn: unknown; cookedId: string; today?: unknown }

/** "Cook x2 / batch" on mark-cooked: the extra portions become a batch, once per cooked event. Null when nothing to record. */
export async function recordBatchFromCook(caller: LeftoverCaller, input: CookBatchInput): Promise<LeftoverBatch | null> {
  const m = input.multiplier;
  if (typeof m !== 'number' || !Number.isInteger(m) || m < 2) return null;
  const storedIn: StoredIn = input.storedIn === 'freezer' ? 'freezer' : 'fridge';
  const batch = batchFromCook({ title: input.title, recipeId: input.recipeId, servings: input.servings, multiplier: m, storedIn, cookedOn: todayOf(input.today) }, crypto.randomUUID());
  if (!batch) return null;
  const res = await storeFor(caller).createBatch(caller.householdId, caller.userId, batch, `cooked:${input.cookedId}`);
  return res.batch;
}

export interface NewBatchInput { title: unknown; portions: unknown; storedIn: unknown; today?: unknown }

/** A batch added by hand (the freezer view's "Add a freezer meal"). */
export async function addBatch(caller: LeftoverCaller, input: NewBatchInput): Promise<LeftoverResult<{ batch: LeftoverBatch }>> {
  if (caller.readOnly) return err('read_only');
  const title = typeof input.title === 'string' ? input.title.trim().slice(0, 120) : '';
  const portions = input.portions;
  if (!title || typeof portions !== 'number' || !Number.isInteger(portions) || portions < 1 || portions > MAX_PORTIONS) return err('invalid_input');
  const storedIn: StoredIn = input.storedIn === 'freezer' ? 'freezer' : 'fridge';
  const today = todayOf(input.today);
  try {
    const batch: LeftoverBatch = { id: crypto.randomUUID(), title, portionsMade: portions, storedIn, cookedOn: today, useBy: defaultUseBy(today, storedIn) };
    const res = await storeFor(caller).createBatch(caller.householdId, caller.userId, batch);
    return { ok: true, batch: res.batch };
  } catch (e) {
    return mapErr(e);
  }
}

async function findBatch(store: LeftoverStore, householdId: string, id: unknown): Promise<LeftoverBatch | null> {
  if (typeof id !== 'string') return null;
  return (await store.listBatches(householdId)).find((b) => b.id === id) ?? null;
}

/** "Ate some" / "Threw some away": a manual take with a fresh key (each tap is its own event). */
export async function takePortions(caller: LeftoverCaller, batchId: unknown, portions: unknown, kind: 'eaten' | 'discarded', requestKey?: unknown): Promise<LeftoverResult<{ portionsLeft: number }>> {
  if (caller.readOnly) return err('read_only');
  if (typeof portions !== 'number' || !Number.isInteger(portions) || portions < 1 || portions > MAX_PORTIONS) return err('invalid_input');
  try {
    const store = storeFor(caller);
    const batch = await findBatch(store, caller.householdId, batchId);
    if (!batch) return err('not_found');
    // A client may send its own key so a retried tap is still one event; otherwise each call is a new event.
    const key = typeof requestKey === 'string' && requestKey.length > 0 && requestKey.length <= 100 ? `manual:${requestKey}` : `manual:${crypto.randomUUID()}`;
    const ledger = await store.listConsumptions(caller.householdId);
    const r = consume(batch, ledger, { key, portions, kind });
    if (!r.ok) return err(r.error === 'not_enough' ? 'not_enough' : 'invalid_input');
    if (r.applied) await store.take(caller.householdId, caller.userId, { batchId: batch.id, key, portions, kind });
    return { ok: true, portionsLeft: r.portionsLeft };
  } catch (e) {
    return mapErr(e);
  }
}

export async function freezeBatch(caller: LeftoverCaller, batchId: unknown, today?: unknown): Promise<LeftoverResult<{ batch: LeftoverBatch }>> {
  if (caller.readOnly) return err('read_only');
  try {
    const store = storeFor(caller);
    const batch = await findBatch(store, caller.householdId, batchId);
    if (!batch) return err('not_found');
    const r = moveToFreezer(batch, todayOf(today));
    if (!r.ok) return err(r.error);
    await store.updateStorage(caller.householdId, r.batch);
    return { ok: true, batch: r.batch };
  } catch (e) {
    return mapErr(e);
  }
}

export async function removeBatch(caller: LeftoverCaller, batchId: unknown): Promise<LeftoverResult> {
  if (caller.readOnly) return err('read_only');
  if (typeof batchId !== 'string') return err('invalid_input');
  try {
    await storeFor(caller).deleteBatch(caller.householdId, batchId);
    return { ok: true };
  } catch (e) {
    return mapErr(e);
  }
}

/**
 * "Mark eaten" on a planned leftover meal: takes the slot's portions out of the ledger ONCE (the key is the plan + date +
 * meal type, so a second tap or a replay applies nothing). Other slot kinds are refused.
 */
export async function markPlannedEaten(caller: LeftoverCaller, plans: Pick<MealPlanRepository, 'get'>, planId: unknown, date: unknown, mealType: unknown): Promise<LeftoverResult<{ applied: boolean; portionsLeft: number }>> {
  if (caller.readOnly) return err('read_only');
  if (typeof planId !== 'string' || !isIsoDate(date) || typeof mealType !== 'string') return err('invalid_input');
  try {
    const doc = await plans.get(caller.householdId, planId);
    const entry = doc?.entries[`${date}|${mealType}`];
    if (!doc || !entry || entry.kind !== 'leftovers' || !entry.batchId) return err('not_found');
    const store = storeFor(caller);
    const batch = await findBatch(store, caller.householdId, entry.batchId);
    if (!batch) return err('not_found');
    const key = eatenKey(doc.id, date, mealType);
    const ledger = await store.listConsumptions(caller.householdId);
    const r = consume(batch, ledger, { key, portions: entry.portions ?? 1, kind: 'eaten' });
    if (!r.ok) return err(r.error === 'not_enough' ? 'not_enough' : 'invalid_input');
    if (r.applied) await store.take(caller.householdId, caller.userId, { batchId: batch.id, key, portions: entry.portions ?? 1, kind: 'eaten' });
    return { ok: true, applied: r.applied, portionsLeft: r.portionsLeft };
  } catch (e) {
    return mapErr(e);
  }
}

/** Which slots of a plan (key `date|mealType`) have already been eaten. */
export async function eatenSlotKeys(caller: Pick<LeftoverCaller, 'householdId' | 'client'>, doc: PlanDoc): Promise<string[]> {
  try {
    const ledger = await storeFor(caller).listConsumptions(caller.householdId);
    return Object.entries(doc.entries)
      .filter(([k, e]) => {
        if (e.kind !== 'leftovers' || !e.batchId) return false;
        const s = parseKey(k);
        return ledger.some((c) => c.batchId === e.batchId && c.key === eatenKey(doc.id, s.date, s.mealType));
      })
      .map(([k]) => k);
  } catch {
    return [];
  }
}

/** For the planner (inside a verified data context): the batches + ledger it validates leftover slots against. */
export async function leftoverSnapshotForPlanner(householdId: string): Promise<{ batches: LeftoverBatch[]; consumptions: LeftoverConsumption[] }> {
  try {
    const store: LeftoverStore = useSupabaseBackend() ? new SupabaseLeftoverStore((await getDataContext()).client) : new MemoryLeftoverStore();
    const [batches, consumptions] = await Promise.all([store.listBatches(householdId), store.listConsumptions(householdId)]);
    return { batches, consumptions };
  } catch {
    return { batches: [], consumptions: [] };
  }
}

/** Validation used when a plan with leftover slots is saved or approved (returns problems). */
export function leftoverPlanProblems(doc: PlanDoc, otherDocs: readonly PlanDoc[], batches: readonly LeftoverBatch[], consumptions: readonly LeftoverConsumption[]): string[] {
  const problems: string[] = [];
  const byId = new Map(batches.map((b) => [b.id, b]));
  const here = plannedLeftovers([doc], consumptions);
  const elsewhere = plannedLeftovers(otherDocs.filter((d) => d.id !== doc.id), consumptions);
  for (const [key, e] of Object.entries(doc.entries)) {
    if (e.kind !== 'leftovers' || !e.batchId) continue;
    const s = parseKey(key);
    const batch = byId.get(e.batchId);
    if (!batch) {
      problems.push(`The leftover meal on ${s.date} is no longer in your leftovers.`);
      continue;
    }
    const eaten = here.find((p) => p.date === s.date && p.mealType === s.mealType)?.eaten;
    if (eaten) continue; // already taken out of the ledger: nothing left to promise
    const promisedElsewhere = plannedPortions([...here.filter((p) => !(p.date === s.date && p.mealType === s.mealType)), ...elsewhere], batch.id);
    const check = checkPlacement(batch, portionsLeft(batch, consumptions), promisedElsewhere, e.portions ?? 1, s.date);
    if (!check.ok) problems.push(check.message);
  }
  return problems;
}

