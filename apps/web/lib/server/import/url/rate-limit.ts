// "Don't scrape in bulk" (P1-B, D372): one page per request, and a modest hourly cap per household and per household+site.
// In-memory sliding window per process: a guard rail for a family app, not a billing control.
const WINDOW_MS = 60 * 60 * 1000;
export const MAX_PER_HOUSEHOLD = 20;
export const MAX_PER_SITE = 8;

const g = globalThis as unknown as { __frUrlImportHits?: Map<string, number[]> };
const hits = (): Map<string, number[]> => (g.__frUrlImportHits ??= new Map());

function recent(key: string, now: number): number[] {
  const list = (hits().get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) hits().set(key, list); else hits().delete(key);
  return list;
}

/** Records the attempt and returns true, or returns false (nothing recorded) when a cap is reached. */
export function allowUrlImport(householdId: string, host: string, now = Date.now()): boolean {
  const hk = `h:${householdId}`;
  const sk = `s:${householdId}:${host}`;
  if (recent(hk, now).length >= MAX_PER_HOUSEHOLD || recent(sk, now).length >= MAX_PER_SITE) return false;
  hits().set(hk, [...recent(hk, now), now]);
  hits().set(sk, [...recent(sk, now), now]);
  if (hits().size > 5000) for (const k of [...hits().keys()].slice(0, 1000)) hits().delete(k);
  return true;
}

export function resetUrlImportLimits(): void {
  hits().clear();
}
