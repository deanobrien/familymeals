// Shared plumbing for the planner JSON API the Android app uses (D341). Every route wraps the same handlers the server
// actions call (lib/server/plan/handlers.ts); this file only turns their results into HTTP and validates the shape of
// a client-supplied plan before the handlers see it (they re-check the content: household, week, exclusions).
import 'server-only';
import type { NextResponse } from 'next/server';
import { apiError, badRequest, householdFromBody, isObj, readJsonBody, withApi, type ApiBody, type ApiCtx } from '../api/handle';
import { MEAL_TYPES, type MealType, type PlanDoc, type PlanEntry } from '../../plan/types';
import { loadPlanServices, type PlanServices } from './services';

interface Failure { message: string; code?: string; violations?: string[]; gaps?: unknown; unmet?: unknown }

const STATUS_BY_CODE: Record<string, number> = {
  EMPTY_PROMPT: 400, PROMPT_TOO_LONG: 400, BAD_WEEK: 400, INVALID_REQUEST: 400,
  HOUSEHOLD_NOT_FOUND: 404, AI_UNAVAILABLE: 503,
};

/** A refused action (validation, hard exclusion, unapproved plan, no viable candidates...) as the standard error envelope. */
export function failureResponse(f: Failure): NextResponse {
  const code = f.code ?? 'PLAN_REFUSED';
  const status = STATUS_BY_CODE[code] ?? 422;
  const extra: Record<string, unknown> = {};
  if (f.violations?.length) extra.violations = f.violations;
  if (f.gaps) extra.gaps = f.gaps;
  if (f.unmet) extra.unmet = f.unmet;
  return apiError(status, code, f.message, extra, code === 'AI_UNAVAILABLE');
}

const str = (v: unknown): v is string => typeof v === 'string';

function readEntry(v: unknown): PlanEntry | null {
  if (!isObj(v)) return null;
  const note = str(v.note) ? { note: v.note.slice(0, 200) } : {};
  if (v.kind === 'recipe') {
    return str(v.recipeId) && typeof v.servings === 'number' ? { kind: 'recipe', recipeId: v.recipeId, servings: v.servings, ...note } : null;
  }
  return v.kind === 'eating_out' || v.kind === 'leftovers' ? { kind: v.kind, ...note } : null;
}

/** Shape-check a client plan (types only; the handlers validate household, week, servings and exclusions). Null = malformed. */
export function readPlanDoc(v: unknown): PlanDoc | null {
  if (!isObj(v) || !str(v.id) || !str(v.householdId) || !str(v.weekStart) || !isObj(v.entries) || !Array.isArray(v.mealTypes)) return null;
  const mealTypes = v.mealTypes.filter((m): m is MealType => MEAL_TYPES.includes(m as MealType));
  if (mealTypes.length !== v.mealTypes.length) return null;
  const entries: Record<string, PlanEntry> = {};
  for (const [k, e] of Object.entries(v.entries)) {
    const entry = readEntry(e);
    if (!entry) return null;
    entries[k] = entry;
  }
  return {
    id: v.id, householdId: v.householdId, weekStart: v.weekStart, mealTypes, entries,
    status: v.status === 'approved' ? 'approved' : 'draft',
    ...(typeof v.budgetPence === 'number' ? { budgetPence: v.budgetPence } : {}),
    ...(str(v.prompt) ? { prompt: v.prompt.slice(0, 1500) } : {}),
    ...(str(v.proposalId) ? { proposalId: v.proposalId } : {}),
    updatedAt: str(v.updatedAt) ? v.updatedAt : new Date().toISOString(),
  };
}

/** POST wrapper: JSON body -> auth for the body's household -> planner services -> `fn`. */
export async function planPost(
  req: Request,
  opts: { write: boolean },
  fn: (ctx: ApiCtx, svc: PlanServices, body: ApiBody) => Promise<Response>,
): Promise<Response> {
  const body = await readJsonBody(req);
  if (!body) return badRequest('Send a JSON object.');
  return withApi(req, { householdId: householdFromBody(body), write: opts.write }, async (ctx) => fn(ctx, await loadPlanServices(ctx.householdId), body));
}
