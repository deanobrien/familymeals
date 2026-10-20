/**
 * E2E production-build mode (FL1, D241). Pure and edge-safe.
 *
 * `pnpm test:e2e:prod` runs the mock-auth Playwright suite against `next build && next start` (no per-route dev compiles,
 * which were the main source of load-related flakes). `next start` forces NODE_ENV=production, which refuses mock auth,
 * the in-memory demo backend, the mock AI provider and the /api/dev/* endpoints. With E2E_PRODUCTION_BUILD=1 those
 * checks see the NODE_ENV value 'e2e-production-build' instead.
 *
 * It can never apply to a real deployment: it needs NODE_ENV=production AND no Supabase URL AND DATA_BACKEND not
 * 'supabase' (a real production deploy must have both, see production.ts), so setting the flag by mistake on a real
 * site changes nothing.
 */
export const E2E_PRODUCTION_NODE_ENV = 'e2e-production-build';

interface E2eEnv {
  NODE_ENV?: string | undefined;
  E2E_PRODUCTION_BUILD?: string | undefined;
  NEXT_PUBLIC_SUPABASE_URL?: string | undefined;
  DATA_BACKEND?: string | undefined;
}

export function isE2eProductionBuild(env: E2eEnv = process.env as E2eEnv): boolean {
  return (
    env.NODE_ENV === 'production' &&
    env.E2E_PRODUCTION_BUILD === '1' &&
    !env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
    env.DATA_BACKEND !== 'supabase'
  );
}

/** NODE_ENV as the production safety checks must see it: 'e2e-production-build' in e2e production-build mode. */
export function effectiveNodeEnv(env: E2eEnv = process.env as E2eEnv): string | undefined {
  return isE2eProductionBuild(env) ? E2E_PRODUCTION_NODE_ENV : env.NODE_ENV;
}
