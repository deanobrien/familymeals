# Status and next steps

**Date:** 2026-10-19. Branch `prj018/w0a-skeleton`, all merges committed locally (no remote, never push).

Merged: batch 1 (L2a ui, L4 ai, L5 refdata, L6 qa fixtures/specs, app shell), batch 2 (`@fr/engine`: L3, L7, L8, L9, L10, L17a, L22a), batch 3 (L1 `@fr/domain` + schema/RLS + owner decisions), batch 4 (L23 home/settings/privacy, L12 recipe library, L13 photo import + `@fr/recipe-import`, L15/L16 planner + `@fr/plan-orchestrator`, L22 pantry UI).

Batch 4 wiring: engine `contract.ts` re-exports `@fr/domain` types; pantry uses `@fr/engine/pantry` (vendor copy deleted); import parses/matches with `@fr/engine` over the server-only refdata catalogue (D28); planner solves with `@fr/engine/planner` (D29); one in-memory recipe store for library, import, planner and pantry (D30); Pantry + Receipts nav (D31).

Verified by running (2026-10-19): `pnpm install`; `pnpm build` (9 tasks); `pnpm typecheck` (10); `pnpm lint`; `pnpm turbo run test --force` (17 tasks, 1054 tests: engine 743, web 115, domain 38, ai 35, refdata 29, ui 26, e2e fixtures 26, recipe-import 20, db 12, plan-orchestrator 10); `pnpm test:e2e` 35 passed / 86 fixme-skipped against a freshly started, warmed dev server on 3100. Dev server curl: `/ /recipes /recipes/import /plan /pantry /settings` all 200; `/receipts` 404 (placeholder until L21).

Known e2e caveats: on a cold dev server the first visit to an uncompiled route can exceed Playwright's 5s expect timeout (random single failures across runs); specs mutate the in-memory store, so a second run against the same server fails (pantry stale-confirm, planner week already saved). Start a fresh server and warm routes before running.

## Next

1. Merge the shopping lane (worktree-agent-a5a258b1b8baf2025, 24d94a2) and the receipts lane when done (they own `apps/web/app/shopping/**` and `apps/web/app/receipts/**`). Shopping should consume the planner's `onShoppingRequirements` and `@fr/engine/shopping`.
2. Supabase adapters for the recipe store, planner and pantry (interfaces in D30); auth/household lanes.
3. D29 TODO: `@fr/ai` PlanConstraints should emit the engine planner schema; pass canonical ingredient ids and unmatched lines to the solver so `allowUnverifiedIngredients` can go back to false.
4. Library cost/nutrition and planner costs are still placeholder seed values: wire `@fr/engine/cost` and `/nutrition` with refdata prices.
5. e2e: isolate or reset in-memory state per run; add a warm-up step or larger expect timeout for cold dev compiles.
6. Open owner decisions: Git host/remote, Supabase cloud project (London), Anthropic key, product name.
7. Supabase local stack not verified (Docker 20.10 may be too old). No CI pipeline yet.

## AI photo import lane (D40-D42)

Done: OpenAI/Azure adapter, Settings > AI provider (encrypted key), richer extraction (multi-page, rotation, bracket quantities, printed nutrition/allergens, staples, source), cover images, review/detail display. Untested: live extraction against the real OpenAI API (needs the owner's key). Configure: Settings > AI provider > OpenAI, paste key, Save, Test connection, then Recipes > Import.
