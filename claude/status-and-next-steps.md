# Status and next steps

**Date:** 2026-10-19. Branch `prj018/w0a-skeleton`, all merges committed locally (no remote, never push).

Merged: batch 1 (L2a ui, L4 ai, L5 refdata, L6 qa fixtures/specs, app shell), batch 2 (`@fr/engine`: L3, L7, L8, L9, L10, L17a, L22a), batch 3 (L1 `@fr/domain` + schema/RLS + owner decisions), batch 4 (L23 home/settings/privacy, L12 recipe library, L13 photo import, L15/L16 planner, L22 pantry), batch 5 (L17 shopping UI, L21 receipts UI, L11 auth/households/invitations, L14 Expo `apps/mobile`), plus the AI-provider settings lane from the main checkout.

Batch 5 wiring (D32-D38):
- Shopping on `@fr/engine/shopping`; `/shopping?plan=<id>` and the planner's "Generate shopping list" build the list from the household's APPROVED plan with `@fr/engine/aggregate` over the recipe store (D33).
- Receipts on `@fr/engine/receipt-match`; outstanding items = the shopping list; confirmed lines tick shopping items; receipt prices go into the shared in-memory price store, which the `@fr/engine/cost` basket estimate ranks above refdata generic estimates (D34).
- `getAppContext()` (household + user) in shopping, planner, pantry, receipts; mock-auth demo mode = Alice Smith / household A with a banner on every page; `fr_household=e2e-*` sandbox households for e2e; auth routes render without app nav; invite sign-up keeps `next` (D35).
- Dev-only `/api/dev/reset` + `/api/dev/seed` (404 in production), Playwright globalSetup reset + browser warm-up, 4 workers, longer timeouts, dev watcher/onDemandEntries tuning (D36).
- `transfer_ownership` RPC + PGlite test; household transfer action uses it (D37).
- `.gitattributes` (LF) and `.github/workflows/ci.yml` (D38).

Verified by running (2026-10-19, integration worktree, after merging the main-checkout lanes C1/P2/R2): `pnpm install --frozen-lockfile`; `pnpm build` (9 tasks); `pnpm typecheck` (11); `pnpm lint`; `pnpm turbo run test --force` (18 tasks, 1352 tests: engine 748, web 306, ai 84, refdata 59, domain 38, recipe-import 31, ui 26, e2e fixtures 26, db 13, mobile 11, plan-orchestrator 10); `pnpm test:e2e` twice in a row against one freshly started dev server: 63 passed / 100 skipped (fixme) both times; curl `/ /recipes /plan /shopping /receipts /pantry /household /settings` -> 200 (mock-auth mode).

Known caveats:
- All data is in memory (lost on restart). The recipe store is global, not household-scoped; pantry seeds every household with the demo stock; planner member names / exclusions are demo values for every household.
- Receipt prices feed the recipe cost calculator through a process-wide PriceSource spanning all households (recipes are global too); household-scope both with Supabase.
- Pantry adds from receipt "extra" lines are recorded only in the receipts in-memory sink (not in the pantry service yet).
- The client-side shopping converter has no ingredient densities / unit weights (the server is authoritative); optimistic UI can briefly differ for cross-dimension purchases.
- Receipt `PurchaseEvent.createdBy` = session user; mock mode has one user, so "another shopper" in e2e is a second browser of the same user.

## Next

1. Supabase adapters behind the in-memory interfaces (recipes, plans, pantry, shopping command log + `record_purchase`, receipts, price observations); generate `database.types.ts`.
2. Live-Supabase e2e flows (auth.spec fixmes) once a local or cloud stack exists (Docker 20.10 may be too old; cloud London is the fallback).
3. D29 TODO: `@fr/ai` PlanConstraints should emit the engine planner schema; pass canonical ingredient ids so `allowUnverifiedIngredients` can go back to false.
4. Library/planner cost + nutrition are real since C1 (D60-D64) and read the shared price store; remaining L18 work is UI polish (partial flag on cards, D62).
5. Receipt pantry adds -> pantry service; household-scoped recipes; real member profiles for the planner.
6. Owner decisions still open: Git host/remote (then run the CI workflow), Supabase cloud project, Anthropic/OpenAI keys, product name.

## AI photo import lane (D40-D42)

Done: OpenAI/Azure adapter, Settings > AI provider (encrypted key), richer extraction (multi-page, rotation, bracket quantities, printed nutrition/allergens, staples, source), cover images, review/detail display. Untested: live extraction against the real OpenAI API (needs the owner's key). Configure: Settings > AI provider > OpenAI, paste key, Save, Test connection, then Recipes > Import.
