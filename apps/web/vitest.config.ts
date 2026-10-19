import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `server-only` throws outside a react-server bundle; stub it so server pipeline tests can import @fr/ai.
export default defineConfig({
  resolve: {
    alias: {
      'server-only': fileURLToPath(new URL('./lib/server/receipts/test/server-only-stub.ts', import.meta.url)),
    },
  },
});
