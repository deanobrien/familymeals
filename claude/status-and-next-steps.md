# Status and next steps

**Date:** 2026-10-19. Branch `prj018/w0a-skeleton`, all merges committed locally (agents never push; the owner pushes to https://github.com/deanobrien/familymeals). This file is the append-only log of verified test counts per integration pass; the current-state summary and next steps for a newcomer are in `docs/HANDOVER.md` (sections 6-8) and the milestone view is `docs/ROADMAP.md`.

Merged: batch 1 (L2a ui, L4 ai, L5 refdata, L6 qa fixtures/specs, app shell), batch 2 (`@fr/engine`: L3, L7, L8, L9, L10, L17a, L22a), batch 3 (L1 `@fr/domain` + schema/RLS + owner decisions), batch 4 (L23 home/settings/privacy, L12 recipe library, L13 photo import, L15/L16 planner, L22 pantry), batch 5 (L17 shopping UI, L21 receipts UI, L11 auth/households/invitations, L14 Expo `apps/mobile`), plus the AI-provider settings lane from the main checkout.

Batch 5 wiring (D32-D38):
- Shopping on `@fr/engine/shopping`; `/shopping?plan=<id>` and the planner's "Generate shopping list" build the list from the household's APPROVED plan with `@fr/engine/aggregate` over the recipe store (D33).
- Receipts on `@fr/engine/receipt-match`; outstanding items = the shopping list; confirmed lines tick shopping items; receipt prices go into the shared in-memory price store, which the `@fr/engine/cost` basket estimate ranks above refdata generic estimates (D34).
- `getAppContext()` (household + user) in shopping, planner, pantry, receipts; mock-auth demo mode = Alice Smith / household A with a banner on every page; `fr_household=e2e-*` sandbox households for e2e; auth routes render without app nav; invite sign-up keeps `next` (D35).
- Dev-only `/api/dev/reset` + `/api/dev/seed` (404 in production), Playwright globalSetup reset + browser warm-up, 4 workers, longer timeouts, dev watcher/onDemandEntries tuning (D36).
- `transfer_ownership` RPC + PGlite test; household transfer action uses it (D37).
- `.gitattributes` (LF) and `.github/workflows/ci.yml` (D38).

Verified by running (2026-10-19, integration worktree, after merging the main-checkout lanes C1/P2/R2): `pnpm install --frozen-lockfile`; `pnpm build` (9 tasks); `pnpm typecheck` (11); `pnpm lint`; `pnpm turbo run test --force` (18 tasks, 1352 tests: engine 748, web 306, ai 84, refdata 59, domain 38, recipe-import 31, ui 26, e2e fixtures 26, db 13, mobile 11, plan-orchestrator 10); `pnpm test:e2e` twice in a row against one freshly started dev server: 63 passed / 100 skipped (fixme) both times; curl `/ /recipes /plan /shopping /receipts /pantry /household /settings` -> 200 (mock-auth mode).

**Integrator pass 3 (2026-10-19):** merged S1 + M2 and wired them (D100-D105). Verified by running: `pnpm install --frozen-lockfile`; `pnpm build` (9 tasks); `pnpm typecheck` (11); `pnpm lint`; `pnpm turbo run test --force` (18 tasks, 1464 tests: engine 748, web 385, ai 84, refdata 59, mobile 42, domain 38, recipe-import 31, ui 26, e2e fixtures 26, db 15, plan-orchestrator 10); `pnpm test:e2e` twice on one fresh dev server (E2E_PORT=3125, own APP_DATA_DIR + NEXT_DIST_DIR): 65 passed / 100 skipped both times. Wiring: session data context (user-scoped client, no service role), computed cost in the Supabase recipe repo, per-household price store and calculator, bearer auth on `/api/extract(/save)` with upload ownership, receipt extras -> pantry service, `pantry_settings.purchase_mode` source of truth (PGlite-tested). Caveats updated below.

Open after pass 3: nothing was run against a live Supabase/PostgREST (token verification, RLS through the real client, migrations on a real stack); with `DATA_BACKEND=supabase` shopping, receipts, price observations, pantry purchase/leftover sources, planner household profile and AI settings are still in-memory; Supabase recipe list with price filters/cost sort loads up to 10 000 recipes and costs them in the app; mock-auth demo mode cannot use `DATA_BACKEND=supabase`; the dev-only service-role fallback exists (D100) and must stay off in production.

Known caveats (before pass 3; the recipe-store/receipt-price/pantry-extras items are now resolved by D101/D103, the recipe store itself is still global in memory):
- All data is in memory (lost on restart). The recipe store is global, not household-scoped; pantry seeds every household with the demo stock; planner member names / exclusions are demo values for every household.
- Receipt prices feed the recipe cost calculator through a process-wide PriceSource spanning all households (recipes are global too); household-scope both with Supabase.
- Pantry adds from receipt "extra" lines are recorded only in the receipts in-memory sink (not in the pantry service yet).
- The client-side shopping converter has no ingredient densities / unit weights (the server is authoritative); optimistic UI can briefly differ for cross-dimension purchases.
- Receipt `PurchaseEvent.createdBy` = session user; mock mode has one user, so "another shopper" in e2e is a second browser of the same user.

**S2 Supabase stores + Realtime (2026-10-19, D120-D129):** with `DATA_BACKEND=supabase` shopping (engine-decided, `record_purchase`/`void_purchase` + `apply_shopping_command`, per-list `list_seq` cursor), Realtime hint feed (poll only while the channel is down; mock mode polls), receipts, household price observations, pantry purchase feed + plan open slots, planner profile (consent-gated exclusions) and per-household AI settings (ciphertext row, owner-only write) are Supabase-backed; migrations `001600`, `001610`, `001620`; engine `applyLogEntry` (logged rejections authoritative). Verified in the S2 worktree AFTER merging main 120d3cc (D1 deploy prep): `pnpm build` (9 tasks), `pnpm typecheck` (11), `pnpm lint`, `pnpm turbo run test --force` (18 tasks: engine 749, web 441, ai 92, refdata 59, mobile 42, domain 38, recipe-import 31, ui 26, e2e fixtures 26, db 16, plan-orchestrator 14); `pnpm test:e2e` twice on one fresh dev server (E2E_PORT=3129, own APP_DATA_DIR, NEXT_DIST_DIR=.next-e2e): run 1 170 passed / 2 failed (shopping specs timing out while the cold server compiled during the long a11y suite; `shopping.spec.ts --repeat-each 3` then 30/30), run 2 172 passed / 100 skipped. NOT verified live: PostgREST, the Realtime server, true concurrent sessions (D128). Open: D129.

**LV1 live local Supabase verification (2026-10-19, D140-D149):** local stack (Docker 20.10.7, Postgres 17.11, ports 554xx) runs; all 23 migrations through `001920` plus the generated `seed.sql` apply with `supabase db reset`; `database.types.ts` generated and `callRpc` type-checked against it. `pnpm test:e2e:live` (20 tests, own server on 3133) covers auth/households/invites, recipes/import/plan/pantry in Postgres, PostgREST RLS, real concurrent `record_purchase`, Realtime RLS and the two-member shopping UI. Bugs found and fixed: email-locked invites accepted by anyone (D144), empty `public.ingredients` losing every ingredient match (D145), `pantry_source` missing correction/leftover (D147), demo pantry data shown to real households (D146). Open: D149.

## Next

1. Supabase adapters behind the in-memory interfaces (recipes, plans, pantry, shopping command log + `record_purchase`, receipts, price observations); generate `database.types.ts`.
2. Live-Supabase e2e: done locally (LV1, `pnpm test:e2e:live`); next is the hosted project (`supabase db push --include-seed`, dashboard Auth settings, D145/D149).
3. D29 TODO closed by PL2 (D130-D134): single `PlanConstraints` in `@fr/domain`, ingredient ids to the solver, `allowUnverifiedIngredients` false, quick meals enforced, editable constraint chips. Live-model plan parsing is still unverified (mock + fake clients only).
4. Library/planner cost + nutrition are real since C1 (D60-D64) and read the shared price store; remaining L18 work is UI polish (partial flag on cards, D62).
5. Receipt pantry adds -> pantry service; household-scoped recipes; real member profiles for the planner.
6. Owner decisions still open: Git host/remote (then run the CI workflow), Supabase cloud project, Anthropic/OpenAI keys, product name.

## AI photo import lane (D40-D42)

Done: OpenAI/Azure adapter, Settings > AI provider (encrypted key), richer extraction (multi-page, rotation, bracket quantities, printed nutrition/allergens, staples, source), cover images, review/detail display. Untested: live extraction against the real OpenAI API (needs the owner's key). Configure: Settings > AI provider > OpenAI, paste key, Save, Test connection, then Recipes > Import.

## D1 Azure App Service deploy prep (2026-10-19, branch `prj018/d1-appservice`)

Standalone build + `scripts/package-appservice.ps1` (symlink-free hoisted build copy, linux-x64 sharp, forward-slash zip), `/api/health`, production config guard (`ALLOW_LOCAL_FILE_STORE` escape hatch until S2 moves AI settings/uploads to Supabase), security headers/CSP, `docs/DEPLOY-APP-SERVICE.md` (D150-D154). The CSP and the deployed app were not exercised against a live Supabase / Azure: the owner's smoke checklist is the first real test.

## X2 Products / Open Food Facts (2026-10-20, branch `worktree-agent-a85a75c8dde09312d`, D180-D189)

New `@fr/product-sources` (`ProductSource`, Open Food Facts adapter with User-Agent / limiter / cache / zod, offline mock + UK fixtures), barcode scanning in /pantry/scan (BarcodeDetector + manual EAN), `GET /api/products/[barcode]` (cookie or bearer), per-household product snapshots (migration `20261019002000`, RLS test 009, in-memory + Supabase stores), product-label nutrition preferred over CoFID with provenance (D186), Expo capture-screen barcode lookup, attribution on `/about/sources`, the privacy notice, review rows, the nutrition panel and the mobile card.

Default is the offline mock (`PRODUCT_PROVIDER=mock`); the live provider (`PRODUCT_PROVIDER=off` + `OFF_CONTACT`) was verified against the real API with ONE read-only GET during development, but the legacy search query shape and the whole flow with live data have not been exercised. Not done: receipts (no barcode data on receipt lines), a name-search screen, unlink/list UI for linked products, privacy-export of snapshots, a per-recipe-line product pin (D186, D187, D189). The ODbL share-alike reading in D182 needs the owner's confirmation before any pooling of product data across households.
