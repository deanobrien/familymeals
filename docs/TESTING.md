# TESTING.md

Every change must leave `pnpm build`, `pnpm typecheck`, `pnpm lint` and `pnpm test` green; run e2e when you touch UI, routes, stores or fixtures. Latest verified counts per integration pass: [../claude/status-and-next-steps.md](../claude/status-and-next-steps.md).

## 1. Suites

| Suite | Command | What it covers | Needs |
|---|---|---|---|
| Unit (all packages + web) | `pnpm test` (turbo `vitest run` in each workspace; use `pnpm turbo run test --force` to bypass the cache) | engine (largest), `@fr/web` server logic and fakes of Supabase, ai, refdata, domain, recipe-import, ui, plan-orchestrator, e2e fixture validation | nothing |
| One package | `pnpm --filter @fr/engine test`, `pnpm --filter @fr/web test`, ... ; engine coverage thresholds: `pnpm --filter @fr/engine coverage` | | |
| PGlite (migrations + RLS) | `pnpm --filter @fr/db test` (applies every file in `supabase/migrations` to in-process Postgres, runs SQL assert scripts in `packages/db/tests/rls/*.sql`); also `*.pglite.test.ts` in `apps/web/lib/server/supabase/` (repository contract tests against the real migrations) | RLS isolation, RPCs (`record_purchase`, `transfer_ownership`, S2 shopping/receipts/profile/AI settings), privacy lifecycle | nothing (no Docker) |
| Mobile | `pnpm --filter @fr/mobile test` (jest-expo); bundle check `pnpm mobile:export` (delete `apps/mobile/dist` afterwards) | DataSource, offline queue, conflict toasts, import API | nothing |
| End-to-end (Playwright, Chromium) | `pnpm e2e:install` once, then `pnpm test:e2e` | mock-auth/mock-AI full journeys: recipes, import, plan, shopping, receipts, pantry, pantry scan, home/settings, household isolation (UI level), large upload, journey | Chromium; a dev server (Playwright starts one) |
| Accessibility + responsive | part of e2e: `e2e/specs/a11y-audit.spec.ts`, `a11y-responsive.spec.ts` | every route at 375 and 1280 px, light and dark, zero serious/critical axe violations (WCAG 2.1 AA), no horizontal overflow at 375, 44 px touch targets; findings in [../e2e/A11Y-AUDIT.md](../e2e/A11Y-AUDIT.md) | |
| Acceptance matrix | [../e2e/ACCEPTANCE.md](../e2e/ACCEPTANCE.md) maps the brief's milestone acceptance to specs; 17 flows are `test.fixme` because they need live Supabase | | |
| Live Supabase | **not built yet**: lane LV1 (HANDOVER section 7) is running the app and a live-ish suite against the local Docker stack; when it lands this section should name the command | Docker + local Supabase | |

Static checks: `pnpm typecheck` (11 tasks; engine uses `tsconfig.test.json`), `pnpm lint` (ESLint 9 flat config; also enforces the `@fr/ai` server-only import boundary), `pnpm format:check` (Prettier).

## 2. E2E mechanics

- Playwright config `e2e/playwright.config.ts`: `testDir ./specs`, Chromium only, 4 workers (`E2E_WORKERS`), 90 s test timeout, `webServer` = `pnpm --filter @fr/web exec next dev -p $E2E_PORT` (default port 3100) with `reuseExistingServer: !CI` (**an already-running server on that port is reused, with whatever environment it was started with**).
- `e2e/support/global-setup.ts`: `POST /api/dev/reset` (dev-only, 404 in production) to restore the in-memory seed, warms ~14 routes in a real browser (cold Next dev compiles are slow), runs one generate-from-approved-plan in a throwaway sandbox household, then resets again. This is why back-to-back runs against one server pass.
- Sandbox households: specs that write data set the cookie `fr_household=e2e-<id>` (mock-auth mode only). Household A (the demo household) must keep an empty shopping list for the smoke spec. Seed per test with `POST /api/dev/seed` (`{kind:'approved-plan', entries}` or `{kind:'shopping-item', name, value, unit}`) via `context.request` so the cookie applies.
- Specs must not assume they are the only writers to the recipe store (imports add recipes). Reset the shared store **in place** (`resetRecipeRepository`); replacing the instance splits the import sink from the store.
- `E2E_AUTH_CONFIGURED=1` with dummy `NEXT_PUBLIC_SUPABASE_URL/ANON_KEY` pointing at nothing runs the gated-routes variant of `auth.spec.ts` (fails closed to signed-out); without it the mock-auth variant runs.

## 3. Isolation rules (important)

1. **Never let a test touch the owner's `apps/web/.data/`.** It holds the owner's encrypted AI provider key and dev app secret. Always run e2e with your own data directory:
   PowerShell: `$env:APP_DATA_DIR = "$env:TEMP\fr-e2e-data"; $env:NEXT_DIST_DIR = '.next-e2e'; $env:E2E_PORT = '3125'; pnpm test:e2e`
   bash: `APP_DATA_DIR=/tmp/fr-e2e-data NEXT_DIST_DIR=.next-e2e E2E_PORT=3125 pnpm test:e2e`
   Pick a **fresh port** so Playwright starts its own server with this environment instead of reusing someone's `pnpm dev`. `.data-e2e/` and `apps/web/.next-e2e/` are git-ignored.
2. `NEXT_DIST_DIR` keeps the e2e build out of `.next/`, so a developer's `pnpm dev` is never clobbered.
3. Tests use the mock AI provider and mock auth. Never put real keys in tests, fixtures or env for tests.
4. Several agents/lanes may run at once: each uses its own port (3101-3199), `APP_DATA_DIR` and `NEXT_DIST_DIR`.
5. The e2e dev server rewrites `apps/web/tsconfig.json` (Next adds `.next-e2e` include paths); after a run `git checkout apps/web/tsconfig.json` (or `git diff` and drop the change) so it is not committed by accident.

## 4. Flake notes

- A **cold** dev server compiles each route and server action on first use; 16+ workers starve it. Keep `E2E_WORKERS` at 4 (or fewer on a small machine). `next.config.mjs` keeps compiled routes for an hour and ignores `.data`, `test-results` and `playwright-report` in the watcher; without that, files written during a run trigger rebuilds and 10-30 s server actions.
- Observed once (S2 verification): the first run after a very long a11y suite saw two `shopping.spec.ts` timeouts while the server was still compiling; `shopping.spec.ts --repeat-each 3` then passed 30/30 and a second full run was clean. Re-run before concluding a regression: `pnpm --filter @fr/e2e exec playwright test specs/shopping.spec.ts --repeat-each 3`.
- After merging branches that add dependencies, **restart the dev server** (and run `pnpm install`), otherwise e2e fails with unresolved imports from a stale server.
- PGlite is a single-connection embedded Postgres: it cannot exercise concurrent transactions, lock-order or Realtime. Those are exactly the things the live suite (LV1) must cover (D128).
- Windows: a leftover node process can lock native files (sharp/libvips) and fail the next `pnpm install`/package; close node processes or use a fresh path.
- Playwright traces/screenshots land in `e2e/test-results` (git-ignored).

## 5. Writing new tests

- Pure logic: put it in `@fr/engine` with tests in `packages/engine/test/<module>/`; no network, no clocks without injection.
- Supabase repositories: add both a fake-client test and a PGlite contract test that runs the real migrations (pattern: `s2-contract.pglite.test.ts`).
- New migration: add an assert script under `packages/db/tests/rls/` and keep the "RLS enabled on every table" test passing.
- New route/page: add it to the warm list in `e2e/support/global-setup.ts` and to the a11y route list.
- AI features: test with the mock provider and fake clients; live-model accuracy is verified manually and recorded in the lane's decision entry.
