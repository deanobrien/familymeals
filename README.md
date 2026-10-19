# Family Recipes (working name)

AI-assisted family recipe library, meal planner, nutrition/cost calculator and shared shopping list for UK households. Product brief: `C:\TFS\Projects\PRJ-018-FamilyRecipePlatform\docs\`.

Status: **Wave 0a skeleton** - monorepo, tooling and placeholder home page only. No domain schema yet.

## Prerequisites

Node >= 20 (tested 24), pnpm 9.4. Docker is needed only for the local Supabase stack (Docker 20.10 may be too old for current Supabase images).

## Install and run

```
pnpm install
cp .env.example .env.local    # mock AI by default, no secrets needed yet
pnpm dev                      # http://localhost:3100
```

## Scripts

| Script                                  | Purpose                                               |
| --------------------------------------- | ----------------------------------------------------- |
| `pnpm dev`                              | Next.js dev server (port 3100)                        |
| `pnpm build`                            | Build all packages and the web app (turbo)            |
| `pnpm typecheck`                        | `tsc` in every workspace                              |
| `pnpm lint`                             | ESLint (flat config)                                  |
| `pnpm test`                             | Vitest in every package (turbo)                       |
| `pnpm e2e:install` then `pnpm test:e2e` | Install Chromium, run Playwright smoke test in `e2e/` |
| `pnpm format` / `pnpm format:check`     | Prettier                                              |

## Supabase

Config lives in `supabase/` (see DECISIONS.md). Use the CLI via `pnpm exec supabase ...`.

- **Local** (needs Docker): `pnpm exec supabase start`, copy the printed URL/keys to `.env.local`, `pnpm exec supabase db reset` to apply migrations.
- **Cloud** (London, eu-west-2): create a project in region London, `pnpm exec supabase link --project-ref <ref>`, `pnpm exec supabase db push`. Put URL/keys in the host's server env.

## Layout

`apps/web` Next.js app | `packages/{domain,engine,ai,db,refdata}` shared TS (`@fr/*`) | `e2e/` Playwright | `supabase/` config + migrations.

Docs: `CLAUDE.md`, `IMPLEMENTATION_PLAN.md`, `DECISIONS.md`, `claude/`.
