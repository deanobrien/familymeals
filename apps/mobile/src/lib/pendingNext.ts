import AsyncStorage from '@react-native-async-storage/async-storage';
import { INVITE_TOKEN_RE } from './inviteLink';

/**
 * Where to go once the user has signed in / confirmed their email (the app's equivalent of the web `next` parameter, which
 * `safeNextPath()` restricts to same-origin paths). Only a pending invitation is remembered: an invite link opened while signed
 * out must survive sign-up, the confirmation email and sign-in. Stored on the device for one hour; the path is re-validated on read.
 */
const KEY = 'fr.pendingNext.v1';
const TTL_MS = 60 * 60 * 1000;

/** Accepts `/invite/<64 hex>` only; anything else is dropped (no open redirects, no arbitrary routes from a link). */
export function safeAppPath(path: string | null | undefined): string | null {
  const m = /^\/invite\/([0-9a-f]{64})$/.exec(path ?? '');
  return m && INVITE_TOKEN_RE.test(m[1]!) ? path! : null;
}

export async function setPendingNext(path: string, now: () => number = Date.now): Promise<void> {
  const safe = safeAppPath(path);
  if (!safe) return;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify({ path: safe, at: now() }));
  } catch {
    /* best effort: the user can open the link again */
  }
}

/** Reads and clears the pending path (null when none, expired or tampered with). */
export async function takePendingNext(now: () => number = Date.now): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    await AsyncStorage.removeItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { path?: unknown; at?: unknown };
    if (typeof v.path !== 'string' || typeof v.at !== 'number' || now() - v.at > TTL_MS) return null;
    return safeAppPath(v.path);
  } catch {
    return null;
  }
}

export async function clearPendingNext(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
