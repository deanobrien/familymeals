import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// `server-only` throws outside a react-server bundle; stub it so unit tests can import the package.
export default defineConfig({
  resolve: {
    alias: { 'server-only': fileURLToPath(new URL('./test/server-only-stub.ts', import.meta.url)) },
  },
});
