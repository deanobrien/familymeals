import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production';
const version = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')).version;

/**
 * Security headers (SECURITY-CHECKLIST section 2, D152). Production builds only: dev needs eval/HMR.
 * Scripts use 'unsafe-inline' because Next's inline bootstrap scripts need it without a per-request nonce; a
 * nonce + strict-dynamic CSP via middleware is a follow-up. Supabase origin comes from NEXT_PUBLIC_SUPABASE_URL
 * at BUILD time. CSP_REPORT_ONLY=true (build time) ships the policy as Report-Only for a first look.
 */
function securityHeaders() {
  let supa = '';
  let supaWs = '';
  try {
    const u = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '');
    supa = u.origin;
    supaWs = u.origin.replace(/^http/, 'ws');
  } catch { /* no Supabase configured at build */ }
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' blob: data: https://www.themealdb.com ${supa}`.trim(),
    "media-src 'self' blob:",
    `connect-src 'self' ${supa} ${supaWs}`.replace(/ +/g, ' ').trim(),
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
  const cspName = process.env.CSP_REPORT_ONLY === 'true' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy';
  return [
    { key: cspName, value: csp },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
  ];
}

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
  poweredByHeader: false,
  // Azure App Service deploy (D150): NEXT_STANDALONE=1 (set by scripts/package-appservice.ps1) emits a self-contained
  // server in .next/standalone. Opt-in because standalone copying needs symlink rights on Windows; the script builds in a
  // symlink-free (node-linker=hoisted) copy of the repo. Tracing root = monorepo root so workspace packages are traced.
  ...(process.env.NEXT_STANDALONE === '1' ? { output: 'standalone' } : {}),
  outputFileTracingRoot: resolve(here, '../..'),
  // sharp picks its native binary with a dynamic per-platform require the tracer cannot see: include the linux-x64
  // (glibc) packages explicitly. The build host is Windows, the App Service target is Linux x64.
  outputFileTracingIncludes: {
    '/**': [
      '../../node_modules/sharp/**',
      '../../node_modules/@img/sharp-linux-x64/**',
      '../../node_modules/@img/sharp-libvips-linux-x64/**',
    ],
  },
  env: { APP_VERSION: version, APP_COMMIT: process.env.APP_COMMIT || '' },
  async headers() {
    return isProd ? [{ source: '/:path*', headers: securityHeaders() }] : [];
  },
  // Lets a second dev server (e.g. the e2e run on another port) use its own build dir so it never clobbers `pnpm dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  transpilePackages: [
    '@fr/ai',
    '@fr/domain',
    '@fr/engine',
    '@fr/plan-orchestrator',
    '@fr/recipe-import',
    '@fr/recipe-sources',
    '@fr/refdata',
    '@fr/ui',
  ],
  serverExternalPackages: ['sharp'],
  // Dev only: keep compiled routes for an hour instead of disposing them after 60s idle, so e2e runs (and
  // demos) do not pay repeated cold compiles of pages and server actions (D36).
  onDemandEntries: { maxInactiveAge: 60 * 60 * 1000, pagesBufferLength: 50 },
  // middlewareClientMaxBodySize: the Supabase auth middleware makes Next buffer request bodies (default 10MB, then
  // truncates); a truncated multipart upload fails to parse. Keep it above the route/server-action limits.
  experimental: { serverActions: { bodySizeLimit: '16mb' }, middlewareClientMaxBodySize: '40mb' },
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
