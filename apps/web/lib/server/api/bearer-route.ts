import 'server-only';
import { NextResponse } from 'next/server';
import { resolveRequestAuth, type RequestAuth } from '../auth/request-auth';
import { runWithDataContext } from '../supabase/request-data-context';

/**
 * Plumbing shared by the bearer-capable JSON routes the Android app calls (D102, D213): verify the caller, refuse
 * writes on a read-only household, and run ALL of the route's work inside the caller's verified data context.
 * Routes built on this must never call getAppContext() / requireHouseholdContext() / getHouseholdContext(): they read
 * cookies and redirect, which a bearer caller does not have.
 */

const NO_STORE = { 'cache-control': 'private, no-store' };

export function json(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function apiError(status: number, code: string, message: string, retryable = false): NextResponse {
  return json({ error: { code, message, retryable } }, status);
}

export const badRequest = (message: string) => apiError(400, 'BAD_REQUEST', message);
export const notFound = (message = 'Not found.') => apiError(404, 'NOT_FOUND', message);

/** The JSON body, or `undefined` when it is missing / not valid JSON. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    return undefined;
  }
}

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `householdId` from a JSON body (any other type is ignored, as in /api/extract). */
export function bodyHousehold(body: unknown): string | undefined {
  return isRecord(body) && typeof body.householdId === 'string' ? body.householdId : undefined;
}

export function queryHousehold(req: Request): string | undefined {
  return new URL(req.url).searchParams.get('householdId') ?? undefined;
}

export interface GuardOptions {
  /** A write: refused (403 READ_ONLY) while the household is pending deletion. */
  write?: boolean;
}

/**
 * Authenticate, then run `fn` inside the caller's data context. Unexpected failures answer a retryable 500 (logged
 * without the request body).
 */
export async function guarded(
  req: Request,
  householdId: string | undefined,
  opts: GuardOptions,
  fn: (auth: RequestAuth) => Promise<NextResponse>,
): Promise<NextResponse> {
  // JSON only for bodies: a cross-site form post (text/plain, urlencoded) cannot be made to look like one without a CORS
  // preflight (the same rule as POST /api/products).
  if ((req.method === 'POST' || req.method === 'PUT') && !(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return apiError(415, 'BAD_REQUEST', 'Send application/json.');
  }
  const who = await resolveRequestAuth(req, householdId);
  if (!who.ok) {
    return apiError(who.status, who.status === 401 ? 'UNAUTHENTICATED' : who.status === 403 ? 'FORBIDDEN' : 'BAD_REQUEST', who.message);
  }
  if (opts.write && who.auth.readOnly) {
    return apiError(403, 'READ_ONLY', 'This household is read-only while it is pending deletion.');
  }
  try {
    return await runWithDataContext(who.auth.dataContext, () => fn(who.auth));
  } catch (err) {
    console.error(`${new URL(req.url).pathname}: unexpected failure`, err instanceof Error ? err.message : 'unknown');
    return apiError(500, 'INTERNAL', 'Something went wrong. Please try again.', true);
  }
}
