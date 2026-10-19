# Implementation Plan (mirrors PARALLEL-DELIVERY-PLAN.md)

Merge order within a wave: contracts/packages before apps.

## Wave 0 - Foundation

- [x] **W0a** L0 Skeleton (monorepo, Next.js, Vitest, Playwright, ESLint/Prettier, `.env.example`, Supabase config, docs)
- [x] W0b L1 Schema & contracts (merged: `@fr/domain`, migrations 0001-0014, PGlite RLS tests; generated DB types still a placeholder)
- [~] W0b L2 Shell & design system (L2a UI kit + app shell merged 2026-10-19; remaining L2 work pending)
- [x] W0b L3 Engine core (units, parse, normalise, scale, aggregate; merged, merge batch 2, 350 tests)
- [x] W0b L4 AI gateway (merged, merge batch 1)
- [x] W0b L5 Reference data (merged, merge batch 1)
- [~] W0b L6 QA harness: fixtures + e2e specs merged (batch 1); RLS tests in `packages/db`; e2e rerunnable (dev reset/seed endpoints, D36); CI workflow file added but not run (no remote, D38)
- [ ] **Gate G0**: Brief M0 acceptance + schema merged + engine core green

- [x] S1 Supabase repositories for recipes / plans / pantry (D50-D58, migration `20261019001520`) and M2 Android SupabaseDataSource + offline queue + camera import (D70-D76); wired by integrator pass 3 (D100-D105, migration `20261019001540`). Not yet verified against a live Supabase/PostgREST.

## Wave 1 - Core features (needs G0)

- [x] L11 Auth & household (merged batch 5: `@supabase/ssr`, middleware, mock-auth demo mode, households, invitations, `transfer_ownership` RPC; all lanes use `getAppContext()`, D35/D37). Live-Supabase e2e flows still fixme
- [x] L12 Recipe library (merged batch 4; its in-memory repository is the shared recipe store, D30)
- [x] L13 Recipe extraction (merged batch 4; parse/match via `@fr/engine` + refdata catalogue, saves into the library store)
- [x] L7 Cost engine (engine code merged, merge batch 2; UI/wiring pending)
- [x] L8 Nutrition engine (engine code merged, merge batch 2)
- [x] L9 Planner solver (engine code merged, merge batch 2)
- [x] L10 Receipt matcher (engine code merged, merge batch 2)
- [ ] **Gate G1**: M1 + M2 + M3 acceptance

## Wave 2 - Composition (needs G1)

- [x] L15 Meal planner UI (merged batch 4; recipes from the shared store)
- [x] L16 Prompt planning (merged batch 4; `@fr/plan-orchestrator`, solver = `@fr/engine/planner` via engine-solver.ts, D29; hardened in PL2, D130-D134)
- [x] L17 Shopping list (merged batch 5; `@fr/engine/shopping`, generated from the approved plan via `@fr/engine/aggregate`, basket estimate via `@fr/engine/cost` + refdata prices, D33/D34)
- [ ] L18 Cost & nutrition UI (shopping basket uses `@fr/engine/cost`; library/planner costs are still seed placeholders)
- [ ] L19 Price management
- [ ] **Gate G2**: M4 + M5 + M6 acceptance (MVP-ready internally)

## Wave 3 - Sharing, receipts, pantry (needs G2)

- [ ] L20 Realtime & invitations
- [x] L21 Receipt flow (merged batch 5; `@fr/engine/receipt-match` against the shopping list, confirmed lines tick items, receipt prices into the shared price store, D34)
- [x] L22 Pantry (merged batch 4; `@fr/engine/pantry` + catalogue converter)
- [x] L23 Home dashboard (merged batch 4, with settings + privacy pages)
- [x] L14 Expo (merged batch 5 as `apps/mobile`, mock DataSource, D32)
- [ ] **Gate G3**: M7 + M8 acceptance (first release scope complete)

## Wave 4 - Hardening

- [ ] Full E2E journey
- [ ] Accessibility + responsive audit
- [ ] Security/RLS review, rate/AI limits
- [ ] Deployment, backup/restore, privacy and data-export docs
- [ ] M10 Android lane set
