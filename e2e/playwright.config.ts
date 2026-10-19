import { defineConfig, devices } from '@playwright/test';

// E2E_PORT lets a second dev server run beside the one on 3100 (e.g. while 3100 serves a demo).
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  reporter: [['list']],
  // Resets the in-memory stores and warms the routes (cold Next dev compiles are slow).
  globalSetup: './support/global-setup.ts',
  // A cold Next dev server compiles each route/server action on first use; 16+ parallel workers starve it.
  workers: Number(process.env.E2E_WORKERS ?? 4),
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm --filter @fr/web exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    // Discovery uses offline fixtures in e2e (D170): no network, deterministic.
    env: { RECIPE_SOURCE: 'mock' },
    timeout: 180_000,
  },
});
