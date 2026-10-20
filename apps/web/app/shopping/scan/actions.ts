'use server';

import { revalidatePath } from 'next/cache';
import { getAppContext } from '../../../lib/server/context';
import {
  confirmListScan, isBatchId, parseDestination, previewListScan, sanitiseCommitRows, type ApplyEnv,
} from '../../../lib/server/shopping/list-scan-apply';
import { listScanEnv } from '../../../lib/server/shopping/list-scan-env';
import type { ListScanActionResult, ListScanPreview } from '../../../lib/shopping/list-scan-types';

const FAILED = 'Something went wrong. Please try again.';

async function env(): Promise<ApplyEnv & { readOnly: boolean }> {
  const ctx = await getAppContext(); // outside try: lets the auth redirect through
  return { ...listScanEnv(ctx.householdId, ctx.userId), readOnly: ctx.readOnly };
}

/** Review step: what confirming would do to the destination list. Read-only: writes nothing, creates nothing. */
export async function previewShoppingScanAction(
  rows: unknown, destination: unknown, batchId: unknown,
): Promise<ListScanActionResult<{ preview: ListScanPreview }>> {
  const e = await env();
  try {
    const dest = parseDestination(destination, new Date());
    const clean = sanitiseCommitRows(rows, e.cat);
    if (!dest || 'error' in clean || !isBatchId(batchId)) return { ok: false, error: 'error' in clean ? clean.error : 'That request could not be read.' };
    return { ok: true, preview: await previewListScan(e, clean.rows, dest, batchId) };
  } catch {
    return { ok: false, error: FAILED };
  }
}

/**
 * Confirm: the ONLY point where a list scan writes (D264). Idempotent on `batchId`: a double click, a retry after a
 * lost response or a second tab re-sends the same ids and nothing is added twice (D266).
 */
export async function confirmShoppingScanAction(
  rows: unknown, destination: unknown, batchId: unknown,
): Promise<ListScanActionResult<{ message: string; listName: string; created: boolean }>> {
  const e = await env();
  if (e.readOnly) return { ok: false, error: 'This household is read-only while it is pending deletion.' };
  try {
    const dest = parseDestination(destination, new Date());
    const clean = sanitiseCommitRows(rows, e.cat);
    if (!dest || 'error' in clean || !isBatchId(batchId)) return { ok: false, error: 'error' in clean ? clean.error : 'That request could not be read.' };
    const r = await confirmListScan(e, clean.rows, dest, batchId);
    revalidatePath('/shopping');
    return { ok: true, message: r.message, listName: r.listName, created: r.created };
  } catch (err) {
    console.error('[shopping scan] confirm failed', err instanceof Error ? err.message : 'unknown');
    return { ok: false, error: FAILED };
  }
}
