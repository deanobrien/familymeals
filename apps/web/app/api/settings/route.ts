import { NextResponse } from 'next/server';
import { apiError, bodyHousehold, guarded, isRecord, json, queryHousehold, readJson } from '../../../lib/server/api/bearer-route';
import { loadSettings, removeAllDietary, saveDietary, savePreferences, withdrawConsent, type SettingsCaller, type SettingsResult } from '../../../lib/server/settings/service';
import type { RequestAuth } from '../../../lib/server/auth/request-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const callerOf = (auth: RequestAuth): SettingsCaller => ({
  householdId: auth.householdId,
  userId: auth.userId,
  client: auth.dataContext?.client ?? null,
  readOnly: auth.readOnly,
});

function respond(r: SettingsResult): NextResponse {
  if (r.ok) return json({ settings: r.settings });
  switch (r.error) {
    case 'invalid_input':
      return json({ error: { code: 'INVALID_INPUT', message: 'Some values were not accepted.', retryable: false, fieldErrors: r.fieldErrors ?? {} } }, 422);
    case 'forbidden':
      return apiError(403, 'FORBIDDEN', 'Only a household owner can change this.');
    case 'read_only':
      return apiError(403, 'READ_ONLY', 'This household is read-only while it is pending deletion.');
    default:
      return apiError(500, 'INTERNAL', 'Something went wrong. Please try again.', true);
  }
}

/** GET /api/settings?householdId -> { settings } (Bearer or cookie). Same module as the web Settings page (D350). */
export async function GET(req: Request) {
  return guarded(req, queryHousehold(req), {}, async (auth) => respond(await loadSettings(callerOf(auth))));
}

/**
 * POST /api/settings { householdId?, action, ... } -> { settings }
 *  action 'preferences' { defaultServings, weeklyBudget (pounds string), currency?, locale?, units? } (owner)
 *  action 'dietary' { tags: string[], consent: boolean }   action 'withdraw_consent'   action 'remove_all'
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), { write: true }, async (auth) => {
    if (!isRecord(body) || typeof body.action !== 'string') return apiError(400, 'BAD_REQUEST', 'Send { action } as JSON.');
    const caller = callerOf(auth);
    switch (body.action) {
      case 'preferences':
        // Units and locale are display-only and stay on the device; the form schema still wants them, so default them.
        return respond(await savePreferences(caller, { currency: 'GBP', locale: 'en-GB', units: 'metric', ...body, weeklyBudget: body.weeklyBudget ?? '' }));
      case 'dietary':
        return respond(await saveDietary(caller, { tags: body.tags, consent: body.consent === true }));
      case 'withdraw_consent':
        return respond(await withdrawConsent(caller));
      case 'remove_all':
        return respond(await removeAllDietary(caller));
      default:
        return apiError(400, 'BAD_REQUEST', 'Unknown action.');
    }
  });
}
