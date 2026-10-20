import type { SupabaseClient } from '@supabase/supabase-js';
import type { ExportScope } from './tables';

/**
 * Export audit + rate limit (DX1, D250). Supabase: data_export_requests via begin_data_export /
 * record_data_export_download (one non-failed export per user, household and scope per 24 h; link valid 1 h, at most
 * 5 downloads). Memory (demo/e2e): the same rules in process memory.
 */
export const EXPORT_LINK_TTL_MS = 60 * 60 * 1000;
export const EXPORT_RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
export const MAX_DOWNLOADS = 5;

export interface ExportTicket {
  id: string;
  expiresAt: string;
}

export type BeginResult =
  | { ok: true; ticket: ExportTicket }
  | { ok: false; reason: 'rate_limited'; retryAfter: string }
  | { ok: false; reason: 'forbidden' | 'error' };

export interface OpenExport {
  id: string;
  householdId: string;
  scope: ExportScope;
  expiresAt: string;
}

export interface ExportOutcome {
  ok: boolean;
  bytes?: number;
  counts?: Record<string, number>;
  error?: string;
}

export interface ExportAudit {
  begin(householdId: string, scope: ExportScope): Promise<BeginResult>;
  /** The caller's own, unexpired, usable export, else null. */
  open(id: string): Promise<OpenExport | null>;
  record(id: string, outcome: ExportOutcome): Promise<void>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function supabaseExportAudit(client: SupabaseClient): ExportAudit {
  return {
    async begin(householdId, scope) {
      const { data, error } = await client.rpc('begin_data_export', { p_household_id: householdId, p_scope: scope });
      if (error) return { ok: false, reason: error.code === '42501' ? 'forbidden' : 'error' };
      const row = (Array.isArray(data) ? data[0] : data) as
        | { export_id: string | null; expires_at: string | null; allowed: boolean; retry_after: string | null }
        | undefined;
      if (!row) return { ok: false, reason: 'error' };
      if (!row.allowed) return { ok: false, reason: 'rate_limited', retryAfter: row.retry_after ?? new Date(Date.now() + EXPORT_RATE_WINDOW_MS).toISOString() };
      if (!row.export_id || !row.expires_at) return { ok: false, reason: 'error' };
      return { ok: true, ticket: { id: row.export_id, expiresAt: row.expires_at } };
    },
    async open(id) {
      if (!UUID_RE.test(id)) return null;
      const { data, error } = await client
        .from('data_export_requests')
        .select('id, household_id, scope, status, expires_at, download_count')
        .eq('id', id)
        .maybeSingle();
      if (error || !data) return null;
      const r = data as { id: string; household_id: string; scope: ExportScope; status: string; expires_at: string; download_count: number };
      if (r.status === 'failed' || r.download_count >= MAX_DOWNLOADS || new Date(r.expires_at).getTime() <= Date.now()) return null;
      return { id: r.id, householdId: r.household_id, scope: r.scope, expiresAt: r.expires_at };
    },
    async record(id, outcome) {
      await client.rpc('record_data_export_download', {
        p_export_id: id,
        p_ok: outcome.ok,
        p_bytes: outcome.bytes ?? null,
        p_counts: outcome.counts ?? null,
        p_error: outcome.error ? outcome.error.slice(0, 200) : null,
      });
    },
  };
}

interface MemoryRow extends OpenExport {
  userId: string;
  requestedAt: number;
  status: 'ready' | 'downloaded' | 'failed';
  downloads: number;
}

const g = globalThis as unknown as { __frExportAudit?: Map<string, MemoryRow> };
const rows = () => (g.__frExportAudit ??= new Map());

/** Test/dev hook: forget every in-memory export (dev reset). */
export function resetMemoryExportAudit(): void {
  rows().clear();
}

export function memoryExportAudit(userId: string, opts: { isOwner: (householdId: string) => boolean; now?: () => number }): ExportAudit {
  const now = opts.now ?? Date.now;
  return {
    async begin(householdId, scope) {
      if (scope === 'household' && !opts.isOwner(householdId)) return { ok: false, reason: 'forbidden' };
      const t = now();
      const last = [...rows().values()]
        .filter((r) => r.userId === userId && r.householdId === householdId && r.scope === scope && r.status !== 'failed' && t - r.requestedAt < EXPORT_RATE_WINDOW_MS)
        .sort((a, b) => b.requestedAt - a.requestedAt)[0];
      if (last) return { ok: false, reason: 'rate_limited', retryAfter: new Date(last.requestedAt + EXPORT_RATE_WINDOW_MS).toISOString() };
      const id = crypto.randomUUID();
      const expiresAt = new Date(t + EXPORT_LINK_TTL_MS).toISOString();
      rows().set(id, { id, householdId, scope, expiresAt, userId, requestedAt: t, status: 'ready', downloads: 0 });
      return { ok: true, ticket: { id, expiresAt } };
    },
    async open(id) {
      const r = rows().get(id);
      if (!r || r.userId !== userId || r.status === 'failed' || r.downloads >= MAX_DOWNLOADS || new Date(r.expiresAt).getTime() <= now()) return null;
      return { id: r.id, householdId: r.householdId, scope: r.scope, expiresAt: r.expiresAt };
    },
    async record(id, outcome) {
      const r = rows().get(id);
      if (!r || r.userId !== userId) return;
      r.downloads += 1;
      r.status = outcome.ok ? 'downloaded' : 'failed';
    },
  };
}
