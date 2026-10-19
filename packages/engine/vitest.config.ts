import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Thresholds apply to the L3 core modules (units/parse/normalise/scale/aggregate).
      include: ['src/units/**', 'src/parse/**', 'src/normalise/**', 'src/scale/**', 'src/aggregate/**'],
      exclude: ['src/units/converter.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 95, functions: 95, branches: 90, statements: 95 },
    },
  },
});
