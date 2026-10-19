import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `server-only` throws outside a react-server bundle; stub it so server-side units (lib/server/**) can be tested.
export default defineConfig({
  resolve: {
    alias: { 'server-only': fileURLToPath(new URL('../../packages/ai/test/server-only-stub.ts', import.meta.url)) },
  },
});
