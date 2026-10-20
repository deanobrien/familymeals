/**
 * Production configuration checks (D150). Pure: takes an env object, returns problems. Edge-safe (no node imports).
 *
 * Run at server start by `instrumentation.ts` (fail fast with a readable message in the App Service log stream) and
 * summarised, without detail, by `/api/health`.
 *
 * Refused in production: mock auth (no Supabase env), the mock AI provider, the in-memory demo data backend, and a missing
 * or weak APP_SECRET. Uploaded images live in Supabase Storage (private buckets, ST1 D190); the local-file store is a
 * dev / mock-mode implementation only, so the old ALLOW_LOCAL_FILE_STORE opt-in is gone (a leftover setting is ignored).
 */
import { effectiveNodeEnv } from '../../e2e-mode';

export interface ProdEnv {
  NODE_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  DATA_BACKEND?: string;
  APP_SECRET?: string;
  AI_PROVIDER?: string;
  AI_ALLOW_MOCK_IN_PRODUCTION?: string;
  /** Legacy (pre-ST1): ignored. */
  ALLOW_LOCAL_FILE_STORE?: string;
  SUPABASE_DATA_CONTEXT?: string;
  NEXT_PUBLIC_SITE_URL?: string;
}

export function isProduction(env: ProdEnv = process.env as ProdEnv): boolean {
  return effectiveNodeEnv(env) === 'production';
}

/** Returns human-readable problems; empty when not production or when everything required is present. */
export function productionConfigProblems(env: ProdEnv = process.env as ProdEnv): string[] {
  if (!isProduction(env)) return [];
  const p: string[] = [];
  if (!env.NEXT_PUBLIC_SUPABASE_URL?.trim() || !env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()) {
    p.push('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required (mock auth is refused in production). They are also baked in at BUILD time: rebuild the package after changing them.');
  }
  if (env.DATA_BACKEND !== 'supabase') {
    p.push('DATA_BACKEND must be "supabase" (the in-memory demo store is not allowed in production).');
  }
  if (!env.NEXT_PUBLIC_SITE_URL?.trim()) {
    p.push('NEXT_PUBLIC_SITE_URL is required (https://<host>, no trailing slash). It is also baked in at BUILD time: rebuild the package after changing it.');
  }
  const secret = env.APP_SECRET?.trim();
  if (!secret) p.push('APP_SECRET is required (at least 16 characters).');
  else if (secret.length < 16) p.push('APP_SECRET must be at least 16 characters.');
  if (env.AI_PROVIDER === 'mock' || env.AI_ALLOW_MOCK_IN_PRODUCTION === 'true') {
    p.push('The mock AI provider is refused in production: unset AI_PROVIDER=mock / AI_ALLOW_MOCK_IN_PRODUCTION.');
  }
  if (env.SUPABASE_DATA_CONTEXT === 'service') {
    p.push('SUPABASE_DATA_CONTEXT=service is a development-only fallback: remove it.');
  }
  return p;
}

const BAKED_NAMES = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SITE_URL'] as const;

/**
 * Names of NEXT_PUBLIC_* settings whose RUNTIME value differs from the value inlined at BUILD time. Returns setting
 * names only, never values. The caller reads `baked` with literal `process.env.NEXT_PUBLIC_X` (inlined by Next) and
 * `runtime` with a dynamic key (not inlined).
 */
export function bakedMismatchProblems(
  baked: Record<string, string | undefined>,
  runtime: Record<string, string | undefined>,
): string[] {
  const out: string[] = [];
  for (const name of BAKED_NAMES) {
    if ((baked[name] ?? '').trim() !== (runtime[name] ?? '').trim()) {
      out.push(`${name} differs between the build and the App Service setting: the browser bundle uses the build-time value. Rebuild the package with the intended value.`);
    }
  }
  return out;
}

/** Production problems plus build/runtime mismatches. Node runtime only (health route, instrumentation). */
export function allConfigProblems(): string[] {
  const base = productionConfigProblems();
  if (!isProduction()) return base;
  const baked = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  };
  const runtime: Record<string, string | undefined> = {};
  for (const name of BAKED_NAMES) runtime[name] = process.env[name];
  return [...base, ...bakedMismatchProblems(baked, runtime)];
}

export function assertProductionConfig(env: ProdEnv = process.env as ProdEnv): void {
  const problems = productionConfigProblems(env);
  if (problems.length === 0) return;
  throw new Error(`Invalid production configuration:\n - ${problems.join('\n - ')}`);
}
