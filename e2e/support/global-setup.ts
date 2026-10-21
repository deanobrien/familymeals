import { chromium, type FullConfig } from '@playwright/test';

/**
 * Routes compiled up front so the first test to visit them does not pay the cold Next dev compile
 * (server render AND client chunks, hence a real browser). Every page route of apps/web belongs here (FL1, D240):
 * `recipes/[id]/edit` was missing and its first visit under load blew a 15 s expect.
 */
const SEED_RECIPE = '00000000-0000-4000-8000-000000000001';
const WARM = [
  '/', '/recipes', '/recipes/new', `/recipes/${SEED_RECIPE}`, `/recipes/${SEED_RECIPE}/edit`, '/recipes/import',
  '/recipes/discover', '/recipes/discover/review', '/plan', '/plan?week=2026-12-07', '/shopping', '/pantry', '/pantry/scan', '/pantry/scan?mode=rapid', '/shopping/scan', '/settings/stores',
  '/receipts', '/receipts/00000000-0000-4000-8000-0000000000ff/review', '/household', '/household/new', '/settings', '/privacy',
  '/about/sources', '/sign-in', '/sign-up', '/forgot-password', '/reset-password', '/invite/warmup-token',
];

/** API routes compiled with an empty request (any HTTP status is fine: we only need the handler bundled). */
const WARM_API: Array<{ method: 'GET' | 'POST'; path: string }> = [
  { method: 'GET', path: '/api/health' },
  { method: 'POST', path: '/api/extract' },
  { method: 'POST', path: '/api/extract/save' },
  { method: 'POST', path: '/api/pantry/scan' },
  { method: 'POST', path: '/api/import/url' },
  { method: 'GET', path: '/api/pantry/make-now' },
  { method: 'POST', path: '/api/shopping/scan' },
  { method: 'POST', path: '/api/shopping/voice/parse' },
  { method: 'GET', path: '/api/stores/locations' },
  { method: 'GET', path: '/api/stores/geocode' },
  { method: 'GET', path: '/api/products/5000000000000' },
  { method: 'GET', path: '/api/products' },
  { method: 'GET', path: '/api/uploads/00000000-0000-4000-8000-000000000000/x.png' },
];

/**
 * Runs once per `playwright test`, after the web server is up:
 *  1. POST /api/dev/reset (dev-only; 404 in production) so every run starts from the seed data, which makes
 *     back-to-back runs against the same reused server pass.
 *  2. Warm every page and API route in a browser, then reset again (warming renders pages that lazily seed demo data).
 * In production-build mode (E2E_MODE=prod) there is nothing to compile; the same pass just proves the server is healthy.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const base = config.projects[0]?.use.baseURL ?? 'http://localhost:3100';
  const reset = async () => {
    const res = await fetch(`${base}/api/dev/reset`, { method: 'POST', signal: AbortSignal.timeout(120_000) });
    if (!res.ok) throw new Error(`e2e reset failed: POST /api/dev/reset -> HTTP ${res.status}`);
  };
  await reset();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    for (const path of WARM) {
      const r = await page.goto(`${base}${path}`, { waitUntil: 'networkidle', timeout: 180_000 });
      if (r && r.status() >= 500) throw new Error(`warm-up ${path} -> HTTP ${r.status()}`);
    }
    for (const { method, path } of WARM_API) {
      await page.context().request.fetch(`${base}${path}`, { method, timeout: 180_000, ...(method === 'POST' ? { data: {} } : {}) });
    }
    // Exercise the shopping server actions once (generate from an approved plan + sync) in a throwaway sandbox household.
    await page.context().addCookies([{ name: 'fr_household', value: 'e2e-warmup', domain: new URL(base).hostname, path: '/' }]);
    const seeded = await page.context().request.post(`${base}/api/dev/seed`, { data: { kind: 'approved-plan' } });
    const { planId } = (await seeded.json()) as { planId: string };
    await page.goto(`${base}/shopping?plan=${planId}`, { waitUntil: 'networkidle', timeout: 180_000 });
    await page.getByRole('checkbox', { name: /^Onion/ }).waitFor({ timeout: 120_000 });
  } finally {
    await browser.close();
  }
  await reset();
}
