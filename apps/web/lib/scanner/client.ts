// Browser-side calls for the signed-in desktop user (cookie session), and for the phone page (no session; session id + token).
import {
  SCANNER_ERROR_MESSAGE, type PhoneCred, type PushBody, type ScannerErrorCode, type ScannerItem, type ScannerPurpose, type ScannerSessionView,
} from '@fr/engine/scanner';

export interface Failure { ok: false; code: ScannerErrorCode; message: string; status: number }
export type Result<T> = ({ ok: true } & T) | Failure;

const KNOWN = new Set(Object.keys(SCANNER_ERROR_MESSAGE));

async function call<T extends object>(path: string, init: RequestInit = {}): Promise<Result<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      headers: { accept: 'application/json', ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) },
    });
  } catch {
    return { ok: false, code: 'unavailable', message: SCANNER_ERROR_MESSAGE.unavailable, status: 0 };
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string } } | null)?.error;
    const code = (e?.code && KNOWN.has(e.code) ? e.code : res.status === 401 ? 'forbidden' : 'unavailable') as ScannerErrorCode;
    return { ok: false, code, message: e?.message ?? SCANNER_ERROR_MESSAGE[code], status: res.status };
  }
  return { ok: true, ...(body as T) };
}

// ---- desktop ----
export const startScannerSession = (purpose: ScannerPurpose) =>
  call<{ id: string; token: string; expiresAt: string }>('/api/scanner/sessions', { method: 'POST', body: JSON.stringify({ purpose }) });

export const fetchScannerStatus = (id: string, after: number) =>
  call<{ session: ScannerSessionView; items: ScannerItem[] }>(`/api/scanner/sessions/${id}?after=${after}`, { cache: 'no-store' });

export const endScannerSession = (id: string) => call<object>(`/api/scanner/sessions/${id}`, { method: 'DELETE', keepalive: true });

export const releaseScannerPhone = (id: string) => call<object>(`/api/scanner/sessions/${id}`, { method: 'POST', body: JSON.stringify({ action: 'release' }) });

export async function fetchScannerPhoto(id: string, itemId: string): Promise<Blob | null> {
  try {
    const res = await fetch(`/api/scanner/sessions/${id}/photos/${itemId}`, { credentials: 'same-origin', cache: 'no-store' });
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

// ---- phone (public routes) ----
export type { PhoneCred };

export const phoneConnect = (c: PhoneCred) =>
  call<{ purpose: ScannerPurpose; expiresAt: string; itemCount: number }>('/api/scanner/phone/connect', { method: 'POST', body: JSON.stringify(c) });

export const phonePush = (c: PhoneCred, push: PushBody) =>
  call<{ duplicate: boolean; itemCount: number }>('/api/scanner/phone/push', { method: 'POST', body: JSON.stringify({ ...c, ...push }) });
