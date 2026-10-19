import { defineConfig } from 'vitest/config';

// Fixture validation only. Playwright specs live in ./specs and run via `pnpm test:e2e`.
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
