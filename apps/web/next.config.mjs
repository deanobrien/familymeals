/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@fr/domain', '@fr/ui', '@fr/ai'],
  // sharp is a native module used by @fr/ai image preparation (server only).
  serverExternalPackages: ['sharp'],
  // Receipt photos are uploaded through a server action.
  experimental: { serverActions: { bodySizeLimit: '16mb' } },
  // @fr/ai source imports its own files as './x.js' (NodeNext style); map them to the .ts sources.
  webpack(config) {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], ...config.resolve.extensionAlias };
    return config;
  },
};
export default nextConfig;
