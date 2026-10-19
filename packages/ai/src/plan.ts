import { PlanConstraintsSchema, type PlanConstraints, type PlanRequest } from '@fr/domain';
import type { HouseholdContext } from './schemas.js';

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Completes the model's PlanRequest into the canonical PlanConstraints (DECISIONS D130/D131): adds the start date
 * (context, else today), defaults `days` to 7 and forces the household's hard exclusions into `excludeTerms`
 * in code (the model is never trusted to repeat them). Server-resolved fields (excludeIngredientIds,
 * allergenGroups) stay empty here; the orchestrator fills them from the ingredient catalogue.
 */
export function planRequestToConstraints(request: PlanRequest, ctx: HouseholdContext = {}): PlanConstraints {
  const seen = new Set<string>();
  const excludeTerms: string[] = [];
  for (const t of [...request.excludeTerms, ...(ctx.exclusions ?? [])]) {
    const k = t.trim().toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    excludeTerms.push(t.trim());
  }
  return PlanConstraintsSchema.parse({
    ...request,
    startDate: ctx.startDate ?? today(),
    days: request.days ?? 7,
    excludeTerms,
  });
}
