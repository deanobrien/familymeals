import type { FullConfig } from '@playwright/test';

/** Routes compiled up front so the first test to visit them does not pay the cold Next dev compile. */
const WARM = ['/', '/recipes', '/recipes/import', '/plan', '/shopping', '/pantry', '/receipts', '/household', '/settings', '/privacy', '/sign-in'];

/**
 * Runs once per `playwright test`, after the web server is up:
 *  1. POST /api/dev/reset (dev-only; 404 in production) so every run starts from the seed data, which makes
 *     back-to-back runs against the same reused dev server pass.
 *  2. Warm the main routes.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use.baseURL ?? 'http://localhost:3100';
  const res = await fetch(`${base}/api/dev/reset`, { method: 'POST' });
  if (!res.ok) throw new Error(`e2e reset failed: POST /api/dev/reset -> HTTP ${res.status}`);
  for (const path of WARM) {
    const r = await fetch(`${base}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(120_000) });
    if (r.status >= 500) throw new Error(`warm-up ${path} -> HTTP ${r.status}`);
  }
  // Reset again: warming renders pages, and some pages lazily seed per-household demo data.
  await fetch(`${base}/api/dev/reset`, { method: 'POST' });
}
