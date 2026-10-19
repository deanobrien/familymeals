# Family Recipes (working name)

AI-assisted family recipe library, meal planner, nutrition/cost calculator, shared real-time shopping list, receipts and pantry for UK households. Web app (Next.js, Azure App Service) and Android app (Expo), backed by Supabase (London).

**New here, or on a new machine? Read [docs/HANDOVER.md](docs/HANDOVER.md).** Product intent: [docs/product/BRIEF.md](docs/product/BRIEF.md). Repo: https://github.com/deanobrien/familymeals.

Status: all feature lanes are merged and green in mock mode; the Supabase-backed stores are verified against a local Supabase (LV1; hosted push pending); first Azure deploy is staged. Details and next steps in the handover doc and [docs/ROADMAP.md](docs/ROADMAP.md).

## Prerequisites

Node 22+ (24 works), pnpm 9.4, Git. Docker Desktop only for the local Supabase stack; Azure CLI 2.60+ only for deploying. Full table: [docs/HANDOVER.md](docs/HANDOVER.md) section 2.

## Install and run (mock mode, no keys needed)

```
pnpm install
pnpm dev                      # http://localhost:3100  (mock AI, in-memory demo data, mock auth)
```

Optional `apps/web/.env.local` (see `.env.example`; never commit real values). Add an AI provider key in the running app under Settings > AI provider.

## Scripts

| Script                                  | Purpose                                               |
| --------------------------------------- | ----------------------------------------------------- |
| `pnpm dev`                              | Next.js dev server (port 3100)                        |
| `pnpm build`                            | Build all packages and the web app (turbo)            |
| `pnpm typecheck`                        | `tsc` in every workspace                              |
| `pnpm lint`                             | ESLint (flat config)                                  |
| `pnpm test`                             | Vitest in every package (turbo)                       |
| `pnpm e2e:install` then `pnpm test:e2e` | Install Chromium, run the Playwright suite (read [docs/TESTING.md](docs/TESTING.md) for isolation rules) |
| `pnpm mobile:export`                    | Android bundle check                                  |
| `pnpm format` / `pnpm format:check`     | Prettier                                              |

## Supabase

Config lives in `supabase/` (see DECISIONS.md D4); use the CLI via `pnpm exec supabase ...`. Local stack (Docker), cloud project linking, migrations, Realtime, Auth URLs and type generation: [docs/SUPABASE.md](docs/SUPABASE.md).

## Deploy

Azure App Service (Linux, Node 22): `scripts/package-appservice.ps1` builds `dist/appservice.zip`; the runbook is [docs/DEPLOY-APP-SERVICE.md](docs/DEPLOY-APP-SERVICE.md).

Local Supabase (Docker; works on 20.10.7, D140): `pnpm exec supabase start` (applies every migration plus `supabase/seed.sql`; ports 554xx: API :55421, Studio :55423, Mailpit :55424 for confirmation emails). `pnpm dev:live` runs the app on http://localhost:3131 against it (D142); `pnpm test:e2e:live` runs the live suite (D143). Cloud: `pnpm exec supabase link --project-ref <ref>` then `pnpm exec supabase db push --include-seed`. Details: [docs/SUPABASE.md](docs/SUPABASE.md).

## Layout

`apps/web` Next.js app | `apps/mobile` Expo Android | `packages/{domain,engine,ai,recipe-import,plan-orchestrator,refdata,db,ui}` shared TS (`@fr/*`) | `e2e/` Playwright | `supabase/` config + migrations | `docs/` handover, architecture, testing, deploy, security, product | `claude/` status and durable gotchas.

Docs: [CLAUDE.md](CLAUDE.md), [docs/HANDOVER.md](docs/HANDOVER.md), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md), [DECISIONS.md](DECISIONS.md), [claude/](claude/status-and-next-steps.md).
