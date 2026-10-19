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

## D15 @fr/engine merge (batch 2, 2026-10-19)

One package, relative internal imports, extensionless; per-lane package.json/tsconfig/lockfiles dropped. Tests moved to `packages/engine/test/<module>/` (core = `test/core`, plus `test/integration` running parse -> match -> scale -> aggregate -> cost -> nutrition on `@fr/refdata`). Single `src/contract.ts` (CONTRACT-SEED, TODO `@fr/domain`). `UnitConverter` interface names are kept per module but are aliases of `QuantityConverter`/`GramsConverter` from `src/units/converter.ts`, a thin adapter over L3 `convertQuantity`; L10 `toBase` now delegates to L3 `toBaseAmount` (`PINT_ML` deleted, pint = 568.26125). Ranges: cost max, nutrition midpoint. zod ^4.6.7 as engine dependency (planner schemas only). Engine purity ESLint rule (no `node:*`, `sharp`, `@fr/ai`); ESLint ignores `.claude/**` (agent worktrees). Behaviour change: L7 `proportionalCost` treats a unitless count as `item` instead of `missing_unit`. Root index exports L3 core only because sub-modules reuse names. Package typecheck includes tests via `tsconfig.test.json`; `build` checks src only.

## D20 Merge batch 3: @fr/domain + schema (2026-10-19)

L1 merged: `packages/domain` (`@fr/domain`, zod 4; primitives, CONTRACT-SEED shapes, row schemas, RPC DTOs, db-mapping, tests incl. the compile-time CONTRACT-SEED conformance check), `packages/db` (PGlite migration + RLS runner, `tests/rls`, `tests/support/supabase-stub.sql`, `src/database.types.ts` placeholder) and `supabase/migrations/` (L1 0001-0013 renamed to `2026101900NN00_<name>.sql`, same order, after the baseline). The baseline's pgcrypto and 0001's pg_trgm do not conflict, so no extension line was removed; the PGlite runner loads both contrib extensions. `APP_NAME`/`PLACEHOLDER_NAV`/`PACKAGE_NAME` kept in `packages/domain/src/placeholder.ts` because apps/web imports them. Full schema notes: `supabase/SCHEMA.md`. (Numbered D20+ to avoid colliding with the parallel engine batch.)

## D21 Owner decision A: purchase history survives account deletion

`purchase_events.created_by` and `voided_by` are nullable with `ON DELETE SET NULL`; new `created_by_display_name` snapshot (BEFORE INSERT trigger: member display name, else person profile name). The append-only trigger allows the FK anonymisation UPDATE (actor columns only going to NULL). `@fr/domain`: `PurchaseEventRow.createdBy` nullable + `createdByDisplayName`; contract `PurchaseEvent.createdBy` unchanged (required for new events). Migration `20261019001400_owner_decisions.sql`.

## D22 Owner decision B: household-custom ingredients deferred

No change. `ingredients` stays reference-only; future work is a nullable `household_id` (shared-or-own). Recorded in SCHEMA.md.

## D23 Owner decision C: SQL converts metric only

SQL (`metric_base_factor`, `shopping_item_outstanding`) converts mg/g/kg and ml/l only; imperial/cup/tsp/tbsp/floz/pint conversion stays in `@fr/engine/units` (pint 568.26125 ml). Confirmed in SCHEMA.md; no code change.

## D24 Owner decision D: read-only during the 14-day deletion grace

`is_household_writable()` (active member + household `active`) replaces `is_household_member()` in every INSERT/UPDATE/DELETE policy (public + storage, rewritten dynamically in 0014; a test asserts none remain). Owner-gated writes also require `household_is_active()`; RPC-only writers (`record_purchase`, `void_purchase`, `create_invitation`, `accept_invitation`) are guarded by `guard_household_writable()` triggers for end-user calls. `cancel_household_deletion()`, `member_leave()`, consent withdrawal and service-role purge still work. Tests: `packages/db/tests/rls/004_owner_decisions.sql`.

## D25 Ratified contract rules applied in @fr/domain

`Quantity` adopts L6 strictness for `approximate` (needs `approxLabel`, no unit); servings were already positive integers. SQL `quantity_is_valid()` is deliberately left looser (zod is the stricter gate). Canonical receipt wire shape added as `ReceiptParseLine`/`ReceiptParse` (`{ rawText, quantity?, pricePence, discountPence >= 0 }`) - not named `ReceiptLine`, which is the persisted row schema. `ExtractedRecipe` and `PlanConstraints` are not in `@fr/domain` yet (arrive with the ai/engine swap).

## D26 @fr/ui and e2e swapped to @fr/domain

`@fr/ui` imports `ValueStatus`/`PriceKind` types from `@fr/domain` (type-only; re-exported unchanged, `@fr/domain` added as a dependency). `e2e/fixtures-src/contract.ts` now imports Uuid/IsoDate/Unit/Quantity/PurchaseEvent/RecipeIngredientLine etc. from `@fr/domain`; QA-only shapes (ExtractedRecipe, ReceiptLine with negative discount lines and expected-* fields, HouseholdSeed) stay local, with `toCanonicalReceiptLines()` mapping `rawText/quantity/linePricePence` onto `ReceiptParseLine` (negative discount lines become positive `discountPence` on the previous item line). Fixture JSON shapes did not change, so nothing was regenerated.

## D27 Merge batch 4: app lanes + one Next config (2026-10-19)

Merged into `prj018/w0a-skeleton`: L1 (domain/schema), L23 (home/settings/privacy), L12 (recipe library), L13 (photo import + `@fr/recipe-import`), L15/L16 (planner + `@fr/plan-orchestrator`), L22 (pantry UI). `apps/web/next.config.mjs` is one config: `transpilePackages` lists every workspace package apps/web imports (`@fr/ai`, `@fr/domain`, `@fr/engine`, `@fr/plan-orchestrator`, `@fr/recipe-import`, `@fr/refdata`, `@fr/ui`) and one webpack `extensionAlias` (`.js -> .ts/.tsx/.js`, `.mjs -> .mts/.mjs`) because `@fr/recipe-import` uses NodeNext-style `./x.js` specifiers. `apps/web/vitest.config.ts` has one `server-only` alias (`lib/server/import/server-only-stub.ts`). `pnpm-lock.yaml` conflicts resolved by regenerating with `pnpm install`. `.claude/` git-ignored.

## D28 Server-only ingredient catalogue in apps/web

`@fr/refdata` loaders read files relative to `import.meta.url`, which webpack breaks, so `@fr/refdata` exports its built `data/out/ingredients.json` as `@fr/refdata/ingredients.json` and `apps/web/lib/server/refdata/catalogue.ts` (`import 'server-only'`) builds one process-wide catalogue: CanonicalIngredient list, `@fr/engine/normalise` `IngredientMatcher`, and catalogue-backed `createQuantityConverter` / `createGramsConverter`. A drift test compares the JSON with `loadSeed()`. Import, pantry and the library seed all use it; the pantry's `data/ingredients.json` snapshot was removed (`gen-seed.mjs` now only regenerates `recipes.json`). `@fr/engine/pantry` index additionally exports `exactQ`, `fmtQ`, `isExact`, `round6`, `today`; the pantry `_vendor` copy is gone.

## D29 PlanConstraints mapping lives in one adapter (deviation from the ratified table)

The ratified decision was one schema with `@fr/ai` importing the engine planner schema. Not done yet: the `@fr/ai` `PlanConstraintsSchema` is the LLM-facing shape (name-based exclusions, fraction proportions, a `quickMealDays` count) and its prompt and mock fixtures depend on it. Instead `apps/web/lib/server/plan/engine-solver.ts` is the single mapping to `@fr/engine/planner` (`toEngineConstraints`, `toEngineCandidate`, `fromEngineProposal`), unit-tested: fractions -> `{fraction}`; `quickMealDays` -> that many plan dates, weekdays first, <= 30 min; `excludeIngredients` -> engine `excludeTerms` (the orchestrator also hard-filters by name before solving and at approval); plan-servings cost -> per-serving pence; candidates without a diet category are dropped. `allowUnverifiedIngredients: true` because candidates carry names only, not canonical ids. Approval re-validates with `validatePlan` over candidates loaded from the recipe store. TODO: make `@fr/ai` emit the engine schema and pass ingredient ids + unmatched lines.

## D30 One in-memory recipe store

The library repository (`lib/recipes/factory.ts`, `InMemoryRecipeRepository`) is the single store behind the existing interfaces: photo import's `RecipeSink` (`RepositoryRecipeSink`, saves under the `finaliseDraft` id so `/recipes/[id]` works, provenance kept beside it), the planner's `PlanRecipeSource` (`RepositoryPlanRecipeSource`, default in `createPlanServices`) and the pantry's `RecipeSummarySource` (`RepositoryRecipeSummarySource`). Library ingredient lines gained optional `ingredientId` (seed lines matched by the engine matcher at startup; kept across edits when the name is unchanged); `create()` takes an optional upstream id. Import -> library mapping: diet from tags (vegan/vegetarian/fish), else `meat` (conservative: never wrongly vegetarian); servings default 4 when the photo gave none; meal type `dinner`. Planner mapping: lunch/dinner recipes are interchangeable main meals, `quick` tag when total time <= 30 min, cost per serving null when unknown; demo favourites = library favourites. Fixture-backed sources stay for unit tests. Supabase adapters replace the in-memory classes later.

## D31 Navigation

`@fr/ui` `NavKey` adds `pantry` and `receipts`; `DEFAULT_NAV` = Home, Recipes, Meal planner, Shopping list, Pantry, Receipts, Household, Settings. `NavItem.mobile: false` keeps Receipts out of the phone bottom bar (7 items; grid now sized by item count). `/receipts` is a placeholder link (404) until the receipts lane merges.

## D27m L14 mobile: apps/mobile (2026-10-19)

Expo SDK 58 app merged as `@fr/mobile`. **Linker: the workspace keeps pnpm default isolated linker** (no `node-linker=hoisted`, no root `.npmrc` change, web/Next untouched). Expo SDK 58 / Metro supports isolated installs (symlinks + package exports on by default); `expo export`, jest-expo and expo-doctor all pass without hoisting, so the L14 `.npmrc` was dropped and no `public-hoist-pattern` entries were needed. `metro.config.js` relies on Expo automatic monorepo config and only adds the `@fr/ai` guard (throws); ESLint also forbids `@fr/ai` and `@fr/ui` in `apps/mobile`. `src/contract.ts` deleted: shared types come from `@fr/domain` (type-only imports); Household/Recipe/ShoppingListItem/UserSession stay mobile-local in `src/viewModels.ts`. `@fr/engine` not added (unused). Workspace typescript (~5.7) and react overrides apply to mobile (excluded from `expo install --check` via `expo.install.exclude`). Mobile has no `build` script so turbo `build` skips it; `typecheck` and `test` (jest-expo) run in root `pnpm typecheck` / `pnpm test`. Bundle check: `pnpm mobile:export` (output `apps/mobile/dist`, git-ignored; delete after).

## D70 M2 mobile: SupabaseDataSource (2026-10-19)

`apps/mobile/src/data/supabaseDataSource.ts` implements `DataSource` with supabase-js (anon key + user session only; RLS decides visibility). `createDataSource()` picks it when `EXPO_PUBLIC_SUPABASE_URL` and the anon key are set, otherwise the mock; `EXPO_PUBLIC_DATA_SOURCE` is gone. Reads: households (+ active member counts), active recipes, recipe detail (ingredients/steps/per-serving nutrition profile; unknown/unavailable nutrients carry no value so the UI says "Unknown"). The shopping list is the household's newest `active` `shopping_lists` row. `DataSource` grew `getAccessToken`, `undoTick`, `takeConflicts`, optional `setOnline`; the mock implements them too.

## D71 Shopping sync = the L17a engine client model over the command log

`@fr/mobile` now depends on `@fr/engine` (subpaths `./shopping`, `./units`; the D27m "engine not added" note is superseded). Per household the data source holds the engine `ClientState`: `confirmed` (snapshot + replayed log) at `cursor`, ordered `pending`, optimistic view = pending over confirmed (`clientView`/`deriveAll`). Snapshot = `shopping_list_items` + `purchase_events` with the cursor (max `shopping_command_log.seq`) read BEFORE the rows. Catch-up = `shopping_command_log` rows with `seq > cursor` mapped to engine `LogEntry`s (`tick`/`purchase`/`void` -> tick/purchase/undo) and ingested with `clientIngest`. Anything it cannot replay (add/edit/remove/regenerate entries, a seq gap, a full page of 500, or an applied purchase the engine replay did not reproduce) falls back to a fresh snapshot via `clientResync`, which keeps `pending`. Writes go only through `record_purchase` / `void_purchase` (client-generated command id = idempotency key; rejections are data). Ticks pass the engine's `expectedOutstanding` + `expectedEventCount` from `confirmed`; if the server answers `needs_engine_outstanding` it has already consumed that command id, so the client resnapshots and re-sends the tick ONCE under a new id (then reports a conflict). The unit converter has no ingredient lookup (no refdata in the app), so density conversions are not attempted client-side. Realtime subscriptions are not used: resync happens on screen focus, app foreground, pull-to-refresh and reconnect.

## D72 Offline queue persistence and replay

`OfflineStore` (AsyncStorage) persists `pending` commands per household (`fr.shopping.v1.pending.<hh>`) and the last confirmed snapshot (`...snapshot.<hh>`, cache only) so a cold start with no signal shows the cached list with queued ticks applied. Corrupt entries are dropped, never thrown. NetInfo (`@react-native-community/netinfo`) feeds `AppProvider`: on offline -> `ds.setOnline(false)` (no delivery attempts, banner shown); on reconnect -> `ds.flushPending()` then a `syncVersion` bump so screens re-read and drain conflicts. Flush sends commands in order and stops at the first transient failure (no code / network / PGRST0xx / 5xx); acknowledged commands are dropped only after the log sync that folds them into `confirmed`, and a re-send after a lost response gets `duplicate: true` (counted as delivered, no double purchase). Final errors (e.g. `P0002` item gone) become a conflict, never an endless retry.

## D73 Conflict toasts

A rejected own command (already_complete, already_voided, item removed/not found, invalid quantity) is surfaced once (deduped by command id, whether seen via the RPC reply or the replayed log) as a `ShoppingConflict` and drained with `ds.takeConflicts()` into a dismissible `Toast` (`role=alert`, assertive live region). `already_complete` names the winner from `household_members.display_name` ("Sam already got Milk."); an unnamed member reads "Someone". Ticked items offer Undo (`void_purchase`, append-only, also queued offline).

## D74 Recipe import from the phone (client; server change pending)

`CaptureScreen` captures with the camera or picks from the library (max 6 pages = the web route's `MAX_FILES`; was 8), lets the user rotate (`expo-image-manipulator`, 90 degrees clockwise) or remove pages, downsizes to 1600px JPEG, and POSTs multipart `images[]` (+ `householdId`) to `${EXPO_PUBLIC_API_BASE_URL}/api/extract` with `Authorization: Bearer <supabase access token>`; the AI key never reaches the app. `ImportReviewScreen` is a read-only summary (title, servings, ingredient lines flagged "Check", steps, blocking issues, duplicate hint). Save posts `{uploadId, draft}` (the draft is opaque, sent back unchanged) to `/api/extract/save`; blocking issues disable Save and "Finish on web" opens `/recipes/import`. **Server change needed (apps/web, not done here):** the two routes have no auth and save to the process-wide in-memory store, so before this works against a deployed web app they must (1) verify the bearer token (`supabase.auth.getUser`), (2) read `householdId` and check membership, (3) save through a Supabase-backed `RecipeSink` for that household. Until then a recipe saved from the phone lands in the web server's in-memory store and will not appear in the mobile list.

## D75 Polish: states, accessibility, dark mode

`screens/ui.tsx` is theme-aware (`useColorScheme`; light/dark palettes; `useStyles`, themed `Text`/`Muted`), exports `Loading`, `EmptyState`, `ErrorState` (retry), `Toast`, and a 48dp minimum tap target for buttons, rows and inputs. Every list screen has loading, empty and error-with-retry states and pull-to-refresh; controls carry `accessibilityLabel`/role/state (shopping rows read "Milk, 2 l, Dairy, bought"), headers use `accessibilityRole="header"`, errors/toasts are `role=alert`. Stack/tab navigators follow the theme. `app/index.tsx` redirects to `/households` when a persisted session exists, else `/sign-in`.

## D76 Test strategy for M2

`__tests__/helpers/fakeSupabase.ts` is a fake supabase-js client (in-memory tables, query builder subset, auth, and `record_purchase`/`void_purchase` mirroring migration 0013: idempotency on command id, `already_complete` + `completedBy`, `needs_engine_outstanding`, log rows with `seq`). It can go offline, drop RPC responses after applying them, and act as a second household member. Covered: offline queue persistence across a simulated restart, replay once, lost-response idempotency, lost-race conflict, incremental log catch-up (no item refetch), unreplayable-entry snapshot fallback, undo, stale-count re-issue, final-error reporting, screens (offline banner, reconnect replay, toast, undo, capture/rotate/remove/upload/review/save/finish-on-web, blocking issues) and the import client (multipart, bearer, error mapping).
