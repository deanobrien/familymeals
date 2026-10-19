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

## D40 OpenAI / Azure OpenAI adapter and shared provider base

`@fr/ai` `BaseAiProvider` owns the six operations plus the validate/retry/usage loop; `AnthropicProvider` and the new `OpenAiProvider` only implement the wire protocol. OpenAI adapter = Chat Completions over `fetch` (no SDK): configurable base URL (default `https://api.openai.com/v1`), model (free text, default `gpt-4.1`, vision capable), optional organisation; Azure mode = `{endpoint}/openai/deployments/{deployment}/chat/completions?api-version=` (default `2024-10-21`) with the `api-key` header. Images go as base64 data URLs after `prepareImage` (EXIF auto-rotate). Structured output = strict `json_schema` built from the zod schemas (`toStrictSchema`: all props required, optional -> nullable, records -> entry arrays, validation keywords dropped, decoded back before zod validates); an endpoint that rejects it falls back to `json_object` with the schema in the prompt, and a rejected `max_completion_tokens`/`max_tokens` flips to the other. New error codes `PROVIDER_NOT_CONFIGURED`, `MODEL_NOT_FOUND`, `PROVIDER_UNREACHABLE`; 401/403 = key rejected, 404 = model not found, 429 = rate limited (insufficient quota not retried), network = unreachable. Keys are redacted from error text. `ping()` powers Test connection. Live behaviour against real OpenAI is untested (tests use a fake fetch and a local stub server).

## D41 AI provider settings: encrypted, server-side, resolved per request

Settings > AI provider (mock / OpenAI / Azure OpenAI / Anthropic). The key is posted to a server action only and stored AES-256-GCM (AAD = provider) in gitignored `apps/web/.data/ai-settings.json`; the browser only ever gets a masked hint (`sk-...abcd`). Secret = `APP_SECRET` (>= 16 chars); in development it is auto-generated into `.data/app-secret`; in production without `APP_SECRET` saving a key is refused. Precedence per request: saved settings > env (`AI_PROVIDER`, `OPENAI_*`, `AZURE_OPENAI_*`, `ANTHROPIC_API_KEY`) > development mock (D6). A real provider whose key is missing/undecryptable is reported "not configured" (import shows a link to Settings, photos kept for retry), never a silent mock; in production the mock is refused and reported the same way. The planner uses the same resolving provider. TODO(Supabase): household settings row, key in a vault/encrypted column, owner-only writes (no auth gate yet: single local household). `APP_DATA_DIR` overrides the data folder (tests, e2e); `NEXT_DIST_DIR` lets a second dev server (e2e on another port) use its own build dir.

## D42 Extraction prompt, printed card data and cover images

The shared recipe prompt handles two-sided cards in any order, sideways photos (the model reports `frontImageIndex` + clockwise `frontImageRotation`), meal-kit "[bracket]" quantities (base serving and base amounts extracted, bracket kept in `originalText` and noted in warnings; the draft parses the bracket-stripped text so there is no false disagreement), "You need:" lines as `pantryStaple` to_taste ingredients (never blocking), printed nutrition (`printedNutrition`, stored labelled `source: 'recipe card'`, `calculated: false`, shown separately from our own estimate, taken from the server copy at save so the client cannot alter it), printed allergens, and publisher/reference into the source fields. Photos are stored upright (EXIF) in gitignored `.data/uploads/<uploadId>/page-N.jpg`; saving writes `cover.jpg` (front page turned upright) served by `/api/uploads/[id]/[file]` (strict id/file patterns) and set as the recipe `imageUrl`, so library cards and detail show it. A manual per-photo Rotate control rotates client-side before upload. Unsaved upload folders are swept after 24h. TODO(Supabase Storage). Library recipes carry `printedNutrition`/`printedAllergens` (preserved across edits); `pantryStaple` is kept in the import payload only.
