// Browser helper: POST photos / frames to /api/pantry/scan. Never throws.
import type { ScanApiError, ScanApiOk } from './scan-types';

export type ScanApiFailure = ScanApiError['error'];

export async function postScan(files: File[], focus?: string): Promise<{ ok: true; data: ScanApiOk } | { ok: false; error: ScanApiFailure }> {
  const fd = new FormData();
  files.forEach((f) => fd.append('images', f, f.name));
  if (focus) fd.append('focus', focus);
  try {
    const res = await fetch('/api/pantry/scan', { method: 'POST', body: fd });
    const json = (await res.json().catch(() => null)) as (ScanApiOk & Partial<ScanApiError>) | null;
    if (!res.ok || !json || !Array.isArray(json.rows)) {
      return { ok: false, error: json?.error ?? { code: 'UNEXPECTED', message: 'The scan failed. Please try again.', retryable: true } };
    }
    return { ok: true, data: json };
  } catch {
    return { ok: false, error: { code: 'NETWORK', message: 'We could not reach the server. Check your connection and try again.', retryable: true } };
  }
}
