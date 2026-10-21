// UK postcode -> coordinates through postcodes.io (P2-A, D391): free, no key, no account. Only the postcode leaves the
// server (never a household id, user id or any other data). The caller must be a signed-in member; a small per-user limit
// keeps one account from hammering the free service.
import { isValidPoint, normalisePostcode } from '@fr/engine/shopping';

export const POSTCODES_IO = 'https://api.postcodes.io/postcodes';

export type GeocodeResult =
  | { ok: true; postcode: string; lat: number; lng: number; area: string | null }
  | { ok: false; reason: 'invalid' | 'not_found' | 'unavailable' };

type FetchLike = (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function lookupPostcode(raw: string, fetchImpl: FetchLike = fetch as unknown as FetchLike, timeoutMs = 6000): Promise<GeocodeResult> {
  const postcode = normalisePostcode(raw);
  if (!postcode) return { ok: false, reason: 'invalid' };
  try {
    const res = await fetchImpl(`${POSTCODES_IO}/${encodeURIComponent(postcode.replace(' ', ''))}`, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
    });
    if (res.status === 404) return { ok: false, reason: 'not_found' };
    if (!res.ok) return { ok: false, reason: 'unavailable' };
    const body = (await res.json()) as { result?: { postcode?: unknown; latitude?: unknown; longitude?: unknown; admin_district?: unknown; parish?: unknown } | null };
    const r = body?.result;
    const lat = r?.latitude;
    const lng = r?.longitude;
    // terminated postcodes come back with null coordinates
    if (typeof lat !== 'number' || typeof lng !== 'number' || !isValidPoint({ lat, lng })) return { ok: false, reason: 'not_found' };
    const area = typeof r?.admin_district === 'string' ? r.admin_district : typeof r?.parish === 'string' ? r.parish : null;
    return { ok: true, postcode: typeof r?.postcode === 'string' ? (normalisePostcode(r.postcode) ?? postcode) : postcode, lat, lng, area };
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
}

/** Sliding-window limiter, per process (enough to stop a loop; not a security boundary). */
export function createLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
    if (recent.length >= max) {
      hits.set(key, recent);
      return false;
    }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 5000) for (const [k, v] of hits) if (v.every((x) => t - x >= windowMs)) hits.delete(k);
    return true;
  };
}
