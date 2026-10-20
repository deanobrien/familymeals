// Shared plumbing for the JSON API the Android app uses (D340). A route is: resolve who is calling (web cookie session or
// `Authorization: Bearer <supabase access token>`, D102), refuse writes while the household is pending deletion, then run
// the SAME server module the web server actions call inside `runWithDataContext` (D213) so process-wide stores that look
// up the caller's data context see the verified bearer context instead of reading cookies.
import 'server-only';
import { NextResponse } from 'next/server';
import { resolveRequestAuth, type RequestAuth } from '../auth/request-auth';
import { runWithDataContext } from '../supabase/request-data-context';

export interface ApiCtx {
  householdId: string;
  userId: string;
  readOnly: boolean;
  auth: RequestAuth;
}

export type ApiBody = Record<string, unknown>;

/** `{ error: { code, message, retryable } }`, the same envelope as /api/extract and /api/shopping/scan. */
export function apiError(status: number, code: string, message: string, extra: Record<string, unknown> = {}, retryable = false): NextResponse {
  return NextResponse.json({ error: { code, message, retryable }, ...extra }, { status });
}

export const badRequest = (message: string, status = 400): NextResponse => apiError(status, 'BAD_REQUEST', message);

export const isObj = (v: unknown): v is ApiBody => !!v && typeof v === 'object' && !Array.isArray(v);

/** Parse a JSON object body; null when it is missing, malformed or not an object. */
export async function readJsonBody(req: Request): Promise<ApiBody | null> {
  try {
    const body: unknown = await req.json();
    return isObj(body) ? body : null;
  } catch {
    return null;
  }
}

export interface WithApiOptions {
  /** The household the caller names (query `householdId` or JSON body); only ever narrowed to a membership. */
  householdId?: string | undefined;
  /** A mutating call: refused with 403 while the household is pending deletion. */
  write?: boolean;
}

/**
 * Authenticate, then run `fn` with the caller's context. Any thrown error becomes a generic 500 (nothing from the error
 * is returned: it may carry household data) and is logged by name only.
 */
export async function withApi(req: Request, opts: WithApiOptions, fn: (ctx: ApiCtx) => Promise<Response>): Promise<Response> {
  const who = await resolveRequestAuth(req, opts.householdId);
  if (!who.ok) return apiError(who.status, 'UNAUTHENTICATED', who.message);
  const { auth } = who;
  if (opts.write && auth.readOnly) return apiError(403, 'READ_ONLY', 'This household is read-only while it is pending deletion.');
  const ctx: ApiCtx = { householdId: auth.householdId, userId: auth.userId, readOnly: auth.readOnly, auth };
  try {
    return await runWithDataContext(auth.dataContext, () => fn(ctx));
  } catch (e) {
    console.error('[api] unhandled error', e instanceof Error ? e.name : 'unknown');
    return apiError(500, 'INTERNAL', 'Something went wrong. Please try again.', {}, true);
  }
}

/** Query-string helper: `householdId` from `?householdId=`. */
export const householdFromUrl = (req: Request): string | undefined => new URL(req.url).searchParams.get('householdId') ?? undefined;

/** `householdId` from a JSON body (string only). */
export const householdFromBody = (body: ApiBody | null): string | undefined => (typeof body?.householdId === 'string' ? body.householdId : undefined);
