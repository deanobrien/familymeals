import 'server-only';
import type { HouseholdContext } from '../auth/household-context';
import { LocalImageStore } from '../images/local-store';
import { SupabaseImageStore } from '../images/supabase-store';
import { compositeReader, imageStoreReader, supabaseObjectReader } from '../objects/stores';
import { memoryExportAudit, supabaseExportAudit, type BeginResult, type ExportAudit } from './audit';
import { exportEntries, type ExportRowReader } from './builder';
import { memoryExportRows, supabaseExportRows } from './sources';
import type { ExportScope } from './tables';
import { zipStream } from './zip';

/**
 * Export orchestration for the /api/export routes (DX1). Everything runs as the signed-in user: the user-scoped
 * Supabase client (RLS) for rows and Storage, never the service role. Mock mode exports the demo recipe library.
 */
type Ctx = Pick<HouseholdContext, 'user' | 'household' | 'memberships' | 'supabase' | 'mode' | 'isOwner'>;

function auditFor(ctx: Ctx): ExportAudit {
  if (ctx.mode === 'supabase') return supabaseExportAudit(ctx.supabase);
  return memoryExportAudit(ctx.user.id, {
    isOwner: (hid) => ctx.memberships.some((m) => m.id === hid && m.role === 'owner'),
  });
}

export async function startExport(ctx: Ctx, scope: ExportScope): Promise<BeginResult> {
  if (scope === 'household' && !ctx.isOwner) return { ok: false, reason: 'forbidden' };
  return auditFor(ctx).begin(ctx.household.id, scope);
}

export function exportFileName(now: Date = new Date()): string {
  return `family-recipes-export-${now.toISOString().slice(0, 10).replace(/-/g, '')}.zip`;
}

/** Streams the archive for one of the caller's own unexpired exports, or returns null (caller answers 404). */
export async function downloadExport(ctx: Ctx, id: string): Promise<Response | null> {
  const audit = auditFor(ctx);
  const exp = await audit.open(id);
  if (!exp) return null;
  // Re-check access NOW (membership or ownership may have changed since the export was requested).
  const membership = ctx.memberships.find((m) => m.id === exp.householdId);
  if (!membership || (exp.scope === 'household' && membership.role !== 'owner')) return null;

  const rows: ExportRowReader =
    ctx.mode === 'supabase' ? supabaseExportRows(ctx.supabase) : memoryExportRows({ id: membership.id, name: membership.name });
  // ST1's ImageStore (D190): Supabase Storage as the signed-in user; local files in dev / mock mode.
  const objects =
    ctx.mode === 'supabase'
      ? compositeReader(
          imageStoreReader(new SupabaseImageStore(ctx.supabase, exp.householdId)),
          supabaseObjectReader(ctx.supabase),
          imageStoreReader(new LocalImageStore()),
        )
      : imageStoreReader(new LocalImageStore());
  const { entries, summary } = exportEntries(
    { scope: exp.scope, householdId: exp.householdId, userId: ctx.user.id, email: ctx.user.email, mode: ctx.mode },
    { rows, objects },
  );
  let recorded = false;
  const record = async (ok: boolean, bytes?: number, error?: string) => {
    if (recorded) return;
    recorded = true;
    try {
      await audit.record(id, {
        ok,
        ...(bytes !== undefined ? { bytes } : {}),
        counts: { ...summary.counts, images: summary.images, missing_images: summary.missingImages },
        ...(error ? { error } : {}),
      });
    } catch {
      /* audit failure must not break the download already sent */
    }
  };
  const body = zipStream(entries, {
    onDone: (bytes) => record(true, bytes),
    onError: () => record(false, undefined, 'export build failed'),
  });
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${exportFileName()}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
