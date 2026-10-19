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
  experimental: { serverActions: { bodySizeLimit: '16mb' } },
  webpack(config) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};
export default nextConfig;
