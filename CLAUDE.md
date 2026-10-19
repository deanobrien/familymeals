# CLAUDE.md - Family Recipes (PRJ-018)

Family recipe library, AI photo import, meal planner (prompt -> constraints -> solver), nutrition and cost calculator, shared real-time shopping list, receipts and pantry for UK households. Responsive web first (Next.js, deployed to Azure App Service), Android (Expo) second. Backend: Supabase (Postgres + RLS + Auth + Realtime + Storage), London region.

**Start here if you are a new agent or on a new machine: [docs/HANDOVER.md](docs/HANDOVER.md).** This repo is self-contained: everything needed to continue is in it (no other machine, shared drive or chat history is required). Remote: https://github.com/deanobrien/familymeals (branch `main`).

## Quick start (mock mode, no keys, no Docker)

```
pnpm install
pnpm dev                       # http://localhost:3100 , mock AI + in-memory demo data + mock auth (Alice / household A, bannered)
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm e2e:install && pnpm test:e2e   # Playwright (Chromium); see docs/TESTING.md for isolation rules
```

Other commands: `pnpm --filter @fr/mobile test`, `pnpm mobile:export` (Android bundle check), `pnpm --filter @fr/db test` (all migrations + RLS on in-process PGlite), `pnpm exec supabase <cmd>` (CLI; the local stack needs Docker), `scripts/package-appservice.ps1` (builds `dist/appservice.zip` for Azure; PowerShell, Windows). Every change must leave build, test, typecheck and lint green.

## Architecture map (detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md))

pnpm workspace + Turborepo, scope `@fr/*`, packages export TS source (no emit; D3).

- `apps/web` Next.js 15 App Router (strict TS). Server-only code in `lib/server/**`; routes under `app/`. Data backend is chosen by `DATA_BACKEND` (`supabase` = repositories as the signed-in user under RLS; otherwise in-memory demo). `getAppContext()` (`lib/server/context.ts`) scopes everything by household.
- `apps/mobile` Expo SDK 58 Android app (mock or Supabase DataSource, offline queue).
- `packages/domain` zod types and contracts; `engine` pure TS (units, parse, normalise, scale, aggregate, cost, nutrition, planner, receipt-match, shopping, pantry); `ai` provider interface + Anthropic/OpenAI-Azure/mock adapters (SERVER-ONLY); `recipe-import`; `plan-orchestrator`; `refdata` (CoFID, ingredients, densities, prices); `db` (PGlite migration + RLS tests); `ui` design system.
- `supabase/` config + timestamped migrations (`20261019000000`..) and [SCHEMA.md](supabase/SCHEMA.md); `e2e/` Playwright specs, fixtures, support.

## Current state

See [docs/HANDOVER.md](docs/HANDOVER.md) section "Current state" (kept up to date) and [claude/status-and-next-steps.md](claude/status-and-next-steps.md) (verified test counts per integration pass). In one line: all feature lanes through S2 are merged and green in mock mode; Supabase-backed stores exist but have only been tested against PGlite and fakes, **not yet against a live Supabase**; first Azure App Service deploy is staged and awaiting a smoke test.

## Conventions

- **Decisions**: every non-obvious choice is logged in [DECISIONS.md](DECISIONS.md) as `## D<n> title`. Each lane/agent reserves a block of ten (e.g. D120-D129) so parallel lanes never collide; before adding decisions read the file's headings and pick an unused block (D1-D15 foundation, D20-D26 owner decisions, D27-D38 integration, D40-D42 AI settings, D50-D58 S1, D60-D66 C1, D70-D76 M2, D80-D92 P2/R2, D100-D105 integrator pass 3, D120-D129 S2, D130-D134 PL2, D150-D154 deploy prep). Newer lanes continue from D155 / D160+.
- **Git**: lanes work on branches `prj018/<lane>` in worktrees and are merged by an integrator; main branch is `main` on GitHub. Agents make LOCAL commits only; **never push** unless the owner says so. Merge the integration branch into yours before reporting. LF line endings (`.gitattributes`); on Windows git may warn about CRLF, ignore.
- **Secrets**: never commit secrets or write secret values into docs, comments, tests or chat. Names and locations of every secret are in HANDOVER section 5. `.env*` is git-ignored except `.env.example`; `apps/web/.data/`, `.data-e2e/`, `dist/` are git-ignored.
- **Ports**: web dev 3100; parallel dev servers / e2e runs pick another port via `E2E_PORT` (3101-3199); local Supabase uses 54321-54329.
- **E2E isolation**: run e2e with your own `APP_DATA_DIR` (a temp folder) and `NEXT_DIST_DIR` (e.g. `.next-e2e`) so the owner's encrypted AI key in `apps/web/.data` is never read and `pnpm dev` is never clobbered. Tests must never use a real AI key; e2e uses the mock provider and mock auth.
- **Server-only boundaries**: `@fr/ai` is never imported from client code (ESLint enforces); the service-role key is never used on the user request path (D100); AI keys are encrypted with `APP_SECRET`.
- **Windows gotchas** (symlink EPERM -> hoisted build copy, locked libvips DLL, PowerShell 5.1 has no `&&`, restart dev server after merges that add dependencies): [claude/memories/](claude/memories/).

## Links

[README](README.md) | [docs/HANDOVER.md](docs/HANDOVER.md) | [ARCHITECTURE](docs/ARCHITECTURE.md) | [TESTING](docs/TESTING.md) | [SUPABASE](docs/SUPABASE.md) | [DEPLOY-APP-SERVICE](docs/DEPLOY-APP-SERVICE.md) | [ROADMAP](docs/ROADMAP.md) | [IMPLEMENTATION_PLAN](IMPLEMENTATION_PLAN.md) | [DECISIONS](DECISIONS.md) | [claude/](claude/) | product docs [docs/product/](docs/product/BRIEF.md) | security docs [docs/security/](docs/security/THREAT-MODEL.md) | history [docs/history/](docs/history/INTEGRATION-NOTES.md)
