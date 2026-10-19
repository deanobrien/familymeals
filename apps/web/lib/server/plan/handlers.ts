// Framework-free plan operations used by the server actions (app/plan/actions.ts). Testable with injected services.
import { violatesExclusions, type PlannedMeal, type SlotEdit } from '@fr/plan-orchestrator';
import { isIsoDate, mondayOf, weekDates } from '../../plan/dates';
import { emptyDoc, parseKey } from '../../plan/ops';
import { MEAL_TYPES, type ActionResult, type MealType, type PlanDoc, type PlanPageData, type ProposeResult, type RecipeLite } from '../../plan/types';
import type { PlanRecipe } from './recipe-source';
import type { PlanServices } from './services';

export const EXAMPLE_PROMPT =
  "Plan seven dinners for four people. Make roughly half vegetarian, include two fish meals, keep the shopping spend below £100, use Lauren's favourites where possible, avoid mushrooms and include quick meals on busy evenings.";

const fail = (message: string, violations?: string[]): { ok: false; message: string; violations?: string[] } => ({ ok: false, message, ...(violations ? { violations } : {}) });

function toLite(r: PlanRecipe, exclusions: string[]): RecipeLite {
  return {
    id: r.id, title: r.title, dietCategory: r.dietCategory, tags: r.tags, mealTypes: r.mealTypes,
    baseServings: r.baseServings, totalMinutes: r.totalMinutes,
    costPerServingPence: r.costPerServingPence, costKind: r.costPerServingPence == null ? null : 'estimate',
    ...(r.costPartial ? { costPartial: true } : {}),
    nutritionPerServing: r.nutritionPerServing ?? null,
    excludedBy: violatesExclusions(r.ingredientNames, exclusions),
  };
}

export async function getPlanPageData(svc: PlanServices, weekParam?: string): Promise<PlanPageData> {
  const hh = svc.household;
  const weekStart = mondayOf(isIsoDate(weekParam) ? weekParam : svc.now().toISOString().slice(0, 10));
  const exclusions = hh.hardExclusions.map((e) => e.ingredientName);
  const [existing, recipes, all] = await Promise.all([svc.plans.getByWeek(hh.id, weekStart), svc.recipes.list(hh.id), svc.plans.list(hh.id)]);
  return {
    doc: existing ?? emptyDoc(svc.newId(), hh.id, weekStart, ['dinner'], svc.now()),
    isSaved: !!existing,
    recipes: recipes.map((r) => toLite(r, exclusions)),
    saved: all.map((d) => ({ id: d.id, weekStart: d.weekStart, status: d.status })),
    householdExclusions: exclusions,
    defaultServings: hh.defaultServings ?? 4,
    examplePrompt: EXAMPLE_PROMPT,
  };
}

/** Structural validation of a client-supplied plan (never trust the client). Returns problems. */
async function checkDoc(svc: PlanServices, doc: PlanDoc, forApproval: boolean): Promise<string[]> {
  const problems: string[] = [];
  if (doc.householdId !== svc.household.id) problems.push('This plan belongs to a different household.');
  if (!isIsoDate(doc.weekStart) || mondayOf(doc.weekStart) !== doc.weekStart) problems.push('The plan week must start on a Monday.');
  if (!doc.id || typeof doc.id !== 'string') problems.push('The plan has no id.');
  if (!Array.isArray(doc.mealTypes) || doc.mealTypes.length === 0 || doc.mealTypes.some((m) => !MEAL_TYPES.includes(m))) problems.push('Choose at least one valid meal type.');
  if (problems.length) return problems;

  const days = new Set(weekDates(doc.weekStart));
  const ids = new Set<string>();
  for (const [key, e] of Object.entries(doc.entries)) {
    const s = parseKey(key);
    if (!days.has(s.date) || !MEAL_TYPES.includes(s.mealType)) problems.push(`Slot ${key} is outside this week.`);
    if (e.kind === 'recipe') {
      ids.add(e.recipeId);
      if (!Number.isInteger(e.servings) || e.servings < 1 || e.servings > 99) problems.push(`Servings for ${key} must be between 1 and 99.`);
    }
  }
  const found = new Map((await svc.recipes.get(doc.householdId, [...ids])).map((r) => [r.id, r]));
  const exclusions = svc.household.hardExclusions.map((x) => x.ingredientName);
  for (const id of ids) {
    const r = found.get(id);
    if (!r) {
      problems.push(`Recipe ${id} is not in your library.`);
      continue;
    }
    // Allergies/strict exclusions are hard constraints: never plannable, saved or approved.
    const hits = violatesExclusions(r.ingredientNames, exclusions);
    if (hits.length) problems.push(`"${r.title}" contains excluded ingredient(s): ${hits.join(', ')}.`);
  }
  if (forApproval && ![...Object.values(doc.entries)].some((e) => e.kind === 'recipe')) problems.push('Add at least one recipe before approving.');
  return problems;
}

export async function savePlan(svc: PlanServices, doc: PlanDoc): Promise<ActionResult<PlanDoc>> {
  const problems = await checkDoc(svc, doc, false);
  if (problems.length) return fail('This plan cannot be saved.', problems);
  const saved: PlanDoc = { ...doc, status: 'draft', updatedAt: svc.now().toISOString() };
  await svc.plans.save(saved);
  return { ok: true, value: saved };
}

export async function approvePlan(svc: PlanServices, doc: PlanDoc): Promise<ActionResult<PlanDoc>> {
  const problems = await checkDoc(svc, doc, true);
  if (problems.length) return fail('This plan breaks a hard constraint or is incomplete, so it cannot be approved.', problems);

  if (doc.proposalId) {
    // Re-validate through the orchestrator (hard exclusions from DB data + solver.validate), applying the user's grid edits.
    const keys = new Set([...Object.keys(doc.entries), ...weekDates(doc.weekStart).flatMap((d) => doc.mealTypes.map((m) => `${d}|${m}`))]);
    const slotEdits: SlotEdit[] = [...keys].map((k) => {
      const s = parseKey(k);
      const e = doc.entries[k];
      return { date: s.date, mealType: s.mealType, recipeId: e?.kind === 'recipe' ? e.recipeId : null, servings: e?.kind === 'recipe' ? e.servings : undefined };
    });
    const res = await svc.orchestrator.approvePlan(doc.householdId, doc.proposalId, { slotEdits });
    if (!res.ok && res.error.code === 'VALIDATION_FAILED') return fail(res.error.userMessage, res.error.violations);
    // PROPOSAL_NOT_FOUND (e.g. server restarted): the manual validation above already holds.
  }
  const approved: PlanDoc = { ...doc, status: 'approved', proposalId: undefined, updatedAt: svc.now().toISOString() };
  await svc.plans.save(approved);
  return { ok: true, value: approved };
}

export async function proposePlan(svc: PlanServices, prompt: string, weekStart: string): Promise<ProposeResult> {
  const text = prompt.trim();
  if (!text) return { ok: false, code: 'EMPTY_PROMPT', message: 'Describe the week you want and we will propose a plan.' };
  if (text.length > 1500) return { ok: false, code: 'PROMPT_TOO_LONG', message: 'Please keep the request under 1,500 characters.' };
  if (!isIsoDate(weekStart)) return { ok: false, code: 'BAD_WEEK', message: 'That week is not valid.' };
  const res = await svc.orchestrator.proposePlan(svc.household.id, text, mondayOf(weekStart));
  if (res.ok) return { ok: true, proposal: res.value };
  const e = res.error;
  return {
    ok: false,
    code: e.code,
    message: e.userMessage,
    ...(e.code === 'NO_VIABLE_CANDIDATES' ? { gaps: e.gaps.map((g) => ({ date: g.date, mealType: g.mealType as MealType, reason: g.reason })), unmet: e.unmet } : {}),
  };
}

export interface ShoppingHandoff {
  count: number;
  href: string;
  preview: { name: string; quantity: string }[];
}

/** Step 10 of the brief: only invoked from the explicit "Generate shopping list" button on an approved plan. */
export async function generateShopping(svc: PlanServices, planId: string, actor = 'system'): Promise<ActionResult<ShoppingHandoff>> {
  const doc = await svc.plans.get(svc.household.id, planId);
  if (!doc) return fail('That plan could not be found. Save it first.');
  if (doc.status !== 'approved') return fail('Approve the plan before generating a shopping list.');
  const meals: PlannedMeal[] = Object.entries(doc.entries).flatMap(([k, e], i) => {
    if (e.kind !== 'recipe') return [];
    const s = parseKey(k);
    return [{ id: `${doc.id}-${i}`, mealPlanId: doc.id, date: s.date, mealType: s.mealType, recipeId: e.recipeId, servings: e.servings, costPence: null }];
  });
  const reqs = await svc.orchestrator.confirmShopping(doc.householdId, meals);
  await svc.onShoppingRequirements?.(doc.householdId, doc.id, reqs, actor); // creates/updates the shopping list (D33)
  return { ok: true, value: { count: reqs.length, href: `/shopping?plan=${encodeURIComponent(doc.id)}`, preview: reqs.slice(0, 8).map((r) => ({ name: r.displayName, quantity: r.quantityText })) } };
}

export async function loadPlanForWeek(svc: PlanServices, weekStart: string): Promise<PlanDoc | null> {
  return isIsoDate(weekStart) ? svc.plans.getByWeek(svc.household.id, mondayOf(weekStart)) : null;
}

