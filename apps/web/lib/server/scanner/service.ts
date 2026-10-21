// Phone-as-scanner service layer (P3-C, D447-D449): picks the store for the request, mints tokens, and validates what a phone sends
// before it reaches the store. Routes stay thin.
import 'server-only';
import { randomBytes } from 'node:crypto';
import { normaliseRetailCode } from '@fr/engine/pantry';
import {
  SCANNER_ERROR_MESSAGE, createRateLimiter, isSessionId, isToken, type ScannerErrorCode, type ScannerPurpose,
} from '@fr/engine/scanner';
import type { RequestAuth } from '../auth/request-auth';
import { useSupabaseBackend } from '../supabase/backend';
import {
  SupabaseDesktopScannerStore, SupabasePhoneScannerStore, createAnonClient, hashToken, memoryScannerStore,
  type DesktopScannerStore, type PhonePush, type PhoneScannerStore,
} from './store';

/** 32 random bytes, base64url: 43 characters, 256 bits. Only its SHA-256 is ever stored. */
export const newScannerToken = (): string => randomBytes(32).toString('base64url');

export function desktopStore(auth: Pick<RequestAuth, 'dataContext'>): DesktopScannerStore {
  return auth.dataContext ? new SupabaseDesktopScannerStore(auth.dataContext.client) : memoryScannerStore();
}

export function phoneStore(): PhoneScannerStore {
  if (useSupabaseBackend()) {
    const anon = createAnonClient();
    if (anon) return new SupabasePhoneScannerStore(anon);
  }
  return memoryScannerStore();
}

export const isScannerPurpose = (v: unknown): v is ScannerPurpose => v === 'pantry' || v === 'receipt';

export async function startSession(
  store: DesktopScannerStore, ctx: { householdId: string; userId: string }, purpose: ScannerPurpose,
): Promise<{ ok: true; id: string; token: string; expiresAt: string } | { ok: false; error: ScannerErrorCode }> {
  const token = newScannerToken();
  const r = await store.create(ctx, purpose, hashToken(token));
  return r.ok ? { ok: true, id: r.id, token, expiresAt: r.expiresAt } : r;
}

/** HTTP status for a scanner error code. Wrong id / wrong token / ended sessions all answer 403 so nothing reveals which. */
export function statusFor(code: ScannerErrorCode): number {
  switch (code) {
    case 'invalid': case 'revoked': case 'expired': case 'scanner_in_use': case 'forbidden': return 403;
    case 'not_found': return 404;
    case 'rate_limited': return 429;
    case 'session_full': case 'too_many_photos': return 409;
    case 'photo_too_large': return 413;
    case 'invalid_input': return 422;
    default: return 503;
  }
}

export const errorBody = (code: ScannerErrorCode) => ({ error: { code, message: SCANNER_ERROR_MESSAGE[code], retryable: code === 'unavailable' || code === 'rate_limited' } });

// Per-IP shield on the public phone routes, in addition to the per-session caps in the store: 300 calls a minute is far above
// a person scanning (about two a second) and far below what guessing needs. One process (App Service single instance).
const ipLimiter = createRateLimiter(300, 60_000);
let sweeps = 0;
export function allowIp(ip: string): boolean {
  if (++sweeps % 500 === 0) ipLimiter.sweep();
  return ipLimiter.hit(ip);
}
export const clientIp = (headers: Headers): string => (headers.get('x-forwarded-for')?.split(',')[0]?.trim() || headers.get('x-real-ip') || 'unknown').slice(0, 64);

export interface PhoneCredentials { sessionId: string; token: string; device: string }

/** `{ sessionId, token, device }` from a phone request body, or null. The device id is a random string the phone keeps for the session. */
export function readCredentials(body: Record<string, unknown>): PhoneCredentials | null {
  const { sessionId, token, device } = body;
  if (!isSessionId(sessionId) || !isToken(token) || typeof device !== 'string' || device.length < 16 || device.length > 128 || !/^[A-Za-z0-9_-]+$/.test(device)) return null;
  return { sessionId: sessionId.toLowerCase(), token, device };
}

const MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);
/** Hard ceiling on the decoded photo; the SQL function and the store enforce the same 1.5 MB. */
const MAX_B64_CHARS = 2_100_000;

/** Validate and normalise one push from a phone. */
export function readPush(body: Record<string, unknown>): { ok: true; push: PhonePush } | { ok: false; error: ScannerErrorCode } {
  const clientId = body.clientId;
  if (typeof clientId !== 'string' || clientId.length < 8 || clientId.length > 64 || !/^[A-Za-z0-9_-]+$/.test(clientId)) return { ok: false, error: 'invalid_input' };
  if (body.kind === 'barcode') {
    if (typeof body.barcode !== 'string' || body.barcode.length > 40) return { ok: false, error: 'invalid_input' };
    const code = normaliseRetailCode(body.barcode, typeof body.format === 'string' ? body.format : undefined);
    const count = body.count === undefined ? 1 : body.count;
    if (!code || typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > 99) return { ok: false, error: 'invalid_input' };
    return { ok: true, push: { clientId, kind: 'barcode', barcode: code, count } };
  }
  if (body.kind === 'photo') {
    const b64 = body.photo;
    if (typeof b64 !== 'string' || b64.length === 0 || b64.length > MAX_B64_CHARS || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { ok: false, error: 'invalid_input' };
    if (typeof body.mime !== 'string' || !MIMES.has(body.mime)) return { ok: false, error: 'invalid_input' };
    return { ok: true, push: { clientId, kind: 'photo', photo: { mime: body.mime as 'image/jpeg' | 'image/png' | 'image/webp', bytes: Buffer.from(b64, 'base64') } } };
  }
  return { ok: false, error: 'invalid_input' };
}
