# Decisions

## D1 Monorepo: pnpm workspaces + Turborepo (2026-10-19)

Per BRIEF-REVIEW: enables parallel lanes and later Expo reuse of shared packages. Workspaces: `apps/*`, `packages/*`, `e2e`.

## D2 Scope `@fr/*`

Short for Family Recipes; neutral to the still-undecided product name, so a rename never touches imports.

## D3 Packages export TS source, no emit

`main`/`exports` point at `src/index.ts`; web uses `transpilePackages`; package `build` is a `tsc` type-check. Avoids build-order coupling in dev and keeps lanes independent. Revisit if a package must be published or consumed by a non-bundler.

## D4 Supabase config at repo-root `supabase/`

The CLI default location, so `supabase start` / `db push` work with no flags. `packages/db` holds generated types and helpers only. Migrations live in `supabase/migrations`, timestamped; later lanes add lane-named migrations. The baseline migration enables `pgcrypto` only; the schema is lane L1.

Modes: local stack (`supabase start`, needs Docker; Docker 20.10 on the TFS box may be too old) and cloud (London eu-west-2, `supabase link` + `db push`).

## D5 Test stack

Vitest per package/app (run through turbo), Playwright in `e2e/` (Chromium; starts the web dev server on port 3100), pgTAP/SQL tests for RLS later (L6). ESLint 9 flat config with typescript-eslint (no eslint-config-next yet; lane L2 may add it). Prettier: single quotes, 100 columns. The `@fr/e2e` script is named `e2e` so `turbo run test` does not launch Playwright.

## D6 Env handling

All variables are server-only (no `NEXT_PUBLIC_`). `AI_PROVIDER=mock` by default. `.env*` is git-ignored except `.env.example`.

## D7 Dev server port 3100

Avoids clashing with other local apps on 3000.

## D8 Merge batch 1: workspace version alignment (2026-10-19)

Root `pnpm.overrides` pin zod ^4.6.7, typescript ~5.7.2, vitest ^2.1.9, react/react-dom ^19, @types/node ^22, @types/react(-dom) ^19. Lane pins (L2a exact versions, L6 TS 7 / vitest 5 / @types/node 26) normalised to carets matching the workspace. `onlyBuiltDependencies`: sharp, esbuild, supabase. Per INTEGRATION-NOTES ratified table.

## D9 @fr/ui

Lane L2a merged as-is (plain CSS tokens, `@fr/ui/styles.css`, `@fr/ui/tokens.css`). `src/index.ts` is marked `'use client'` so the whole kit is one client boundary and server components (placeholder pages' `EmptyState`) can render it. Local `ValueStatus`/`PriceKind` kept with TODO(@fr/domain) because domain is not merged yet. The Vite demo stays at `packages/ui/demo` (own scripts `demo`/`demo:build`); package `build` is the tsc check only, so turbo never builds the demo.

## D10 @fr/ai server-only

`import 'server-only'` at the top of `@fr/ai` index (fails any client bundle at build time) plus an ESLint `no-restricted-imports` rule limiting `@fr/ai` in apps/web to `app/api/**` and `lib/server/**`. Vitest aliases `server-only` to a stub (`packages/ai/test/server-only-stub.ts`). `no-explicit-any` is disabled for `packages/ai` (Anthropic SDK boundary and test doubles). apps/web does not import it yet. zod ^4.6.7. The mock-in-production guard and its tests are unchanged from L4 (INTEGRATION-NOTES #8 CI test still to add).

## D11 @fr/refdata

zod 3 to 4: no source changes were needed (schemas compile and all 29 tests pass on 4.6). `data/out/*.json` (3.1 MB) committed; `data/raw/*.xlsx` (4.5 MB) git-ignored and re-download steps added to SOURCES.md.

## D12 L6 QA layout and fixture tests

No separate package: fixtures live in `e2e/fixtures`, specs in `e2e/specs`, helpers/page objects in `e2e/support`, the generator + zod fixture contract in `e2e/fixtures-src`. Fixture validation runs under vitest inside `@fr/e2e` (`pnpm --filter @fr/e2e test`, picked up by `pnpm test`); Playwright stays on `pnpm test:e2e` (script `e2e`). L6's `playwright.spec-check.config.ts` and `package-lock.json` dropped. L6 contract (zod mirror) is still local to `e2e/fixtures-src/contract.ts`; TODO swap to `@fr/domain` schemas once L1 merges and apply the receipt-shape field mapping from INTEGRATION-NOTES. Typescript module settings moved from NodeNext to the workspace Bundler base.

## D13 App shell

`apps/web/app/shell.tsx` (client) wraps `ToastProvider` + `AppShell` (next/link via `linkComponent`; active nav key from `usePathname`). Root layout loads Fraunces (display) and Inter (body) via next/font/google with `--font-display`/`--font-body` variables, so `next build` needs network access to Google Fonts. Placeholder pages: /recipes, /plan, /shopping, /household, /settings, each an h1 + `EmptyState`. `@fr/ui` added to `transpilePackages`. Smoke test rewritten for the shell (sidebar nav labelled "Main", bottom nav "Main (mobile)", aria-current, all five routes).

## D14 Known gap

`@fr/ui` AppShell uses `DEFAULT_NAV` with label "Meal planner" at `/plan`; `PLACEHOLDER_NAV` in `@fr/domain` is now unused by the app except `APP_NAME` (L1 merge can drop it).
