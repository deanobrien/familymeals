/**
 * Production configuration checks (D150). Pure: takes an env object, returns problems. Edge-safe (no node imports).
 *
 * Run at server start by `instrumentation.ts` (fail fast with a readable message in the App Service log stream) and
 * summarised, without detail, by `/api/health`.
 *
 * Refused in production: mock auth (no Supabase env), the mock AI provider, the in-memory demo data backend, a missing
 * or weak APP_SECRET, and the local-file store (uploaded photos; AI settings are Supabase since S2, D126) unless explicitly allowed
 * with ALLOW_LOCAL_FILE_STORE=true (first test deploy only; data then lives under APP_DATA_DIR, default /home/data,
 * which App Service persists).
 */
export interface ProdEnv {
  NODE_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  DATA_BACKEND?: string;
  APP_SECRET?: string;
  AI_PROVIDER?: string;
  AI_ALLOW_MOCK_IN_PRODUCTION?: string;
  ALLOW_LOCAL_FILE_STORE?: string;
  SUPABASE_DATA_CONTEXT?: string;
}

export function isProduction(env: ProdEnv = process.env as ProdEnv): boolean {
  return env.NODE_ENV === 'production';
}

export function localFileStoreAllowed(env: ProdEnv = process.env as ProdEnv): boolean {
  return env.ALLOW_LOCAL_FILE_STORE?.trim().toLowerCase() === 'true';
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
  const secret = env.APP_SECRET?.trim();
  if (!secret) p.push('APP_SECRET is required (at least 16 characters).');
  else if (secret.length < 16) p.push('APP_SECRET must be at least 16 characters.');
  if (env.AI_PROVIDER === 'mock' || env.AI_ALLOW_MOCK_IN_PRODUCTION === 'true') {
    p.push('The mock AI provider is refused in production: unset AI_PROVIDER=mock / AI_ALLOW_MOCK_IN_PRODUCTION.');
  }
  if (env.SUPABASE_DATA_CONTEXT === 'service') {
    p.push('SUPABASE_DATA_CONTEXT=service is a development-only fallback: remove it.');
  }
  if (!localFileStoreAllowed(env)) {
    p.push(
      'Uploaded recipe photos still use local files (not Supabase Storage yet; AI provider settings moved to Supabase in S2, D126). For a first test deploy set ALLOW_LOCAL_FILE_STORE=true (data goes to APP_DATA_DIR, default /home/data); otherwise wait for Supabase Storage uploads.',
    );
  }
  return p;
}

export function assertProductionConfig(env: ProdEnv = process.env as ProdEnv): void {
  const problems = productionConfigProblems(env);
  if (problems.length === 0) return;
  throw new Error(`Invalid production configuration:\n - ${problems.join('\n - ')}`);
}
