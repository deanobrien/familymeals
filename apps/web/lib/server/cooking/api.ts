// Plumbing for the cooking JSON routes the Android app uses (P1-A, D366): the same service functions the web server actions
// call, turned into HTTP. Routes built on it use the bearer helper (`guarded`), never cookies.
import 'server-only';
import type { NextResponse } from 'next/server';
import { apiError, json } from '../api/bearer-route';
import type { RequestAuth } from '../auth/request-auth';
import type { CookingCaller, CookingResult } from './service';

export const callerOf = (auth: RequestAuth): CookingCaller => ({
  householdId: auth.householdId,
  userId: auth.userId,
  client: auth.dataContext?.client ?? null,
  readOnly: auth.readOnly,
});

/** A service result as the standard envelope: `{ ...fields }` on success, `{ error: { code, message, retryable } }` otherwise. */
export function respond<T extends object>(r: CookingResult<T>): NextResponse {
  if (r.ok) {
    const { ok: _ok, ...rest } = r;
    return json(rest);
  }
  switch (r.error) {
    case 'not_found':
      return apiError(404, 'NOT_FOUND', 'Recipe not found.');
    case 'forbidden':
      return apiError(403, 'FORBIDDEN', 'You do not have access to that.');
    case 'read_only':
      return apiError(403, 'READ_ONLY', 'This household is read-only while it is pending deletion.');
    case 'invalid_input':
      return json({ error: { code: 'INVALID_INPUT', message: 'Some values were not accepted.', retryable: false, fieldErrors: r.fieldErrors ?? {} } }, 422);
    default:
      return apiError(500, 'INTERNAL', 'Something went wrong. Please try again.', true);
  }
}
