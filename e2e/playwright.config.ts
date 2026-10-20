import { defineConfig, devices } from '@playwright/test';
import { fakeCameraVideoPath } from './support/fake-camera';

// E2E_PORT lets a second server run beside the one on 3100 (e.g. while 3100 serves a demo).
const PORT = Number(process.env.E2E_PORT ?? 3100);
// E2E_MODE=prod (pnpm test:e2e:prod, used by CI): `next build && next start`, so no test ever pays a cold dev compile
// (the main source of load-related flakes, FL1/D240). Default is `next dev` for quick local runs.
const PROD = process.env.E2E_MODE === 'prod';
const web = 'pnpm --filter @fr/web exec next';

export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : [['list']],
  // Resets the in-memory stores and warms every route (cold Next dev compiles are slow).
  globalSetup: './support/global-setup.ts',
  // dev: a cold Next dev server compiles each route/server action on first use; 16+ parallel workers starve it.
  // prod: nothing compiles at request time, so the CPU, not the server, is the limit.
  workers: Number(process.env.E2E_WORKERS ?? 4),
  timeout: 90_000,
  expect: { timeout: PROD ? 15_000 : 20_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    navigationTimeout: 60_000,
    actionTimeout: PROD ? 15_000 : 20_000,
  },
  projects: [
    { name: 'chromium', testIgnore: /rapid-scan\.spec\.ts/, use: { ...devices['Desktop Chrome'] } },
    {
      // Continuous barcode scanning (BS1): Chromium's fake camera plays a generated video of barcodes, so getUserMedia, the
      // frame loop and the WASM decoder all run for real (headless Chromium has no BarcodeDetector, so this is the iPhone path).
      name: 'chromium-camera',
      testMatch: /rapid-scan\.spec\.ts/,
      use: {
        ...devices['Desktop Chrome'],
        permissions: ['camera'],
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
            `--use-file-for-fake-video-capture=${fakeCameraVideoPath()}`,
          ],
        },
      },
    },
  ],
  webServer: {
    command: PROD ? `${web} build && ${web} start -p ${PORT}` : `${web} dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    // Discovery uses offline fixtures in e2e (D170): no network, deterministic.
    // E2E_PRODUCTION_BUILD tells the mock-auth/dev-tools guards that this NODE_ENV=production server is a test stack
    // (inert unless there is no Supabase config at all, see apps/web/lib/e2e-mode.ts).
    env: {
      RECIPE_SOURCE: 'mock',
      ...(PROD ? { E2E_PRODUCTION_BUILD: '1', AI_PROVIDER: 'mock', AI_ALLOW_MOCK_IN_PRODUCTION: 'true' } : {}),
    },
    timeout: PROD ? 600_000 : 180_000,
  },
});
