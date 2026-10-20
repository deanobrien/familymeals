import 'server-only';
import { getHouseholdContext } from '../auth/household-context';
import { bearerToken, resolveBearerHouseholdContext, type BearerDeps } from '../auth/request-auth';
import type { DataContext } from '../supabase/backend';
import { resolveAuthMode } from '../../supabase/env';
import type { ExportContext } from './service';

/**
 * Who is calling an export route: the web session (cookies, the household the session has active) or the Android app
 * (`Authorization: Bearer <supabase access token>`, D322). A Bearer token is verified with the auth server and everything
 * afterwards runs as that user under RLS; `householdId` (POST body) is only ever narrowed to one of THEIR memberships, and the
 * download call (`inferFirst`) is authorised by the export row and the memberships rather than by one household.
 */
export type ExportCaller =
  | { ok: true; ctx: ExportContext; dataContext: DataContext | null }
  | { ok: false; status: 400 | 401 | 403; error: 'unauthenticated' | 'forbidden' | 'invalid_input' };

export async function resolveExportCaller(
  req: Request,
  requestedHouseholdId: string | undefined,
  opts: { inferFirst?: boolean; deps?: BearerDeps } = {},
): Promise<ExportCaller> {
  const token = bearerToken(req.headers.get('authorization'));
  if (token) {
    if (resolveAuthMode() !== 'supabase') return { ok: false, status: 401, error: 'unauthenticated' };
    const who = await resolveBearerHouseholdContext(token, requestedHouseholdId, opts.deps, { inferFirst: opts.inferFirst ?? false });
    if (!who.ok) return { ok: false, status: who.status, error: who.status === 401 ? 'unauthenticated' : who.status === 403 ? 'forbidden' : 'invalid_input' };
    return { ok: true, ctx: who.ctx, dataContext: who.dataContext };
  }
  const ctx = await getHouseholdContext();
  if (!ctx) return { ok: false, status: 401, error: 'unauthenticated' };
  return { ok: true, ctx, dataContext: null };
}
