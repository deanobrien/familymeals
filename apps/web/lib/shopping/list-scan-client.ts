// Browser helper: POST photos of a handwritten list to /api/shopping/scan. Never throws.
import type { ListScanApiOk, ScanApiError } from './list-scan-types';

export type ListScanFailure = ScanApiError['error'];

export async function postListScan(files: File[]): Promise<{ ok: true; data: ListScanApiOk } | { ok: false; error: ListScanFailure }> {
  const fd = new FormData();
  files.forEach((f) => fd.append('images', f, f.name));
  try {
    const res = await fetch('/api/shopping/scan', { method: 'POST', body: fd });
    const json = (await res.json().catch(() => null)) as (ListScanApiOk & Partial<ScanApiError>) | null;
    if (!res.ok || !json || !Array.isArray(json.rows)) {
      return { ok: false, error: json?.error ?? { code: 'UNEXPECTED', message: 'The scan failed. Please try again.', retryable: true } };
    }
    return { ok: true, data: json };
  } catch {
    return { ok: false, error: { code: 'NETWORK', message: 'We could not reach the server. Check your connection and try again.', retryable: true } };
  }
}
