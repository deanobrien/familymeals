/**
 * Unified Next config (see DECISIONS D27).
 * - transpilePackages: every workspace package apps/web imports (they export TS source, D3).
 * - extensionAlias: some packages use NodeNext-style './x.js' specifiers that point at './x.ts'.
 * - sharp: native module used by @fr/ai image preparation (server only).
 * - serverActions.bodySizeLimit: receipt and recipe photos are uploaded through server actions.
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: [
    '@fr/ai',
    '@fr/domain',
    '@fr/engine',
    '@fr/plan-orchestrator',
    '@fr/recipe-import',
    '@fr/refdata',
    '@fr/ui',
  ],
  serverExternalPackages: ['sharp'],
  // Dev only: keep compiled routes for an hour instead of disposing them after 60s idle, so e2e runs (and
  // demos) do not pay repeated cold compiles of pages and server actions (D36).
  onDemandEntries: { maxInactiveAge: 60 * 60 * 1000, pagesBufferLength: 50 },
  experimental: { serverActions: { bodySizeLimit: '16mb' } },
  webpack(config, { dev }) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    if (dev) {
      // Runtime data (apps/web/.data) and Playwright output must not trigger dev rebuilds mid-test (D36).
      const base = config.watchOptions?.ignored;
      const extra = /[\\/](\.data|test-results|playwright-report|node_modules|\.git|\.next)([\\/]|$)/;
      config.watchOptions = {
        ...config.watchOptions,
        ignored: base instanceof RegExp ? new RegExp(`${base.source}|${extra.source}`) : extra,
      };
    }
    return config;
  },
};
export default nextConfig;
