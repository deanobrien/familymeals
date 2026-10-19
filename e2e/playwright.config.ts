import { defineConfig, devices } from '@playwright/test';

const PORT = 3100;

export default defineConfig({
  testDir: './specs',
  outputDir: './test-results',
  reporter: [['list']],
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm --filter @fr/web dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
