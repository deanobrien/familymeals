import { NextResponse } from 'next/server';
import { apiError, bodyHousehold, guarded, isRecord, json, queryHousehold, readJson } from '../../../lib/server/api/bearer-route';
import { loadGoals, saveGoals, withdrawGoals, type GoalsCaller, type GoalsResult } from '../../../lib/server/goals/service';
import type { RequestAuth } from '../../../lib/server/auth/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const callerOf = (auth: RequestAuth): GoalsCaller => ({
  householdId: auth.householdId,
  userId: auth.userId,
  client: auth.dataContext?.client ?? null,
  readOnly: auth.readOnly,
});

function respond(r: GoalsResult): NextResponse {
  if (r.ok) return json({ goals: r.state });
  switch (r.error) {
    case 'invalid_input':
      return json({ error: { code: 'INVALID_INPUT', message: 'Some values were not accepted.', retryable: false, fieldErrors: r.fieldErrors ?? {} } }, 422);
    case 'consent_required':
      return apiError(403, 'CONSENT_REQUIRED', 'Your consent is needed before nutrition goals can be saved.');
    case 'forbidden':
      return apiError(403, 'FORBIDDEN', 'Nutrition goals are not available for this profile.');
    case 'read_only':
      return apiError(403, 'READ_ONLY', 'This household is read-only while it is pending deletion.');
    default:
      return apiError(500, 'INTERNAL', 'Something went wrong. Please try again.', true);
  }
}

/** GET /api/goals?householdId -> { goals } : ONLY the signed-in member's own state (health-related data, own rows only, D430). */
export async function GET(req: Request) {
  return guarded(req, queryHousehold(req), {}, async (auth) => respond(await loadGoals(callerOf(auth))));
}

/**
 * POST /api/goals { householdId?, action, ... } -> { goals }
 *  action 'save'     { goals: GoalId[], portionShare, nudgePlan, consent, adultConfirmed }  (consent + adultConfirmed needed the first time)
 *  action 'withdraw' withdraws consent and DELETES the stored goals (allowed even while the household is read-only)
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  const withdraw = isRecord(body) && body.action === 'withdraw';
  return guarded(req, bodyHousehold(body), { write: !withdraw }, async (auth) => {
    if (!isRecord(body) || typeof body.action !== 'string') return apiError(400, 'BAD_REQUEST', 'Send { action } as JSON.');
    const caller = callerOf(auth);
    switch (body.action) {
      case 'save':
        return respond(await saveGoals(caller, { goals: body.goals, portionShare: body.portionShare, nudgePlan: body.nudgePlan === true, consent: body.consent === true, adultConfirmed: body.adultConfirmed === true }));
      case 'withdraw':
        return respond(await withdrawGoals(caller));
      default:
        return apiError(400, 'BAD_REQUEST', 'Unknown action.');
    }
  });
}
