# Implementation Plan (mirrors PARALLEL-DELIVERY-PLAN.md)

Merge order within a wave: contracts/packages before apps.

## Wave 0 - Foundation

- [x] **W0a** L0 Skeleton (monorepo, Next.js, Vitest, Playwright, ESLint/Prettier, `.env.example`, Supabase config, docs)
- [x] W0b L1 Schema & contracts (merged: `@fr/domain`, migrations 0001-0014, PGlite RLS tests; generated DB types still a placeholder)
- [~] W0b L2 Shell & design system (L2a UI kit + app shell merged 2026-10-19; remaining L2 work pending)
- [x] W0b L3 Engine core (units, parse, normalise, scale, aggregate; merged, merge batch 2, 350 tests)
- [x] W0b L4 AI gateway (merged, merge batch 1)
- [x] W0b L5 Reference data (merged, merge batch 1)
- [~] W0b L6 QA harness: fixtures + e2e specs merged (merge batch 1); RLS tests + CI wiring pending
- [ ] **Gate G0**: Brief M0 acceptance + schema merged + engine core green

## Wave 1 - Core features (needs G0)

- [ ] L11 Auth & household
- [x] L12 Recipe library (merged batch 4; its in-memory repository is the shared recipe store, D30)
- [x] L13 Recipe extraction (merged batch 4; parse/match via `@fr/engine` + refdata catalogue, saves into the library store)
- [x] L7 Cost engine (engine code merged, merge batch 2; UI/wiring pending)
- [x] L8 Nutrition engine (engine code merged, merge batch 2)
- [x] L9 Planner solver (engine code merged, merge batch 2)
- [x] L10 Receipt matcher (engine code merged, merge batch 2)
- [ ] **Gate G1**: M1 + M2 + M3 acceptance

## Wave 2 - Composition (needs G1)

- [x] L15 Meal planner UI (merged batch 4; recipes from the shared store)
- [x] L16 Prompt planning (merged batch 4; `@fr/plan-orchestrator`, solver = `@fr/engine/planner` via engine-solver.ts, D29)
- [ ] L17 Shopping list (lane finished on branch worktree-agent-a5a258b1b8baf2025, not merged yet)
- [ ] L18 Cost & nutrition UI
- [ ] L19 Price management
- [ ] **Gate G2**: M4 + M5 + M6 acceptance (MVP-ready internally)

## Wave 3 - Sharing, receipts, pantry (needs G2)

- [ ] L20 Realtime & invitations
- [ ] L21 Receipt flow (lane running; nav link /receipts already present)
- [x] L22 Pantry (merged batch 4; `@fr/engine/pantry` + catalogue converter)
- [x] L23 Home dashboard (merged batch 4, with settings + privacy pages)
- [ ] L14 Expo (optional start)
- [ ] **Gate G3**: M7 + M8 acceptance (first release scope complete)

## Wave 4 - Hardening

- [ ] Full E2E journey
- [ ] Accessibility + responsive audit
- [ ] Security/RLS review, rate/AI limits
- [ ] Deployment, backup/restore, privacy and data-export docs
- [ ] M10 Android lane set
