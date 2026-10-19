/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@fr/domain', '@fr/ui', '@fr/ai', '@fr/plan-orchestrator'],
  webpack(config) {
    // Workspace packages import siblings as './x.js' while exporting TS source: resolve those to .ts/.tsx.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};
export default nextConfig;
