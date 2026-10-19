// `pnpm dev:live`: run the web app against the local Supabase stack (D142). PORT overrides 3131.
import { spawn } from 'node:child_process';
import { REPO_ROOT, localSupabaseEnv } from './local-supabase-env.mjs';

const port = process.env.PORT ?? '3131';
const env = { ...process.env, ...localSupabaseEnv() };
console.log(`Web app on http://localhost:${port} against ${env.NEXT_PUBLIC_SUPABASE_URL} (DATA_BACKEND=supabase).`);
console.log(`Emails (sign-up confirmation, password reset): ${env.LOCAL_MAILPIT_URL}`);
const child = spawn('pnpm', ['--filter', '@fr/web', 'exec', 'next', 'dev', '-p', port], {
  cwd: REPO_ROOT,
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
child.on('exit', (code) => process.exit(code ?? 0));
