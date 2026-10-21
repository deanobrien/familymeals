// Planned-week estimate for the spending view (P2-B x P2-C integration). Pure so it is unit-tested without the plan services.
import type { PlannedWeek } from '@fr/engine/money';
import { weekCost } from '../../plan/cost';
import type { PlanDoc, RecipeLite } from '../../plan/types';

/**
 * Leftover / freezer slots (P2-C) need no shopping, so they count as GBP 0 of new spend: a week of only leftovers is a known
 * 0, not "unknown", and they never make the estimate partial. Only recipe meals can be uncosted or partial.
 */
export function plannedWeekFor(doc: Pick<PlanDoc, 'weekStart' | 'entries'>, lite: ReadonlyMap<string, RecipeLite>): PlannedWeek {
  const c = weekCost(doc as PlanDoc, lite);
  const zeroCostSlots = Object.values(doc.entries).filter((e) => e.kind !== 'recipe').length;
  const meals = c.costedMeals + c.uncostedMeals + zeroCostSlots;
  const known = c.costedMeals > 0 || (zeroCostSlots > 0 && c.uncostedMeals === 0);
  return { weekStart: doc.weekStart, pence: known ? c.knownPence : null, partial: c.uncostedMeals > 0 || c.partialMeals > 0, uncostedMeals: c.uncostedMeals, meals };
}
