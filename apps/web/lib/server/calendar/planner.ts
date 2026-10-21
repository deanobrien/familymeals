// What the planner reads from calendar-aware planning (P2-C, D413): the household's busy flags for the plan's dates, merged
// across sources and turned into quick-meal / skip dates. Runs inside a verified data context (planner, bearer routes).
// Advisory input: a failure returns "no busy days" rather than failing a plan.
import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { addCivilDays, busyAdjustments, busyLabel, mergeBusyDays, parseIsoDate, toIsoDate, type BusyDay } from '@fr/engine/calendar';
import type { BusyResolution } from '@fr/plan-orchestrator';
import { getDataContext, useSupabaseBackend } from '../supabase/backend';
import type { BusyDayView } from '../../calendar/types';
import { MemoryCalendarStore, SupabaseCalendarStore, type CalendarStore } from './store';

export async function busyDaysForPlanner(householdId: string, from: string, to: string): Promise<BusyDay[]> {
  try {
    const store: CalendarStore = useSupabaseBackend() ? new SupabaseCalendarStore((await getDataContext()).client) : new MemoryCalendarStore();
    return await store.busyBetween(householdId, from, to);
  } catch {
    return [];
  }
}

/** The orchestrator's `busy` dependency. */
export async function resolveBusy(householdId: string, _weekStart: string, dates: string[]): Promise<BusyResolution> {
  if (dates.length === 0) return { quickDates: [], skipDates: [], days: [] };
  const days = await busyDaysForPlanner(householdId, dates[0]!, dates[dates.length - 1]!);
  const adj = busyAdjustments(days, dates);
  const wanted = new Set(dates);
  return {
    quickDates: adj.quickDates,
    skipDates: adj.skipDates,
    days: mergeBusyDays(days).filter((d) => wanted.has(d.date)).map((d) => ({ date: d.date, skip: d.skip, minutesAvailable: d.minutesAvailable, sources: d.sources })),
  };
}

/** The signed-in user's Supabase client inside a verified data context; null in the in-memory demo. */
export async function contextClient(): Promise<SupabaseClient | null> {
  try {
    return useSupabaseBackend() ? (await getDataContext()).client : null;
  } catch {
    return null;
  }
}

export const weekEnd = (weekStart: string): string => {
  const c = parseIsoDate(weekStart);
  return c ? toIsoDate(addCivilDays(c, 6)) : weekStart;
};

/** Merged busy evenings for [from, to] (inclusive) as view rows; a failure reads as "none" (advisory input, never fatal). */
export async function loadBusyViews(householdId: string, client: SupabaseClient | null, from: string, to: string): Promise<BusyDayView[]> {
  try {
    const store: CalendarStore = client ? new SupabaseCalendarStore(client) : new MemoryCalendarStore();
    const days = await store.busyBetween(householdId, from, to);
    return mergeBusyDays(days).map((d) => ({ date: d.date, sources: d.sources, minutesAvailable: d.minutesAvailable, skip: d.skip, label: busyLabel(d) }));
  } catch {
    return [];
  }
}
