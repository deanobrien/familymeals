// Reads the running local Supabase stack (`pnpm exec supabase start`) and returns the env the web app needs to run
// against it (DECISIONS D142). Local-only demo keys: the CLI prints the same well-known keys on every machine.
import { execSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `supabase status -o json`, or throws a readable error when the stack is not running. */
export function readLocalSupabaseStatus() {
  let out;
  try {
    out = execSync('pnpm exec supabase status -o json', { cwd: REPO_ROOT, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  } catch {
    throw new Error('Local Supabase is not running. Start it with `pnpm exec supabase start` (needs Docker).');
  }
  const json = out.slice(out.indexOf('{'), out.lastIndexOf('}') + 1);
  const s = JSON.parse(json);
  if (!s.API_URL || !s.ANON_KEY || !s.SERVICE_ROLE_KEY) throw new Error('supabase status did not report API_URL / ANON_KEY / SERVICE_ROLE_KEY.');
  return s;
}

/**
 * Env for `next dev` against the local stack. APP_DATA_DIR is a temp dir so the owner's `apps/web/.data`
 * (saved AI provider key) is never read or written; NEXT_DIST_DIR keeps the build apart from `pnpm dev`.
 */
export function localSupabaseEnv({ dataDirName = 'fr-live-supabase-data', distDir = '.next-live', siteUrl } = {}) {
  const s = readLocalSupabaseStatus();
  const dataDir = join(tmpdir(), dataDirName);
  mkdirSync(dataDir, { recursive: true });
  return {
    NEXT_PUBLIC_SUPABASE_URL: s.API_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: s.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: s.SERVICE_ROLE_KEY,
    DATA_BACKEND: 'supabase',
    AI_PROVIDER: 'mock',
    APP_DATA_DIR: dataDir,
    NEXT_DIST_DIR: distDir,
    ...(siteUrl ? { NEXT_PUBLIC_SITE_URL: siteUrl } : {}),
    // Local mail catcher (Mailpit) for confirmation / invite emails.
    LOCAL_MAILPIT_URL: s.MAILPIT_URL ?? s.INBUCKET_URL ?? '',
  };
}
