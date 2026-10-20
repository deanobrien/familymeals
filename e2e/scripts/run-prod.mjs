// pnpm test:e2e:prod: the mock-auth suite against `next build && next start` (cross-platform: sets E2E_MODE for the config).
import { spawnSync } from 'node:child_process';

const r = spawnSync('pnpm', ['exec', 'playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, E2E_MODE: 'prod' },
});
process.exit(r.status ?? 1);
