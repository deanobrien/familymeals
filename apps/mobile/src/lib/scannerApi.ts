// Phone-as-scanner, Android side (P3-C, D447-D448): the app scans the QR code a signed-in desktop user shows, then pushes barcodes and
// photos to the SAME public routes the web phone page uses (/api/scanner/phone/*). No sign-in is needed on this phone: the QR code's
// session id + token are the credential. The shared engine module owns every rule (link shape, retry queue, fatal errors).
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImageManipulator from 'expo-image-manipulator';
import {
  MAX_PHOTO_BYTES, SCANNER_ERROR_MESSAGE, parsePhoneLink,
  type PhoneCred, type PhoneLink, type PhoneTransport, type PushBody, type ScannerErrorCode, type SenderResult,
} from '@fr/engine/scanner';
import type { CapturedImage } from './extraction';

export const DEVICE_KEY = 'fr.scanner.device.v1';

function randomId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-';
  let out = '';
  for (let i = 0; i < 32; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

/** This phone's id for scanning sessions: kept, so reopening the app is the same phone, not "another phone". */
export async function loadDeviceId(kv: Pick<typeof AsyncStorage, 'getItem' | 'setItem'> = AsyncStorage): Promise<string> {
  try {
    const have = await kv.getItem(DEVICE_KEY);
    if (have && /^[A-Za-z0-9_-]{16,128}$/.test(have)) return have;
    const fresh = randomId();
    await kv.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return randomId();
  }
}

/**
 * A scanned or pasted address, accepted only when it is our scanning link AND points at the server this app is configured for:
 * a hostile QR code can never make the app send scans (or photos) to another site.
 */
export function parseScannedLink(raw: string, baseUrl: string | undefined): PhoneLink | null {
  if (!baseUrl) return null;
  return parsePhoneLink(raw, { allowedOrigin: baseUrl });
}

const KNOWN = new Set<string>(Object.keys(SCANNER_ERROR_MESSAGE));

export function createPhoneTransport(baseUrl: string, fetchImpl: typeof fetch = fetch, timeoutMs = 20_000): PhoneTransport {
  const origin = baseUrl.replace(/\/+$/, '');
  async function post<T extends object>(path: string, body: object): Promise<SenderResult<T>> {
    const ctl = typeof AbortController === 'undefined' ? null : new AbortController();
    const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
    try {
      const res = await fetchImpl(`${origin}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
        ...(ctl ? { signal: ctl.signal } : {}),
      });
      let json: unknown = null;
      try {
        json = await res.json();
      } catch {
        /* empty */
      }
      if (!res.ok) {
        const e = (json as { error?: { code?: string; message?: string } } | null)?.error;
        const code = (e?.code && KNOWN.has(e.code) ? e.code : res.status >= 500 || res.status === 0 ? 'unavailable' : 'invalid_input') as ScannerErrorCode;
        return { ok: false, code, message: e?.message ?? SCANNER_ERROR_MESSAGE[code] };
      }
      return { ok: true, ...(json as T) };
    } catch {
      return { ok: false, code: 'unavailable', message: SCANNER_ERROR_MESSAGE.unavailable };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  return {
    connect: (c: PhoneCred) => post('/api/scanner/phone/connect', c),
    push: (c: PhoneCred, p: PushBody) => post('/api/scanner/phone/push', { ...c, ...p }),
  };
}

export interface PreparedPhoto {
  base64: string;
  mime: 'image/jpeg';
}

/** Shrink to at most 1600 px (then 1100 px if still too big) as JPEG and return base64, within the server's 1.5 MB photo limit. */
export async function preparePhoto(img: CapturedImage): Promise<PreparedPhoto> {
  for (const edge of [1600, 1100, 800]) {
    const longest = Math.max(img.width, img.height);
    const actions: ImageManipulator.Action[] = longest > edge ? [{ resize: img.width >= img.height ? { width: edge } : { height: edge } }] : [];
    const out = await ImageManipulator.manipulateAsync(img.uri, actions, { compress: edge === 1600 ? 0.8 : 0.65, format: ImageManipulator.SaveFormat.JPEG, base64: true });
    const b64 = out.base64 ?? '';
    if (b64 && Math.floor((b64.length * 3) / 4) <= MAX_PHOTO_BYTES) return { base64: b64, mime: 'image/jpeg' };
  }
  throw new Error('That photo could not be shrunk enough to send. Try again with the phone a little further away.');
}
