// Who is calling the kids' mode service (P3-A, D425), and the standard JSON envelope for its results.
import 'server-only';
import type { NextResponse } from 'next/server';
import { apiError, json } from '../api/bearer-route';
import type { RequestAuth } from '../auth/request-auth';
import { requireHouseholdContext } from '../auth/household-context';
import type { KidsError, KidsResult } from '../../kids/types';
import type { KidsCaller } from './service';

export const kidsCallerOf = (auth: RequestAuth): KidsCaller => ({
  householdId: auth.householdId, userId: auth.userId, client: auth.dataContext?.client ?? null, readOnly: auth.readOnly,
});

export async function webKidsCaller(): Promise<KidsCaller> {
  const ctx = await requireHouseholdContext();
  return { householdId: ctx.household.id, userId: ctx.user.id, client: ctx.mode === 'supabase' ? ctx.supabase : null, readOnly: ctx.readOnly };
}

const STATUS: Record<KidsError, number> = { invalid_input: 422, forbidden: 403, read_only: 403, not_found: 404, round_closed: 409, rate_limited: 429, unknown: 500 };

export function respondKids<T extends object>(r: KidsResult<T>): NextResponse {
  if (r.ok) {
    const rest: Record<string, unknown> = { ...r };
    delete rest.ok;
    return json(rest);
  }
  return apiError(STATUS[r.error], r.error.toUpperCase(), r.message, r.error === 'unknown');
}
