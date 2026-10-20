import 'server-only';
import { timingSafeEqual, createHash } from 'node:crypto';

type DbError = { message: string } | null;

/** The slice of a service-role supabase-js client the cleanup job uses (structural, so tests can record calls). */
export interface CleanupDb {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: unknown; error: DbError }>;
  storage: { from(bucket: string): { remove(paths: string[]): PromiseLike<{ error: DbError }> } };
  from(table: 'storage_cleanup_queue'): {
    update(values: Record<string, unknown>): { in(column: string, values: string[]): PromiseLike<{ error: DbError }> };
  };
}

interface QueueRow {
  id: string;
  bucket: string;
  object_path: string;
}

export interface CleanupSummary {
  /** Receipts whose photo passed the 90-day retention and was queued for deletion. */
  receiptImagesExpired: number;
  /** Abandoned uploads (older than 24h, unreferenced) newly queued. */
  staleQueued: number;
  /** Objects removed from Storage and marked processed. */
  deleted: number;
  /** Objects whose removal failed (kept in the queue with last_error, retried on the next run, up to 8 attempts). */
  failed: number;
}

export interface CleanupOptions {
  batchSize?: number;
  maxBatches?: number;
  receiptRetentionDays?: number;
  staleAgeHours?: number;
}

function must<T>(res: { data: T; error: DbError }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/**
 * The storage cleanup job (ST1, D190). Order matters:
 *  1. expire confirmed receipts' photos past retention (clears image_paths; the DB trigger queues the objects)
 *  2. queue abandoned uploads older than 24h that no row references
 *  3. claim batches from storage_cleanup_queue (Storage never cascades from row deletes), delete the objects through the
 *     Storage API, then mark the rows processed. A failed bucket call leaves its rows pending with last_error.
 * Call with a SERVICE-ROLE client only from the protected endpoint; never on a user request path.
 */
export async function runStorageCleanup(db: CleanupDb, opts: CleanupOptions = {}): Promise<CleanupSummary> {
  const batch = opts.batchSize ?? 100;
  const maxBatches = opts.maxBatches ?? 10;
  const summary: CleanupSummary = { receiptImagesExpired: 0, staleQueued: 0, deleted: 0, failed: 0 };

  summary.receiptImagesExpired = Number(must(await db.rpc('purge_old_receipt_images', { p_days: opts.receiptRetentionDays ?? 90 }), 'purge_old_receipt_images') ?? 0);
  summary.staleQueued = Number(must(await db.rpc('enqueue_stale_uploads', { p_max_age: `${opts.staleAgeHours ?? 24} hours` }), 'enqueue_stale_uploads') ?? 0);

  for (let n = 0; n < maxBatches; n++) {
    const rows = (must(await db.rpc('claim_storage_cleanup', { p_limit: batch }), 'claim_storage_cleanup') as QueueRow[] | null) ?? [];
    if (rows.length === 0) break;
    const byBucket = new Map<string, QueueRow[]>();
    for (const r of rows) byBucket.set(r.bucket, [...(byBucket.get(r.bucket) ?? []), r]);
    for (const [bucket, group] of byBucket) {
      const ids = group.map((r) => r.id);
      const { error } = await db.storage.from(bucket).remove(group.map((r) => r.object_path));
      if (error) {
        summary.failed += group.length;
        await db.from('storage_cleanup_queue').update({ last_error: error.message.slice(0, 500) }).in('id', ids);
      } else {
        summary.deleted += group.length;
        await db.from('storage_cleanup_queue').update({ processed_at: new Date().toISOString(), last_error: null }).in('id', ids);
      }
    }
    if (rows.length < batch) break;
  }
  return summary;
}

/** Constant-time compare of the presented cron secret with the configured one (hashing equalises the lengths). */
export function cronSecretMatches(presented: string | null | undefined, configured: string | undefined): boolean {
  if (!configured || configured.length < 16 || !presented) return false;
  const a = createHash('sha256').update(presented).digest();
  const b = createHash('sha256').update(configured).digest();
  return timingSafeEqual(a, b);
}
