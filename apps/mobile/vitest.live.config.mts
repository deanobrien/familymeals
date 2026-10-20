// Opt-in live run against the LOCAL Supabase stack (`pnpm exec supabase start`): pnpm --filter @fr/mobile test:live
// Runs under plain Node (native fetch + WebSocket, which jest-expo's React Native environment replaces), using the vitest
// that the web app already depends on. Plain object, no `vitest/config` import: this package does not depend on vitest.
import { fileURLToPath } from 'node:url';

process.env.FR_LIVE = '1';
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default {
  // This package's tsconfig extends expo's base, which Vite's esbuild cannot resolve: give it inline options instead.
  esbuild: { tsconfigRaw: { compilerOptions: { target: 'es2022' } } },
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${here('./src')}/` },
      // OfflineStore's default store needs the native module; the live test always passes its own in-memory store.
      { find: '@react-native-async-storage/async-storage', replacement: here('./__tests__/live/async-storage-stub.ts') },
    ],
  },
  test: {
    environment: 'node',
    include: ['__tests__/live/**/*.live.test.ts'],
    testTimeout: 90_000,
    hookTimeout: 90_000,
    fileParallelism: false,
  },
};
