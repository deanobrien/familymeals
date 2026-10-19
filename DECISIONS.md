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

`@fr/ui` `NavKey` adds `pantry` and `receipts`; `DEFAULT_NAV` = Home, Recipes, Meal planner, Shopping list, Pantry, Receipts, Household, Settings. `NavItem.mobile: false` keeps Receipts out of the phone bottom bar (7 items; grid now sized by item count). `/receipts` was a placeholder link until the receipts lane merged (batch 5, D33).

## D32 L14 mobile: apps/mobile (2026-10-19)

Expo SDK 58 app merged as `@fr/mobile`. **Linker: the workspace keeps pnpm default isolated linker** (no `node-linker=hoisted`, no root `.npmrc` change, web/Next untouched). Expo SDK 58 / Metro supports isolated installs (symlinks + package exports on by default); `expo export`, jest-expo and expo-doctor all pass without hoisting, so the L14 `.npmrc` was dropped and no `public-hoist-pattern` entries were needed. `metro.config.js` relies on Expo automatic monorepo config and only adds the `@fr/ai` guard (throws); ESLint also forbids `@fr/ai` and `@fr/ui` in `apps/mobile`. `src/contract.ts` deleted: shared types come from `@fr/domain` (type-only imports); Household/Recipe/ShoppingListItem/UserSession stay mobile-local in `src/viewModels.ts`. `@fr/engine` not added (unused). Workspace typescript (~5.7) and react overrides apply to mobile (excluded from `expo install --check` via `expo.install.exclude`). Mobile has no `build` script so turbo `build` skips it; `typecheck` and `test` (jest-expo) run in root `pnpm typecheck` / `pnpm test`. Bundle check: `pnpm mobile:export` (output `apps/mobile/dist`, git-ignored; delete after).

## D33 Merge batch 5 + shopping wiring (2026-10-19)

Merged (--no-ff, `pnpm-lock.yaml` always regenerated with `pnpm install`): L17 shopping UI, L21 receipts UI (its `next.config.mjs` changes folded into the D27 config: `serverExternalPackages: ['sharp']`, 16 MB server-action body limit; one vitest `server-only` stub), L11 auth/households/invitations (`@supabase/ssr`), L14 Expo app (`apps/mobile`, its decision renumbered D27 -> D32). Shopping: `lib/shopping/engine.ts` re-exports `@fr/engine/shopping` (vendored copy deleted); the client converter is `createQuantityConverter()` without ingredient data, the server repository uses the refdata catalogue converter, and the server stays authoritative. `/shopping?plan=<id>` reads the household's APPROVED plan (`ApprovedPlanRequirementSource`: plan store -> recipe store -> `@fr/engine/aggregate`, scaled by planned servings / recipe servings, full provenance with the planner's `plannedMealId`, aisle from the refdata category; drafts are refused). The planner's "Generate shopping list" creates the list through `onShoppingRequirements` (wired in `getPlanServicesFor`) and its preview uses the same aggregation. One plan store (`getPlanStore()`); planner services are cached per household.

## D34 Receipts and the shared price store

`lib/receipts/matcher.ts` imports `@fr/engine/receipt-match` (vendored copy deleted). Receipt outstanding items = the household's shopping list (`ShoppingOutstandingSource`, canonical names/aliases from the catalogue). Confirmed lines become `purchase` commands on that list (idempotent on the PurchaseEvent id; a unit the list cannot compare falls back to a deterministic-id `tick`), so they tick items on /shopping. Line prices go into ONE in-memory price store (`lib/server/prices/store.ts`): refdata generic estimates (`@fr/refdata/prices.json` export) plus per-household `receipt` observations. The shopping basket estimate is `@fr/engine/cost` (`proportionalCost` + `rankObservations`) over a `PriceBook` the page builds from that store, so receipt > generic estimate; hand-added items are priced through a name index (exact names/aliases before plural guesses). Estimate labels unchanged. The recipe cost calculator (D60) gets the same store as its `PriceSource` (`asPriceSource()`: recorded observations only, versioned), so receipt prices also beat generic estimates in library/planner costs; because the calculator and recipe store are process-wide this source spans every household (in-memory demo limitation; household-scope it with Supabase). Receipt parsing uses the Settings AI provider (D41). Pantry adds from receipts still go to the in-memory sink only.

## D35 Household context everywhere; mock auth is a seeded demo

`lib/server/context.ts` `getAppContext()` (over `requireHouseholdContext()`) supplies householdId/userId/readOnly to shopping, planner, pantry and receipts; the shopping `fr_household` stub cookie, the pantry/planner/receipts hard-coded households and the localStorage shopper id are gone (the shopping server replaces each command's `actor` with the session user). Mock-auth mode (no Supabase env, never in production) = demo user Alice Smith in household A (`a1a1a101-...`, the QA fixture household), with a banner on every page. Dev/test only: an `fr_household=e2e-<id>` cookie selects an isolated, empty sandbox household so parallel e2e tests do not share state; any other value is ignored. Read-only households (pending deletion) are refused by the shopping/planner/pantry write actions. The shell hides app navigation on auth routes. Invite -> sign-up keeps the invite as `next` (through errors, the confirmation e-mail callback and an immediate session). Planner member names/exclusions are still demo values per household.

## D36 e2e: dev-only reset/seed endpoints

`POST /api/dev/reset` (wipes shopping, plans, pantry, receipts, receipt prices; restores the recipe store IN PLACE so holders such as the import sink keep the same instance) and `POST /api/dev/seed` (approved plan or shopping item for the cookie household). Both answer 404 when `NODE_ENV=production`. Playwright `globalSetup` resets, warms the main routes in a real browser (server render + client chunks) and runs one generate-from-plan in a throwaway sandbox (compiles the shopping server actions), then resets again. Timeouts raised (expect 15 s, navigation 60 s, test 90 s); `workers` default 4 (`E2E_WORKERS`; 16 workers starve a cold dev server); `E2E_PORT` picks the port. `next.config.mjs` (dev only) keeps compiled routes for an hour (`onDemandEntries`) and stops watching `.data` / `test-results` / `playwright-report`, which were triggering rebuilds mid-run. `pnpm test:e2e` passes twice in a row on the same freshly started server.

## D37 transfer_ownership RPC

Migration `20261019001500_transfer_ownership.sql`: `transfer_ownership(p_household_id, p_new_owner_member_id)`, SECURITY DEFINER, locks the household, caller must be the active owner of an active household (refused during the deletion grace period, D24), target another active member; promote then demote in one transaction (last-owner guard holds). Errors 42501 / 22023. PGlite test `packages/db/tests/rls/005_transfer_ownership.sql`; the household transfer action calls the RPC.

## D38 Line endings and CI

`.gitattributes`: `* text=auto eol=lf`, images/fonts/pdf/xlsx/zip binary; renormalised (the index was already LF). `.github/workflows/ci.yml` (not run, no remote): `checks` = frozen install, typecheck, lint, test, build; `e2e` = chromium + `pnpm test:e2e` with mock providers (no Supabase env, `AI_PROVIDER=mock`).

## D60 Real cost and nutrition: one server-only calc module (lane C1)

`apps/web/lib/server/calc/` (`import 'server-only'`) replaces the placeholder seed values. `costRecipe` = `@fr/engine/cost` over refdata generic prices (`@fr/refdata/prices.json`) plus household observations from an injected `PriceSource` (`observations()` + `version()`; the engine ranks user_confirmed > receipt > retailer_verified > generic_estimate, so household prices win automatically); `nutritionForRecipe` = `@fr/engine/nutrition` over per-100g CoFID profiles (`@fr/refdata/cofid.json`, linked through each ingredient's `cofid.code`; a `proxy` mapping marks every value an estimate). `createRecipeCalculator` caches the full result per recipe VERSION (id + `updatedAt` + servings + price-source version), so an edit recomputes and a price change invalidates. `@fr/refdata` gained `./prices.json` and `./cofid.json` exports (JSON imports, no fs, like D28); a drift test compares prices.json with `loadSeed()`. Result shapes live client-safe in `lib/calc/types.ts`.

## D61 Nutrition policy

Per serving = recipe total / recipe servings. Unknown never becomes 0: an ingredient without a CoFID profile, or one whose weight cannot be resolved, makes every dependent nutrient `unknown` with the sum of the known parts only as `lowerBound` (shown as a note, never as the value). Non-optional "to taste" lines are treated as negligible (engine `treatToTasteAsNegligible`, reported in `warnings`) so salt/pepper do not blank every recipe; ranges use the midpoint, unit-weight and bracketed/proxy CoFID values are flagged `estimate`. The detail page scales ingredients with the servings stepper, so per-serving values stay constant and the per-recipe tab = per-serving x chosen servings. The page always shows "Estimated from UK CoFID data (...)" and the engine `NUTRITION_DISCLAIMER`; coverage % and the list of ingredients without data are shown.

## D62 Cost labelling and partial costs

The cost figure is the sum of PRICED lines only. When any non-optional line cannot be priced the result is `isPartial` and every surface says "At least": detail page ("At least £x per serving", "partial" badge, "n of m ingredients priced", uncosted lines listed with reasons), planner slot, week cost label ("... N meals with unpriced ingredients") and recipe search. The whole figure is labelled with the LEAST trusted price kind used (`generic_estimate` -> "estimate") and the price source and date are printed. Nothing priceable at all = unknown (null), never 0. `RecipeCost.partial` carries the flag on `RecipeView`. Known weakness: library sort-by-cost and price bands rank by the (possibly partial) lower bound, so a recipe with a missing price can look cheaper than it is; the card does not show the partial flag yet (needs a `@fr/ui` `RecipeCard` prop).

## D63 Cost and nutrition are derived, not stored; seed placeholders removed

`RecipeView.cost` / `nutritionPerServing` are no longer stored or seeded. `InMemoryRecipeRepository` takes an optional `RecipeSummariser` (the server factory injects the calculator) and fills both fields on every read (`view()`), so list sort/filter/price bands, `get`, `create`, `update` and `duplicate` always reflect the current recipe version and prices; with no summariser (unit tests of other lanes, import pipeline tests) cost is null and nutrition empty. `seed.ts` lost `totalPence`/`nutrition` enrichment and the fake nutrient rows; fixtures are untouched. Specs and tests asserting placeholder numbers (0.95/5.70, "Cost unknown" for the flapjacks recipe) now assert computed values or the partial/unknown behaviour.

## D64 Planner: computed costs and weekly nutrition

`RepositoryPlanRecipeSource` takes an optional `nutritionOf` (calc `nutritionPerServing`); `PlanRecipe`/`RecipeLite` carry `costPartial` and the per-serving `NutrientMap`. `weekCost` counts partial meals and says "At least". `lib/plan/nutrition.ts` runs the engine `summariseWeek` client-side over the page's recipes, so the new "Nutrition this week" panel (`app/plan/week-nutrition.tsx`) updates live as the grid changes: week total, average per planned day and average per serving, `Unknown` where any meal lacks data, count of meals without nutrition, the engine disclaimer constant, no targets or adequacy language. Eating-out and leftovers meals are excluded. `loadFixtureRecipes` (fixture-backed `InMemoryPlanRecipeSource`, unit tests only) keeps its demo costs.

## D65 Printed card nutrition shown beside the calculation

When a `RecipeView` has `printedNutrition` (`PrintedNutritionView`, added by the import lane), the nutrition panel adds a separate "From the recipe card" column on the per-serving table (printed names mapped to our nutrients, unmapped rows appended, kJ ignored), states the printed basis and note, and labels the figures source-provided, not calculated by this app and not scaled (`data-testid="printed-nutrition"`). No printed data = column skipped. The per-recipe tab never shows printed values. Printed allergens render under the panels (`printed-allergens`). The merge with the import lane replaced its inline printed block in `RecipeDetail` with this column; its e2e test ids are kept.

## D66 Open gaps (not fixed in this lane)

Refdata coverage limits what can be priced or weighed: no unit weights for `can`/`clove`, aliases missing for e.g. "white fish fillets", "braising beef", "floury potatoes", "mixed berries", "curry paste"/"coconut milk" packs not convertible. These show as uncosted / no-data lines, which is honest but makes most seed recipes partial. The receipts lane should provide a `PriceSource` (set on `getRecipeCalculator()` via `createRecipeCalculator({ priceSource })`); `getRecipeCalculator` currently uses generic prices only.

## D50 Supabase repositories for recipes, plans and pantry (lane S1)

`apps/web/lib/server/supabase/**` holds `SupabaseRecipeRepository`, `SupabaseMealPlanRepository`, `SupabasePlanRecipeSource` and `SupabasePantryRepository` behind the existing interfaces (nothing in the UI changed). Constructors take the `@supabase/supabase-js` client plus household (and member) ids; `backend.ts` adds lazy wrappers that resolve `{client, householdId, userId}` per call. Selection: `DATA_BACKEND=supabase` AND a Supabase URL + key (or a registered provider) -> Supabase; anything else -> in-memory as before (one `console.warn` when the switch is set but the env is incomplete). Wired at the three existing points only: `recipes/factory.ts`, `plan/services.ts` (`createPlanServices`), `pantry/deps.ts`.

## D51 All multi-table work goes through RPCs (migration `20261019001520`)

No live PostgREST was available, so reads and writes use SQL functions whose behaviour is tested for real in PGlite instead of PostgREST embed syntax that could only be guessed: `list_recipes` (FTS + trigram search, every filter, sort, paging, in SQL), `get_recipes`, `recipe_facets`, `find_recipe_duplicates`, `save_recipe` (recipes + recipe_ingredients + recipe_steps + tags + a new `recipe_versions` row, one transaction), `save_meal_plan`, `select_meal_plans`, `replace_pantry_items`. All are SECURITY INVOKER (RLS still applies, including the grace-period read-only policies) and every statement also filters by the household id passed in, so a service-role client stays household-scoped. The timestamp `...001520` deliberately sits well after 0014 to avoid colliding with other lanes' migration numbers.

## D52 Recipe mapping decisions

`recipe_ingredients` gained `display_name` (the ingredient name as written; `original_text` stays the quantity text, falling back to the name when blank because the column is NOT NULL). `originalText` is stored in each version's `corrected` jsonb and is write-once (earliest non-blank wins). An external image URL cannot satisfy `cover_image_path` (must be `<household>/...`), so it lives in the latest version's `corrected.imageUrl`; storage paths use the column. Unknown canonical ingredient ids are stored NULL (line kept, unmatched); same-name lines keep their id across edits. Editing ingredient lines drops that recipe's calculated nutrition profile (the engine recomputes). Favourites are per member (`userId`), `rating` is the household mean to 1 dp. `delete()` ARCHIVES (`status = 'archived'`) because planned meals reference recipes with NO ACTION; archived recipes vanish from list/get/search/duplicates. Non-UUID ids (old fixture ids) return null/false rather than throwing.

## D53 Cost is not persisted yet

Schema v1 has no recipe cost cache, so every recipe reports `cost.totalPence = null` and sort-by-cost falls back to name. Price bands low/mid/high and the `budget` collection therefore match nothing; `unknown` matches everything. Revisit when a cost cache (engine output) is persisted.

## D54 Meal plan mapping

`PlanDoc` <-> `meal_plans` + `planned_meals`: the week is `start_date .. +6`; `mealTypes` and `proposalId` live in `meal_plans.constraints`. One managed `planned_meal` per (date, meal type) at position 0; saves update slots in place (ids survive, so shopping provenance links are kept), insert new slots and delete removed ones. Saving a plan archives any other live plan for the same household + week instead of deleting it. `eating_out` entries store servings = 1; `other` reads back as `eating_out`. Plan ids and recipe ids must be UUIDs (`save` throws a clear error otherwise).

## D55 Pantry mapping

`pantry_items` gained `stock_updated_at` (the engine's own last-confirmed instant: `updated_at` is bumped by a trigger on every write and would make all stock look fresh after any replace) and `source_event_ids uuid[]`. New tables `pantry_settings` (purchase_mode off/suggest/auto, stale_after_days) and `pantry_handled_events`, household-scoped with RLS. `households.pantry_deduct_on_purchase` (boolean) is NOT synchronised with `purchase_mode`; the settings lane should reconcile the two. `replace_pantry_items` is an id-keyed upsert plus delete of absent rows in one transaction and preserves columns the engine does not model (notes, receipt_line_id, ...).

## D56 Interim data context

Until the auth lane registers `setDataContextProvider()`, the server uses the service-role key (RLS bypassed) with `SUPABASE_DEFAULT_HOUSEHOLD_ID` (and optional `SUPABASE_DEFAULT_USER_ID` for favourites). Pantry and plan "current household" helpers use that env id in Supabase mode; the plan's `demoHousehold()` still carries demo exclusions/members (ids `m-lauren`/`m-sam`) until household/profile data is wired. Never ship the service-role key to the client.

## D57 Test strategy for a backend we cannot reach

(1) `queries.test.ts`: a recording supabase-js double asserts the exact RPC names/arguments and table calls plus row mapping (including rows another writer left outside the strict domain rules). (2) `contract.pglite.test.ts`: the real repositories run against the real migrations in PGlite as an `authenticated` member via a small PostgREST-lookalike (`test-support/pglite-client.ts`), covering the TS<->SQL contract and RLS isolation. (3) `packages/db/tests/rls/005_*.sql`: SQL-level asserts for every new function. Not covered: PostgREST itself (URL/headers, schema cache, JWT verification, `Prefer` semantics, the 1000-row cap beyond the paging helper), real Supabase auth, and performance at scale.

## D58 Known limits to revisit

`list_recipes` caps a page at 10 000 rows (planner/pantry sources ask for all recipes in one call; fine for family-sized libraries). Duplicate detection loops recipes in plpgsql (O(n)). `SupabasePlanRecipeSource.list` pulls full recipe documents. Quantities that violate the strict domain rules (e.g. an approximate quantity with a unit written by another lane) degrade to `unparsed` on read instead of failing the page.

## D70 M2 mobile: SupabaseDataSource (2026-10-19)

`apps/mobile/src/data/supabaseDataSource.ts` implements `DataSource` with supabase-js (anon key + user session only; RLS decides visibility). `createDataSource()` picks it when `EXPO_PUBLIC_SUPABASE_URL` and the anon key are set, otherwise the mock; `EXPO_PUBLIC_DATA_SOURCE` is gone. Reads: households (+ active member counts), active recipes, recipe detail (ingredients/steps/per-serving nutrition profile; unknown/unavailable nutrients carry no value so the UI says "Unknown"). The shopping list is the household's newest `active` `shopping_lists` row. `DataSource` grew `getAccessToken`, `undoTick`, `takeConflicts`, optional `setOnline`; the mock implements them too.

## D71 Shopping sync = the L17a engine client model over the command log

`@fr/mobile` now depends on `@fr/engine` (subpaths `./shopping`, `./units`; the D32 "engine not added" note is superseded). Per household the data source holds the engine `ClientState`: `confirmed` (snapshot + replayed log) at `cursor`, ordered `pending`, optimistic view = pending over confirmed (`clientView`/`deriveAll`). Snapshot = `shopping_list_items` + `purchase_events` with the cursor (max `shopping_command_log.seq`) read BEFORE the rows. Catch-up = `shopping_command_log` rows with `seq > cursor` mapped to engine `LogEntry`s (`tick`/`purchase`/`void` -> tick/purchase/undo) and ingested with `clientIngest`. Anything it cannot replay (add/edit/remove/regenerate entries, a seq gap, a full page of 500, or an applied purchase the engine replay did not reproduce) falls back to a fresh snapshot via `clientResync`, which keeps `pending`. Writes go only through `record_purchase` / `void_purchase` (client-generated command id = idempotency key; rejections are data). Ticks pass the engine's `expectedOutstanding` + `expectedEventCount` from `confirmed`; if the server answers `needs_engine_outstanding` it has already consumed that command id, so the client resnapshots and re-sends the tick ONCE under a new id (then reports a conflict). The unit converter has no ingredient lookup (no refdata in the app), so density conversions are not attempted client-side. Realtime subscriptions are not used: resync happens on screen focus, app foreground, pull-to-refresh and reconnect.

## D72 Offline queue persistence and replay

`OfflineStore` (AsyncStorage) persists `pending` commands per household (`fr.shopping.v1.pending.<hh>`) and the last confirmed snapshot (`...snapshot.<hh>`, cache only) so a cold start with no signal shows the cached list with queued ticks applied. Corrupt entries are dropped, never thrown. NetInfo (`@react-native-community/netinfo`) feeds `AppProvider`: on offline -> `ds.setOnline(false)` (no delivery attempts, banner shown); on reconnect -> `ds.flushPending()` then a `syncVersion` bump so screens re-read and drain conflicts. Flush sends commands in order and stops at the first transient failure (no code / network / PGRST0xx / 5xx); acknowledged commands are dropped only after the log sync that folds them into `confirmed`, and a re-send after a lost response gets `duplicate: true` (counted as delivered, no double purchase). Final errors (e.g. `P0002` item gone) become a conflict, never an endless retry.

## D73 Conflict toasts

A rejected own command (already_complete, already_voided, item removed/not found, invalid quantity) is surfaced once (deduped by command id, whether seen via the RPC reply or the replayed log) as a `ShoppingConflict` and drained with `ds.takeConflicts()` into a dismissible `Toast` (`role=alert`, assertive live region). `already_complete` names the winner from `household_members.display_name` ("Sam already got Milk."); an unnamed member reads "Someone". Ticked items offer Undo (`void_purchase`, append-only, also queued offline).

## D74 Recipe import from the phone (client; server side done in D102)

`CaptureScreen` captures with the camera or picks from the library (max 6 pages = the web route's `MAX_FILES`; was 8), lets the user rotate (`expo-image-manipulator`, 90 degrees clockwise) or remove pages, downsizes to 1600px JPEG, and POSTs multipart `images[]` (+ `householdId`) to `${EXPO_PUBLIC_API_BASE_URL}/api/extract` with `Authorization: Bearer <supabase access token>`; the AI key never reaches the app. `ImportReviewScreen` is a read-only summary (title, servings, ingredient lines flagged "Check", steps, blocking issues, duplicate hint). Save posts `{uploadId, draft}` (the draft is opaque, sent back unchanged) to `/api/extract/save`; blocking issues disable Save and "Finish on web" opens `/recipes/import`. **Server change needed (apps/web, not done here):** the two routes have no auth and save to the process-wide in-memory store, so before this works against a deployed web app they must (1) verify the bearer token (`supabase.auth.getUser`), (2) read `householdId` and check membership, (3) save through a Supabase-backed `RecipeSink` for that household. Until then a recipe saved from the phone lands in the web server's in-memory store and will not appear in the mobile list.

## D75 Polish: states, accessibility, dark mode

`screens/ui.tsx` is theme-aware (`useColorScheme`; light/dark palettes; `useStyles`, themed `Text`/`Muted`), exports `Loading`, `EmptyState`, `ErrorState` (retry), `Toast`, and a 48dp minimum tap target for buttons, rows and inputs. Every list screen has loading, empty and error-with-retry states and pull-to-refresh; controls carry `accessibilityLabel`/role/state (shopping rows read "Milk, 2 l, Dairy, bought"), headers use `accessibilityRole="header"`, errors/toasts are `role=alert`. Stack/tab navigators follow the theme. `app/index.tsx` redirects to `/households` when a persisted session exists, else `/sign-in`.

## D76 Test strategy for M2

`__tests__/helpers/fakeSupabase.ts` is a fake supabase-js client (in-memory tables, query builder subset, auth, and `record_purchase`/`void_purchase` mirroring migration 0013: idempotency on command id, `already_complete` + `completedBy`, `needs_engine_outstanding`, log rows with `seq`). It can go offline, drop RPC responses after applying them, and act as a second household member. Covered: offline queue persistence across a simulated restart, replay once, lost-response idempotency, lost-race conflict, incremental log catch-up (no item refetch), unreplayable-entry snapshot fallback, undo, stale-count re-issue, final-error reporting, screens (offline banner, reconnect replay, toast, undo, capture/rotate/remove/upload/review/save/finish-on-web, blocking issues) and the import client (multipart, bearer, error mapping).

## D40 OpenAI / Azure OpenAI adapter and shared provider base

`@fr/ai` `BaseAiProvider` owns the six operations plus the validate/retry/usage loop; `AnthropicProvider` and the new `OpenAiProvider` only implement the wire protocol. OpenAI adapter = Chat Completions over `fetch` (no SDK): configurable base URL (default `https://api.openai.com/v1`), model (free text, default `gpt-4.1`, vision capable), optional organisation; Azure mode = `{endpoint}/openai/deployments/{deployment}/chat/completions?api-version=` (default `2024-10-21`) with the `api-key` header. Images go as base64 data URLs after `prepareImage` (EXIF auto-rotate). Structured output = strict `json_schema` built from the zod schemas (`toStrictSchema`: all props required, optional -> nullable, records -> entry arrays, validation keywords dropped, decoded back before zod validates); an endpoint that rejects it falls back to `json_object` with the schema in the prompt, and a rejected `max_completion_tokens`/`max_tokens` flips to the other. New error codes `PROVIDER_NOT_CONFIGURED`, `MODEL_NOT_FOUND`, `PROVIDER_UNREACHABLE`; 401/403 = key rejected, 404 = model not found, 429 = rate limited (insufficient quota not retried), network = unreachable. Keys are redacted from error text. `ping()` powers Test connection. Live behaviour against real OpenAI is untested (tests use a fake fetch and a local stub server).

## D41 AI provider settings: encrypted, server-side, resolved per request

Settings > AI provider (mock / OpenAI / Azure OpenAI / Anthropic). The key is posted to a server action only and stored AES-256-GCM (AAD = provider) in gitignored `apps/web/.data/ai-settings.json`; the browser only ever gets a masked hint (`sk-...abcd`). Secret = `APP_SECRET` (>= 16 chars); in development it is auto-generated into `.data/app-secret`; in production without `APP_SECRET` saving a key is refused. Precedence per request: saved settings > env (`AI_PROVIDER`, `OPENAI_*`, `AZURE_OPENAI_*`, `ANTHROPIC_API_KEY`) > development mock (D6). A real provider whose key is missing/undecryptable is reported "not configured" (import shows a link to Settings, photos kept for retry), never a silent mock; in production the mock is refused and reported the same way. The planner uses the same resolving provider. TODO(Supabase): household settings row, key in a vault/encrypted column, owner-only writes (no auth gate yet: single local household). `APP_DATA_DIR` overrides the data folder (tests, e2e); `NEXT_DIST_DIR` lets a second dev server (e2e on another port) use its own build dir.

## D42 Extraction prompt, printed card data and cover images

The shared recipe prompt handles two-sided cards in any order, sideways photos (the model reports `frontImageIndex` + clockwise `frontImageRotation`), meal-kit "[bracket]" quantities (base serving and base amounts extracted, bracket kept in `originalText` and noted in warnings; the draft parses the bracket-stripped text so there is no false disagreement), "You need:" lines as `pantryStaple` to_taste ingredients (never blocking), printed nutrition (`printedNutrition`, stored labelled `source: 'recipe card'`, `calculated: false`, shown separately from our own estimate, taken from the server copy at save so the client cannot alter it), printed allergens, and publisher/reference into the source fields. Photos are stored upright (EXIF) in gitignored `.data/uploads/<uploadId>/page-N.jpg`; saving writes `cover.jpg` (front page turned upright) served by `/api/uploads/[id]/[file]` (strict id/file patterns) and set as the recipe `imageUrl`, so library cards and detail show it. A manual per-photo Rotate control rotates client-side before upload. Unsaved upload folders are swept after 24h. TODO(Supabase Storage). Library recipes carry `printedNutrition`/`printedAllergens` (preserved across edits); `pantryStaple` is kept in the import payload only.


## D80 Pantry scan is one `@fr/ai` operation with a minimal context (P2)

`scanPantry(images[], context, ctx)` (new `packages/ai/src/pantry-scan.ts`; wired once in `BaseAiProvider`, so OpenAI, Azure OpenAI, Anthropic and the mock all carry it; `createResolvingProvider` forwards it; usage operation `scanPantry`). It accepts up to `SCAN_MAX_IMAGES` = 10 images (the recipe flow keeps its limit of 6). Per item: `name`, `form` (fresh | chilled | frozen | canned | dried | ambient | other), `packaging` (loose | pack | tin | jar | bag | bottle), `count` (individual items if loose, packs otherwise), `packSizeText` as printed plus `packSize {value, unit}` per pack (only when legible), `dates {useBy?, bestBefore?, legible, needsCloseUp}`, `confidence`, `frameRefs` (1-based images it appears in), `notes`. The context is ONLY `{ingredientNames?, today?, focusItem?}`: canonical names as a naming hint, today's date so "21 OCT" resolves, and the item name for a close-up. No household, member or purchase data; the prompt builder ignores unknown keys (tested). The prompt tells the model: frames may be one scene from several angles (de-duplicate, never add counts across frames, report the verifiable maximum), count loose items individually and packs as packs, keep UK "use by" (safety) and "best before" (quality) apart, never invent a date, set `needsCloseUp` when a label is visible but unreadable.

## D81 Scan output is sanitised in code, not trusted

`normaliseScan` (in `pantry-scan.ts`, applied by `BaseAiProvider.scanPantry` and the mock): dates are dropped whenever an item is flagged not legible or needs a close-up, impossible calendar dates are dropped, `needsCloseUp` is never kept beside a date, `legible` is recomputed from whether a date actually remains, frame references are clamped to the images actually sent (default `[1]`), names are trimmed (empty ones dropped), and a pack size without its printed text is ignored. Items are NOT merged in code: de-duplication is the model's job and every downstream step tolerates repeats (rows for the same ingredient and date merge through the engine's `addStock`). The mock reads `fixtures/pantry-scan.json` with relative dates (`+2d`) resolved against `context.today`; a `focusItem` close-up returns that single item with a readable use-by so the close-up flow is testable.

## D82 Video is turned into frames in the browser; only JPEG frames are uploaded

`/pantry/scan` accepts `image/*` (gallery or camera) and `video/*` with `capture`. A video never leaves the device: `lib/pantry/video-frames.ts` seeks a `<video>`, draws to a canvas and keeps 6-10 frames (about one per 1.5 s, `chooseFrameCount`). `lib/pantry/frames.ts` (pure, pixel arrays in) splits the clip into equal windows (skipping the first/last 3%), samples 3 candidate times per window and keeps the sharpest by variance of the Laplacian on a 160 px grayscale copy, so frames are spread across the whole clip and each is the least-blurred of its neighbourhood. Clips with no duration metadata (MediaRecorder output) are handled by seeking far to force one. The chosen frames show as numbered thumbnails (removable) before sending; photos and frames share the 10-image cap. The UI says dates read best from close-up photos.

## D83 Scan endpoint is read-only; rows are matched with the engine's conservative matcher

`POST /api/pantry/scan` (multipart `images[]` 1-10, optional `focus`) calls `runPantryScan` (`lib/server/pantry/scan.ts`): provider from the D41 resolver, errors through the shared import `toError` mapping (not configured -> 412 with a Settings link), context per D80. Each item is matched with `IngredientMatcher` over the D28 catalogue (exact name/alias only). If the bare name misses and the model said frozen/canned/dried, one retry prefixes that form word ("tinned chickpeas"). Results: matched (auto-picked), ambiguous (candidates, the owner chooses; never a silent pick) or unmatched (near-miss suggestions for the owner only; saved as free text). The real catalogue currently has no ambiguous names, so the ambiguous UI is covered with a collision catalogue in a unit test and a mocked response in e2e.

## D84 Nothing is written before confirm; preview and confirm share one engine function

Review rows live only in the browser. `previewScanAction` (read-only) and `confirmScanAction` both call `planScanAdditions` (`lib/pantry/scan-apply.ts`), which runs the engine's `addStock` row by row over a copy of the household's stock, so the "merge with existing stock" preview (before -> after for a merge, "new line" otherwise, with a note when an existing line is kept separate because of a different date or older stock) cannot disagree with what confirm writes. Confirm validates every row first (quantity, unit, real calendar dates, known ingredient, at most 60 rows) and then writes ONE `replaceItems` (all rows or none). Source is `manual` (no new pantry source enum; a scan is a manual add that the camera filled in). Items the owner unticks are never sent; rows under 50% confidence start unticked.

## D85 One pantry expiry: use by wins over best before

The ledger has a single `expiry`. Each review row has separate Use by and Best before pickers (prefilled from the scan, each tagged "Read from label" / "Read from close-up" / "You entered" / "Estimate"). On confirm the expiry is `useBy`, else `bestBefore`, else none (the safety date is the stricter one). The distinction is lost after confirm (limitation until the ledger models both); nothing is ever invented: an unreadable label gives no date and the "Take close-up" prompt.

## D86 Default quantity from count and pack size

`defaultQuantity`: tins -> `count` x `can` (the pantry and recipes count tins; the printed size is displayed as "400g each", not multiplied); other packs with a legible mass/volume -> `count` x pack size in g/kg/ml/l; otherwise loose -> `item`, packaged -> `pack`. Count, quantity and unit are all editable; changing the count re-derives quantity/unit until the owner types their own quantity or unit.

## D87 Typical shelf life is opt-in, labelled, and never overrides a date

Toggle "Suggest typical shelf life when no date is shown" is OFF by default. When on, only rows with no date at all get a best-before ESTIMATE from a small conservative table in `lib/pantry/shelf-life.ts` (by catalogue category, with frozen/canned/dried by form: e.g. fresh fruit and veg 7 days, chilled meat/fish 2, frozen 90, tinned 365), badged "Estimate, not read from the pack" and editable/clearable. Turning the toggle off removes estimates again; a date read from a label or typed by the owner is never touched, and a real date from a close-up replaces a leftover estimate. The ledger does not keep the "estimated" flag after confirm (limitation).

## D88 Close-up re-scan merges dates only

A row flagged `needsCloseUp` offers "Take close-up" (single photo, `capture=environment`). That photo is scanned with `focusItem` = the row's name; only the dates (and a pack size when the row had none) are merged back. Owner-typed dates are never overwritten; if nothing legible comes back the row stays flagged with a message to try again or type the date. The re-scan uses keys `c*` so it cannot collide with the main scan.

## D89 Verification, and what is not verified

Unit: `@fr/ai` schema/prompt/normalise/mock/adapter tests (`test/pantry-scan.test.ts`), sharpness picker + frame timing on synthetic pixel data, row transitions and shelf-life table (`lib/pantry/*.test.ts`), matcher, scan pipeline, preview/confirm semantics and all-or-nothing validation (`lib/server/pantry/scan.test.ts`). E2e (`e2e/specs/pantry-scan.spec.ts`, mock provider): photo path end to end including confirm, close-up, estimate toggle, nothing-written check and a second-scan merge preview; the video path runs in Chromium with a WebM generated in-page by MediaRecorder (decoding, frame picking and "only JPEG frames uploaded" are exercised for real); ambiguous and no-provider paths use a mocked response. NOT verified: accuracy of a live model (item naming, counts across frames, date reading, use-by vs best-before discrimination) on real kitchen photos or phone video; iOS/Android camera `capture` behaviour and HEVC/MOV decoding in Safari (the server rejects HEIC photos like the import flow does).

## D90 Count-unit weights (can, clove, slice, bunch, sprig, stick, pack)

`CanonicalIngredient` gains optional `countUnitWeightsG: Partial<Record<CountUnit, {value, source, estimate: true}>>` (additive in `@fr/domain`, mirrored in the refdata schema). `@fr/engine/units` `conversionFactor` uses it for count<->mass for exactly that unit (`item` still uses `unitWeightG`); no entry for the unit = unchanged refusal (`incompatible_count_unit`), so nothing converts by guesswork. A non-item count unit with BOTH a weight and a density also converts to volume (a 400 ml tin of coconut milk = 1 can); `item` never converts to volume. Results are always estimates. Data: `packages/refdata/src/data/count-unit-weights.ts` (93 entries; cans use drained weight for pulses/fish/veg, net for liquids/sauces; `pack` = the single pack/sachet the recipe usually names). `apps/web/lib/server/refdata/catalogue.ts` `toCanonical` passes the field through (one-line change, otherwise it was dropped).

## D91 Fresh herbs and chilli are priced per gram pack

Prices for fresh herbs and chilli moved from `1 pack` to a gram pack (coriander/parsley/basil/mint 30 g, thyme/rosemary 25 g, chilli 40 g) so `bunch`/`sprig`/`item` lines convert through the count-unit weights instead of being "not convertible". All 382 canonical ingredients now have a dated `generic_estimate` price (225 added 2026-10-19: author-assessed own-brand shelf prices, +/-30%, never scraped; stock priced per litre as made from cubes; water 1p/litre). The 4-recipe meal-kit fixture set and the e2e/import fixtures now price 94% of lines (was 69%); see `packages/refdata/COVERAGE.md`.

## D92 Aliases versus new ingredients; CoFID proxies

Same product, different wording = alias on the existing ingredient (white fish fillets is NEW "white fish"; braising beef -> stewing beef; floury/maris piper -> potato; tortillas -> wrap; soft cheese -> cream cheese; grated Italian hard cheese -> parmesan; mixed berries -> frozen berries; basil/parsley -> the fresh herb). Different product = new ingredient (chicken stock powder, garlic puree, harissa, mango chutney, little gem, nigella seeds, spice blends, ciabatta/baguette/pizza base, beansprouts, mixed salad leaves; 17 added). 34 CoFID links added (66 proxy overall, all flagged estimate); stock liquids reuse the ready-made chicken stock profile and frozen berries the raw raspberry profile (coarse, labelled proxy). Ingredients with no CoFID food (nigella seeds, sun-dried tomatoes, most sauces/spice blends) stay `unavailable`. `pnpm --filter @fr/refdata coverage` and `test/coverage.test.ts` (regression floor over fixtures plus meal-kit cards) guard it.

## D100 Supabase mode runs as the signed-in user; cost and nutrition are computed on read (integrator pass 3; supersedes D53 and D56)

With `DATA_BACKEND=supabase` and the app's public Supabase env (`NEXT_PUBLIC_SUPABASE_URL` + `_ANON_KEY`), every Supabase repository call resolves `getDataContext()` -> `sessionDataContext()` (`lib/server/supabase/session-context.ts`, built on `requireHouseholdContext()`, the same source `getAppContext()` wraps): the session's USER-SCOPED client (RLS applies, no service role), the active household and the member id. `setDataContextProvider()` stays as an override (tests/scripts) and wins. Documented dev fallback only: `SUPABASE_DATA_CONTEXT=service` + `SUPABASE_DEFAULT_HOUSEHOLD_ID` + `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (+ optional `SUPABASE_DEFAULT_USER_ID`), refused when `NODE_ENV=production`; `SUPABASE_DEFAULT_HOUSEHOLD_ID` alone does nothing. Mock-auth mode has no client, so DATA_BACKEND=supabase there falls back to memory (selection needs the public env). Costs are never stored: `SupabaseRecipeRepository` takes the SAME `RecipeSummariser` as the in-memory repository (`withSummary`), so a recipe costs the same on both backends. Price band, the `budget` collection and sort-by-cost cannot be SQL, so they run over the SQL-filtered set (up to 10 000 recipes) costed in the app, then the same `priceBandOf`/`sortRecipes` as memory. Planner recipe sources get cost via the repo and nutrition via the household calculator.

## D101 Price store and recipe calculator are per household

`PriceStore.asPriceSource(householdId)` exposes ONE household's recorded observations with a per-household version (a reset is a new epoch); `getRecipeCalculator(householdId)` keeps one calculator per household (`getGenericRecipeCalculator()` = refdata prices only, used when no household is known: tests, signed out). The process-wide in-memory recipe repository resolves the signed-in household once per operation (`RecipeSummariser.forRequest`), so one household's receipt prices no longer change another's recipe costs. Receipt prices themselves are still in-memory only (`price_observations` table is future work).

## D102 Bearer auth for the Android import routes

`/api/extract` and `/api/extract/save` accept `Authorization: Bearer <supabase access token>` as well as the web session (`lib/server/auth/request-auth.ts`): the token is verified with `auth.getUser(token)` on a client acting as that user, memberships are loaded with RLS, and the multipart/JSON `householdId` must be an ACTIVE membership (400 malformed, 403 not a member, 401 bad token; pending-deletion households are read-only, 403). Middleware lets a bearer request through for exactly these two paths (`acceptsBearer`); the route does the verifying. Uploads remember `{userId, householdId}`: save takes the household from the upload, and another user or household gets 410 for retry/save. The recipe is saved through `recipeSinkFor(auth)`: a `RepositoryRecipeSink` over the Supabase repository bound to the CALLER's client and household when the Supabase backend is active, else the shared in-memory sink. Cookie auth is unchanged (mock mode: demo household). Untested against a live Supabase: token verification is unit-tested with a fake auth client.

## D103 Receipt extras go to the pantry service

Receipt lines the shopper confirmed with "add to pantry" are written through `PantryService.addPurchased` (source `purchase`, canonical ingredient by exact name/alias only, one `replaceItems`), via `PantryServiceReceiptPort` from `getPipelineDeps()`, so they appear on /pantry for that household. Quantity = the receipt amount when it is a plain amount in a pantry unit, else one `item` (never invented). The old in-memory receipts ledger no longer receives pantry adds.

## D104 `pantry_settings.purchase_mode` is the source of truth (migration `20261019001540`)

The setting is `pantry_settings.purchase_mode` (off/suggest/auto). `households.pantry_deduct_on_purchase` stays only for the `@fr/domain` Household contract and is a derived mirror (true iff mode = auto): an AFTER trigger on `pantry_settings` recomputes it and a BEFORE trigger on `households` pins it, so a direct write is ignored. Households with the legacy flag and no settings row are backfilled to `auto` (`backfill_pantry_purchase_mode()`, not callable by app roles). Tested in PGlite (`packages/db/tests/rls/007_pantry_purchase_mode.sql`). Migration order: `001500` transfer_ownership, `001520` S1 repositories, `001540` this.

## D105 Integration notes

M2's `D27m` was a verbatim duplicate of D32 and was dropped (D71's reference now says D32). The S1 RLS script is `tests/rls/006_*` because `005_transfer_ownership.sql` already existed. Still in-memory even with `DATA_BACKEND=supabase`: shopping, receipts, price observations, pantry purchase-event/leftover sources, planner household profile (members/exclusions are demo values) and the AI settings file.
