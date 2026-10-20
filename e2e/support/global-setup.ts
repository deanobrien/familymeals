import { chromium, type FullConfig } from '@playwright/test';

/**
 * Routes compiled up front so the first test to visit them does not pay the cold Next dev compile
 * (server render AND client chunks, hence a real browser).
 */
const WARM = [
  '/', '/recipes', '/recipes/new', '/recipes/00000000-0000-4000-8000-000000000001', '/recipes/import',
  '/recipes/discover', '/plan', '/shopping', '/shopping/scan', '/pantry', '/receipts', '/household', '/settings', '/privacy', '/sign-in', '/sign-up',
];

/**
 * Runs once per `playwright test`, after the web server is up:
 *  1. POST /api/dev/reset (dev-only; 404 in production) so every run starts from the seed data, which makes
 *     back-to-back runs against the same reused dev server pass.
 *  2. Warm the main routes in a browser, then reset again (warming renders pages that lazily seed demo data).
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
    // Exercise the shopping server actions once (generate from an approved plan + sync) in a throwaway sandbox.
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
