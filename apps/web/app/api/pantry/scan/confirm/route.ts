import { NextResponse } from 'next/server';
import { apiError, badRequest, householdFromBody, readJsonBody, withApi } from '../../../../../lib/server/api/handle';
import { getPantryService } from '../../../../../lib/server/pantry/deps';
import { linkScannedProducts } from '../../../../../lib/server/products/link';
import type { ScanCommitRow } from '../../../../../lib/pantry/scan-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Outcome = { ok: true; message: string; linked: number } | { ok: false; error: string };

/**
 * Double-submit guard (D343). The service's applyScan is not idempotent (a second call adds the stock again), so a
 * caller may send a `submissionId` (an opaque string, one per review): a repeat of the same id for the same household
 * within the window gets the FIRST answer instead of writing again, including while the first is still running.
 * Process memory only: it covers a double tap or a retried request on this instance, not a second server.
 */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REMEMBERED = 500;
const KEY = Symbol.for('fr.pantry.scanConfirm');
type Entry = { at: number; result: Promise<Outcome> };
type G = typeof globalThis & { [KEY]?: Map<string, Entry> };

function memory(): Map<string, Entry> {
  const g = globalThis as G;
  const map = (g[KEY] ??= new Map<string, Entry>());
  const now = Date.now();
  for (const [k, e] of map) if (now - e.at > WINDOW_MS) map.delete(k);
  while (map.size > MAX_REMEMBERED) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
  return map;
}

/**
 * POST { householdId, rows: ScanCommitRow[], submissionId? } -> { ok, message, linked }: the ONLY point where a pantry
 * scan writes (D84). The same service call as the web confirmScanAction, then barcode rows matched to an ingredient
 * link the product (D187; a link failure never fails the add). All rows or none; a refusal answers 422 REFUSED.
 */
export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body) return badRequest('Send a JSON object.');
  if (!Array.isArray(body.rows)) return badRequest('Send the reviewed rows as "rows".');
  const rows = body.rows as ScanCommitRow[];
  const submissionId = typeof body.submissionId === 'string' && body.submissionId.trim() ? body.submissionId.trim().slice(0, 100) : undefined;

  return withApi(req, { householdId: householdFromBody(body), write: true }, async (ctx) => {
    const hh = ctx.householdId;
    const run = async (): Promise<Outcome> => {
      const res = await getPantryService(hh).applyScan(hh, rows);
      if (!res.ok) return { ok: false, error: res.error };
      let linked = 0;
      try {
        linked = (await linkScannedProducts(hh, rows)).linked;
      } catch {
        console.warn('pantry scan: product link failed');
      }
      return { ok: true, message: res.message ?? 'Added to your pantry', linked };
    };

    let out: Outcome;
    if (!submissionId) {
      out = await run();
    } else {
      const map = memory();
      const key = `${hh}:${submissionId}`;
      let entry = map.get(key);
      if (!entry) {
        entry = { at: Date.now(), result: run() };
        map.set(key, entry);
      }
      try {
        out = await entry.result;
      } catch (e) {
        map.delete(key);
        throw e;
      }
      // A refused submission wrote nothing: the owner may fix it and send it again under the same id.
      if (!out.ok) map.delete(key);
    }
    return out.ok ? NextResponse.json(out) : apiError(422, 'REFUSED', out.error);
  });
}
