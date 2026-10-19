import type { PlanDoc } from '../../plan/types';
import { createSupabaseMealPlanRepository, useSupabaseBackend } from '../supabase/backend';

/** Persistence for plans. One plan per household per week. Supabase: SupabaseMealPlanRepository (D50, D54). */
export interface MealPlanRepository {
  getByWeek(householdId: string, weekStart: string): Promise<PlanDoc | null>;
  get(householdId: string, id: string): Promise<PlanDoc | null>;
  /** Upsert; replaces any other plan for the same household + week. */
  save(doc: PlanDoc): Promise<void>;
  list(householdId: string): Promise<PlanDoc[]>;
}

export class InMemoryMealPlanRepository implements MealPlanRepository {
  private readonly byWeek = new Map<string, PlanDoc>();
  private key = (h: string, w: string) => `${h}|${w}`;
  async getByWeek(h: string, w: string) {
    const d = this.byWeek.get(this.key(h, w));
    return d ? structuredClone(d) : null;
  }
  async get(h: string, id: string) {
    for (const d of this.byWeek.values()) if (d.householdId === h && d.id === id) return structuredClone(d);
    return null;
  }
  async save(doc: PlanDoc) {
    // an id can only live in one week: drop its previous week entry if it moved
    for (const [k, d] of this.byWeek) if (d.id === doc.id) this.byWeek.delete(k);
    this.byWeek.set(this.key(doc.householdId, doc.weekStart), structuredClone(doc));
  }
  async list(h: string) {
    return [...this.byWeek.values()]
      .filter((d) => d.householdId === h)
      .sort((a, b) => b.weekStart.localeCompare(a.weekStart))
      .map((d) => structuredClone(d));
  }
}

const g = globalThis as { __frPlanStore?: MealPlanRepository };

/** The one plan store (globalThis so Next dev's separate RSC/action module graphs share state). */
export function getPlanStore(): MealPlanRepository {
  return (g.__frPlanStore ??= new InMemoryMealPlanRepository());
}

export function resetPlanStore(): void {
  g.__frPlanStore = undefined;
}

const gs = globalThis as { __frPlanStoreSupabase?: MealPlanRepository };

/**
 * The plan repository every reader should use (planner, shopping requirement source, shopping page): Supabase when
 * DATA_BACKEND=supabase is usable, else the one in-memory plan store.
 */
export function getMealPlanStore(): MealPlanRepository {
  if (!useSupabaseBackend()) return getPlanStore();
  return (gs.__frPlanStoreSupabase ??= createSupabaseMealPlanRepository());
}
