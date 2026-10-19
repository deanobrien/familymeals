// Supabase-backed sources for the pantry and planner (lane S2, D125, D127):
//   SupabasePurchaseEventSource  pantry purchase feed = the household's purchase_events + what they were for
//   PlanLeftoverSource           open slots from the household's saved plans; cooked batches: none (no schema yet)
//   SupabaseHouseholdProfile     planner Household (members, consented exclusions) + per-member favourites
import 'server-only';
import type { Household, HardExclusion } from '@fr/plan-orchestrator';
import type { CookedBatch, OpenSlot } from '../../pantry/engine';
import { addDays, today } from '../../pantry/engine';
import { slotKey } from '../../plan/ops';
import type { MealType } from '../../plan/types';
import type { MealPlanRepository } from '../plan/repository';
import type { LeftoverSource, PurchaseEventSource, PurchaseRecord } from '../pantry/sources';
import { derivedUuid, eventFromRow } from './shopping-repository';
import { SupabaseRepositoryError, callRpc, isUuid, selectAll, type PgResult, type SupabaseClient } from './rpc';

type Row = Record<string, unknown>;

export class SupabasePurchaseEventSource implements PurchaseEventSource {
  constructor(private readonly client: SupabaseClient, private readonly householdId: string) {}

  async list(householdId: string): Promise<PurchaseRecord[]> {
    if (householdId !== this.householdId) throw new SupabaseRepositoryError('purchases', 'household does not match the session');
    const rows = (await callRpc<Row[]>(this.client, 'household_purchase_records', { p_household_id: householdId })) ?? [];
    return rows.map((r) => {
      const item = (r.item ?? {}) as Row;
      const ingredientId = item.ingredient_id ? String(item.ingredient_id) : undefined;
      return {
        event: eventFromRow((r.event ?? {}) as Row),
        target: { householdId, name: String(item.display_name ?? ''), ...(ingredientId ? { ingredientId } : {}) },
      };
    });
  }
}

/**
 * Leftover planning over the household's real plans. Open slots = (date, meal type) cells of a saved plan, from today
 * for 7 days, that have no entry. Cooked batches are NOT derived: schema v1 records no "cooked" or "portions eaten"
 * facts, and guessing them from planned servings would invent data, so the list is empty until a batch table exists.
 */
export class PlanLeftoverSource implements LeftoverSource {
  constructor(private readonly plans: Pick<MealPlanRepository, 'list'>, private readonly now: () => string) {}

  async listBatches(): Promise<CookedBatch[]> {
    return [];
  }

  async listOpenSlots(householdId: string): Promise<OpenSlot[]> {
    const t = today(this.now());
    const window = new Set(Array.from({ length: 7 }, (_, i) => addDays(t, i)));
    const out: OpenSlot[] = [];
    const seen = new Set<string>();
    for (const doc of await this.plans.list(householdId)) {
      for (let d = 0; d < 7; d++) {
        const date = addDays(doc.weekStart, d);
        if (!window.has(date)) continue;
        for (const mealType of doc.mealTypes as MealType[]) {
          const key = slotKey({ date, mealType });
          if (doc.entries[key] || seen.has(key)) continue;
          seen.add(key);
          out.push({ id: derivedUuid(`${doc.id}:${key}`, 'open-slot'), date, mealType });
        }
      }
    }
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.mealType.localeCompare(b.mealType));
  }
}

/** Shape returned by `planner_household_profile` (migration 001620). */
interface ProfileJson {
  id: string;
  defaultServings?: number;
  weeklyBudgetPence?: number | null;
  members?: Array<{ id: string; displayName: string }>;
  exclusions?: Array<{ name: string; kind: 'allergy' | 'intolerance' | 'avoid' }>;
  withheldExclusions?: number;
}

export interface HouseholdProfile extends Household {
  /** Allergy/intolerance rows withheld because the recorder's consent is no longer active (D125). */
  withheldExclusions: number;
}

const EXCLUSION_KIND: Record<string, HardExclusion['kind']> = { allergy: 'allergy', intolerance: 'dietary', avoid: 'dislike' };

export function profileFromJson(householdId: string, j: ProfileJson | null): HouseholdProfile | null {
  if (!j) return null;
  return {
    id: householdId,
    defaultServings: j.defaultServings ?? 4,
    ...(typeof j.weeklyBudgetPence === 'number' ? { weeklyBudgetPence: j.weeklyBudgetPence } : {}),
    members: (j.members ?? []).map((m) => ({ id: String(m.id), displayName: String(m.displayName) })),
    hardExclusions: (j.exclusions ?? []).map((e) => ({ ingredientName: e.name, kind: EXCLUSION_KIND[e.kind] ?? 'allergy' })),
    withheldExclusions: Number(j.withheldExclusions ?? 0),
  };
}

export class SupabaseHouseholdProfile {
  constructor(private readonly client: SupabaseClient, private readonly householdId: string) {}

  async load(householdId: string): Promise<HouseholdProfile | null> {
    if (householdId !== this.householdId) return null;
    return profileFromJson(householdId, await callRpc<ProfileJson>(this.client, 'planner_household_profile', { p_household_id: householdId }));
  }

  async favourites(householdId: string, memberId: string): Promise<string[]> {
    if (householdId !== this.householdId || !isUuid(memberId)) return [];
    const rows = await selectAll<Row>('recipe_favourites', (from, to) =>
      this.client.from('recipe_favourites').select('recipe_id').eq('household_id', householdId).eq('user_id', memberId).range(from, to) as unknown as PromiseLike<PgResult<Row[]>>);
    return rows.map((r) => String(r.recipe_id));
  }
}
