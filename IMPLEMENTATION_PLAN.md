# Implementation Plan (mirrors PARALLEL-DELIVERY-PLAN.md)

Merge order within a wave: contracts/packages before apps.

## Wave 0 - Foundation

- [x] **W0a** L0 Skeleton (monorepo, Next.js, Vitest, Playwright, ESLint/Prettier, `.env.example`, Supabase config, docs)
- [ ] W0b L1 Schema & contracts (schema v1, RLS, private buckets, zod types, generated DB types)
- [~] W0b L2 Shell & design system (L2a UI kit + app shell merged 2026-10-19; remaining L2 work pending)
- [ ] W0b L3 Engine core (units, scale, aggregate)
- [x] W0b L4 AI gateway (merged, merge batch 1)
- [x] W0b L5 Reference data (merged, merge batch 1)
- [~] W0b L6 QA harness: fixtures + e2e specs merged (merge batch 1); RLS tests + CI wiring pending
- [ ] **Gate G0**: Brief M0 acceptance + schema merged + engine core green

## Wave 1 - Core features (needs G0)

- [ ] L11 Auth & household
- [ ] L12 Recipe library
- [ ] L13 Recipe extraction
- [ ] L7 Cost engine
- [ ] L8 Nutrition engine
- [ ] L9 Planner solver
- [ ] L10 Receipt matcher
- [ ] **Gate G1**: M1 + M2 + M3 acceptance

## Wave 2 - Composition (needs G1)

- [ ] L15 Meal planner UI
- [ ] L16 Prompt planning
- [ ] L17 Shopping list
- [ ] L18 Cost & nutrition UI
- [ ] L19 Price management
- [ ] **Gate G2**: M4 + M5 + M6 acceptance (MVP-ready internally)

## Wave 3 - Sharing, receipts, pantry (needs G2)

- [ ] L20 Realtime & invitations
- [ ] L21 Receipt flow
- [ ] L22 Pantry
- [ ] L23 Home dashboard
- [ ] L14 Expo (optional start)
- [ ] **Gate G3**: M7 + M8 acceptance (first release scope complete)

## Wave 4 - Hardening

- [ ] Full E2E journey
- [ ] Accessibility + responsive audit
- [ ] Security/RLS review, rate/AI limits
- [ ] Deployment, backup/restore, privacy and data-export docs
- [ ] M10 Android lane set
