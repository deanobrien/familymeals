// Browser side of the offline PWA (P3-C, D446): register the service worker, hand it the assets the current page already loaded,
// and wipe everything on sign-in. Every function is safe to call anywhere (SSR, tests, browsers without service workers).
import { deleteOfflineDb } from './kv';

export const SW_URL = '/sw.js';

export const swSupported = (): boolean => typeof navigator !== 'undefined' && 'serviceWorker' in navigator;

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!swSupported()) return null;
  try {
    return await navigator.serviceWorker.register(SW_URL, { scope: '/' });
  } catch {
    return null;
  }
}

/** Static asset URLs this page has already loaded (they were fetched before the worker controlled the page, so it never saw them). */
export function loadedStaticUrls(perf: Pick<Performance, 'getEntriesByType'> | undefined = typeof performance === 'undefined' ? undefined : performance): string[] {
  if (!perf) return [];
  const out = new Set<string>();
  for (const e of perf.getEntriesByType('resource')) {
    try {
      const u = new URL(e.name, typeof location === 'undefined' ? 'http://localhost' : location.href);
      if (typeof location !== 'undefined' && u.origin !== location.origin) continue;
      if (/^\/(_next\/static|icons|vendor)\//.test(u.pathname)) out.add(u.pathname + u.search);
    } catch {
      /* skip */
    }
  }
  return [...out].slice(0, 200);
}

async function activeWorker(): Promise<ServiceWorker | null> {
  if (!swSupported()) return null;
  try {
    const reg = await navigator.serviceWorker.ready;
    return reg.active ?? navigator.serviceWorker.controller ?? null;
  } catch {
    return null;
  }
}

/** Ask the worker to keep the offline pages (and the assets this page loaded) for use without signal. */
export async function warmOfflineShell(pages: string[]): Promise<void> {
  const sw = await activeWorker();
  sw?.postMessage({ type: 'fr-warm', urls: loadedStaticUrls(), pages });
}

/**
 * Forget what this browser kept for offline use: cached pages (they hold list data) and the on-device list snapshot.
 * `queue: false` keeps the unsynced-changes queue (it is bound to its user and replays when that user is back; D446).
 */
export async function clearOfflineData(opts: { queue?: boolean } = {}): Promise<void> {
  if (swSupported()) {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/');
      (reg?.active ?? navigator.serviceWorker.controller)?.postMessage({ type: 'fr-clear' });
    } catch {
      /* no worker */
    }
  }
  if (typeof caches !== 'undefined') {
    try {
      for (const k of await caches.keys()) if (k.startsWith('fr-')) await caches.delete(k);
    } catch {
      /* ignore */
    }
  }
  if (opts.queue) await deleteOfflineDb();
  else await dropSnapshotOnly();
}

async function dropSnapshotOnly(): Promise<void> {
  const { idbKv } = await import('./kv');
  const { SNAPSHOT_KEY } = await import('./shopping-store');
  await idbKv()?.del(SNAPSHOT_KEY);
}
