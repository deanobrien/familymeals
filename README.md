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

- **Local** (Docker; works on 20.10.7, D140): `pnpm exec supabase start` (the first start applies every migration plus `supabase/seed.sql`; ports 554xx: API http://127.0.0.1:55421, Studio :55423, Mailpit :55424 for confirmation emails). `pnpm exec supabase db reset` re-applies from scratch; `pnpm exec supabase migration up --local` applies new ones. After a migration regenerate the types: `pnpm exec supabase gen types typescript --local > packages/db/src/database.types.ts`, then prettier (D141). `pnpm exec supabase stop` keeps the data volume.
- **App against local Supabase**: `pnpm dev:live` (http://localhost:3131, DATA_BACKEND=supabase, mock AI, temp data dir; D142). Sign up, then open the confirmation link in Mailpit.
- **Live e2e**: `pnpm test:e2e:live` (needs the stack running; starts its own dev server on 3133; D143). `pnpm test:e2e` stays mock-only.
- **Cloud** (London, eu-west-2): create a project in region London, `pnpm exec supabase link --project-ref <ref>`, `pnpm exec supabase db push --include-seed` (the seed is the reference ingredient list, D145). Put URL/keys in the host's server env, and set Auth in the dashboard: email confirmations on, minimum password 10, leaked-password protection, site URL and redirect URLs.

## Layout

`apps/web` Next.js app | `packages/{domain,engine,ai,db,refdata}` shared TS (`@fr/*`) | `e2e/` Playwright | `supabase/` config + migrations.

Docs: `CLAUDE.md`, `IMPLEMENTATION_PLAN.md`, `DECISIONS.md`, `claude/`.
