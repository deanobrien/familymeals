import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/.turbo/**',
      '**/dist/**',
      '**/next-env.d.ts',
      'e2e/playwright-report/**',
      'packages/ui/demo/dist/**',
      'e2e/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // @fr/ai is server-only (provider keys, sharp). Web may import it only from route handlers / lib/server.
    files: ['apps/web/**/*.{ts,tsx}'],
    ignores: ['apps/web/app/api/**', 'apps/web/lib/server/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@fr/ai', '@fr/ai/*'],
              message: '@fr/ai is server-only: import it only from apps/web/app/api/** or apps/web/lib/server/**.',
            },
          ],
        },
      ],
    },
  },
  {
    // The Anthropic SDK adapter and its test doubles deliberately use loose typing at the SDK boundary.
    files: ['packages/ai/**/*.ts'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
