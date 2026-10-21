'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { clearOfflineData, registerServiceWorker, warmOfflineShell } from '../lib/offline/client';

/** Pages shown to someone who is NOT signed in on this browser. */
const SIGNED_OUT_PATHS = ['/sign-in', '/sign-up', '/forgot-password', '/reset-password'];

/**
 * Offline PWA plumbing (P3-C, D446), rendered once by the shell. Signed-in pages: register the service worker and, on the shopping
 * page, ask it to keep that page and the assets it loaded. Sign-in / sign-up pages: wipe the offline copies (the previous
 * person's pages and list snapshot must never be shown to whoever signs in next on this browser).
 */
export function OfflineBoot() {
  const pathname = usePathname();
  useEffect(() => {
    if (SIGNED_OUT_PATHS.includes(pathname)) {
      void clearOfflineData({ queue: false });
      return undefined;
    }
    if (pathname.startsWith('/scan/')) return undefined; // the scanning phone is not signed in: no worker, nothing to keep
    let cancelled = false;
    void registerServiceWorker().then(() => {
      if (!cancelled && (pathname === '/shopping' || pathname.startsWith('/shopping/'))) void warmOfflineShell(['/shopping']);
    });
    return () => { cancelled = true; };
  }, [pathname]);
  return null;
}
