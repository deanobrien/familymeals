import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `server-only` throws outside a react-server bundle; stub it so server pipeline code can be unit-tested.
export default defineConfig({
  resolve: {
    alias: { 'server-only': fileURLToPath(new URL('./lib/server/import/server-only-stub.ts', import.meta.url)) },
  },
});
