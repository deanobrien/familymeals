import { randomBytes } from 'node:crypto';
import { defineConfig, devices } from '@playwright/test';
// @ts-expect-error plain ESM helper shared with `pnpm dev:live` (no type declarations)
import { localSupabaseEnv } from '../scripts/local-supabase-env.mjs';

/**
 * Opt-in live suite (`pnpm test:e2e:live`, DECISIONS D143): runs `e2e/live/**` against the LOCAL Supabase stack
 * (`pnpm exec supabase start`). The default `pnpm test:e2e` (playwright.config.ts, `specs/**`) stays mock-only.
 * The web server is a separate `next dev` on E2E_LIVE_PORT (default 3133) with its own dist and temp data dirs.
 */
const PORT = Number(process.env.E2E_LIVE_PORT ?? 3133);
const BASE = `http://localhost:${PORT}`;

// Resolved once in the runner; workers inherit it through process.env (no second `supabase status`).
if (!process.env.FR_LIVE_SUPABASE_URL) {
  const env = localSupabaseEnv({ dataDirName: 'fr-live-e2e-data', distDir: '.next-live-e2e', siteUrl: BASE }) as Record<string, string>;
  Object.assign(process.env, env, { FR_LIVE_SUPABASE_URL: env.NEXT_PUBLIC_SUPABASE_URL });
}
// Throwaway secret for /api/jobs/purge (DX1), generated once in the runner; workers and the web server inherit it.
if (!process.env.JOBS_SECRET) process.env.JOBS_SECRET = randomBytes(32).toString('hex');
const webEnv: Record<string, string> = {};
for (const k of [
  'NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATA_BACKEND', 'AI_PROVIDER',
  'APP_DATA_DIR', 'NEXT_DIST_DIR', 'NEXT_PUBLIC_SITE_URL', 'JOBS_SECRET',
]) {
  const v = process.env[k];
  if (v) webEnv[k] = v;
}

export default defineConfig({
  testDir: './live',
  outputDir: './test-results-live',
  reporter: [['list']],
  globalSetup: './live/support/global-setup.ts',
  workers: Number(process.env.E2E_WORKERS ?? 2),
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL: BASE,
    trace: 'retain-on-failure',
    navigationTimeout: 90_000,
    actionTimeout: 20_000,
  },
  projects: [{ name: 'live-supabase', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm --filter @fr/web exec next dev -p ${PORT}`,
    url: `${BASE}/sign-in`,
    env: webEnv,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
  },
});
