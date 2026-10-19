/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace packages use NodeNext-style `./x.js` specifiers that point at `./x.ts` sources.
  webpack: (config) => {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], '.mjs': ['.mts', '.mjs'], ...config.resolve.extensionAlias };
    return config;
  },
  transpilePackages:['@fr/domain', '@fr/ui', '@fr/ai', '@fr/recipe-import'],
};
export default nextConfig;
