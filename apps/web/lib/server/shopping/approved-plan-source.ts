import 'server-only';
import { getRecipeRepository } from '../../recipes/factory';
import type { RecipeRepository } from '../../recipes/repository';
import type { PlanRequirements } from '../../shopping/types';
import { getPlanStore, type MealPlanRepository } from '../plan/repository';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { requirementsForPlan } from './plan-requirements';
import type { RequirementSource } from './requirement-source';

/** Reads the household's APPROVED plan (drafts are refused) and aggregates it over the recipe store. */
export class ApprovedPlanRequirementSource implements RequirementSource {
  constructor(
    private readonly plans: Pick<MealPlanRepository, 'get'>,
    private readonly recipes: Pick<RecipeRepository, 'get'>,
    private readonly catalogue = getIngredientCatalogue(),
  ) {}

  async forPlan(householdId: string, planId: string): Promise<PlanRequirements | null> {
    if (!/^[\w-]{1,64}$/.test(planId)) return null;
    const doc = await this.plans.get(householdId, planId);
    if (!doc || doc.status !== 'approved') return null;
    return requirementsForPlan(doc, this.recipes, this.catalogue);
  }
}

export function getRequirementSource(): RequirementSource {
  return new ApprovedPlanRequirementSource(getPlanStore(), getRecipeRepository());
}
