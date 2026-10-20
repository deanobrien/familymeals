import 'server-only';
import type { NextResponse } from 'next/server';
import { apiError, json } from '../api/bearer-route';
import type { RequestAuth } from '../auth/request-auth';
import type { NotificationCaller, Result } from './service';

export const callerOf = (auth: RequestAuth): NotificationCaller => ({
  householdId: auth.householdId,
  userId: auth.userId,
  client: auth.dataContext?.client ?? null,
  readOnly: auth.readOnly,
});

/** Shared envelope for the /api/notifications/* routes (web fetch with cookies, Android with a Bearer token). */
export function respond<T extends object>(r: Result<T>): NextResponse {
  if (r.ok) {
    const { ok: _ok, ...body } = r as { ok: true } & T;
    return json(body);
  }
  switch (r.error) {
    case 'invalid_input':
      return json({ error: { code: 'INVALID_INPUT', message: 'Some values were not accepted.', retryable: false, fieldErrors: r.fieldErrors ?? {} } }, 422);
    case 'forbidden':
      return apiError(403, 'FORBIDDEN', 'You cannot change this.');
    case 'read_only':
      return apiError(403, 'READ_ONLY', 'This household is read-only while it is pending deletion.');
    case 'rate_limited':
      return apiError(429, 'RATE_LIMITED', 'You just sent one. Wait half a minute and try again.', true);
    case 'not_found':
      return apiError(404, 'NOT_FOUND', 'Not found.');
    default:
      return apiError(500, 'INTERNAL', 'Something went wrong. Please try again.', true);
  }
}
