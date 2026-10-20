import 'server-only';
import type { PlanRequirement } from '../../pantry/engine';
import { getPantryService } from '../pantry/deps';
import { defaultIngredientLookup } from '../pantry/ingredients';
import { getMealPlanStore } from '../plan/repository';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { getRequirementSource } from '../shopping/approved-plan-source';
import { getShoppingStore } from '../shopping/store';
import { createSupabaseRestockRepository, useSupabaseBackend } from '../supabase/backend';
import { InMemoryRestockRepository, type RestockRepository } from './repository';
import { createRestockService, type RestockService } from './service';

const MEM = Symbol.for('fr.restock.repository.memory');
const SB = Symbol.for('fr.restock.repository.supabase');
type G = Record<symbol, RestockRepository | undefined>;

/** Supabase (signed-in user, RLS) when DATA_BACKEND=supabase is usable, else a process-wide in-memory repository. */
export function getRestockRepository(): RestockRepository {
  const g = globalThis as unknown as G;
  return useSupabaseBackend() ? (g[SB] ??= createSupabaseRestockRepository()) : (g[MEM] ??= new InMemoryRestockRepository());
}

/** Requirements of the household's latest approved plan; [] when there is none or it cannot be read. */
async function approvedPlanRequirements(householdId: string): Promise<PlanRequirement[]> {
  const approved = (await getMealPlanStore().list(householdId)).find((d) => d.status === 'approved');
  if (!approved) return [];
  const r = await getRequirementSource().forPlan(householdId, approved.id);
  return (r?.requirements ?? []).map((q) => ({
    name: q.displayName, quantity: q.quantity, ...(q.ingredientId ? { ingredientId: q.ingredientId } : {}),
  }));
}

export function getRestockService(householdId: string): RestockService {
  return createRestockService({
    repo: getRestockRepository(),
    pantry: getPantryService(householdId),
    shopping: getShoppingStore(),
    ingredients: defaultIngredientLookup(),
    converter: getIngredientCatalogue().converter,
    planRequirements: approvedPlanRequirements,
    now: () => new Date().toISOString(),
  });
}

/**
 * Auto-add hook for pantry write paths (manual edit, purchase-to-pantry, scan confirm, receipt extras, ...). Never throws:
 * restocking must not fail the pantry write that triggered it.
 */
export async function autoRestockAfterPantryChange(householdId: string, actor: string): Promise<void> {
  try {
    await getRestockService(householdId).autoAdd(householdId, actor);
  } catch {
    console.warn('restock: auto-add failed');
  }
}
