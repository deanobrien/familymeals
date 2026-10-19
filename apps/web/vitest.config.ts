import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `server-only` throws outside a react-server bundle; stub it so server-side units (lib/server/**) can be tested.
export default defineConfig({
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('./lib/server/import/server-only-stub.ts', import.meta.url)),
    },
  },
  test: {
    // Keep unit tests away from the real apps/web/.data (uploads, ai-settings.json, app-secret).
    env: { APP_DATA_DIR: join(tmpdir(), 'fr-web-test-data') },
  },
});
