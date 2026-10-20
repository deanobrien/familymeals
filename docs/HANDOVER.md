# HANDOVER - start here

Written for an agent (or developer) on a **different machine** who has only a fresh `git clone` of https://github.com/deanobrien/familymeals (branch `main`). Nothing outside the repo is needed: no shared drive, chat history or agent memory. Anything that lives only on the owner's machine or in a cloud dashboard is listed in section 5 (names only, never values).

Last refreshed: 2026-10-20 (branch `prj018/w0a-skeleton`, integration state after S2 + D1 + PL2 + Q2/S2 verification + LV1 live local Supabase verification). When you change state (merge a lane, deploy, run something live), update sections 6-8 here and `claude/status-and-next-steps.md`.

## 1. What this is

Family Recipes (working name; PRJ-018): UK household recipe library with AI photo import, meal planning from a prompt, nutrition and cost calculation, a shared real-time shopping list, receipt scanning (updates prices and ticks the list), and a pantry (including a video/photo scan). Web app first (Next.js), Android (Expo) later. Product intent: [docs/product/BRIEF.md](product/BRIEF.md). Architecture as built: [ARCHITECTURE.md](ARCHITECTURE.md). Decisions and their reasons: [../DECISIONS.md](../DECISIONS.md).

## 2. Prerequisites

| Tool | Version | Why / notes |
|---|---|---|
| Node.js | 22 or newer (24 works; the Azure runtime is 22) | `engines` says >=20 |
| pnpm | 9.4.x (`corepack enable` then `corepack prepare pnpm@9.4.0 --activate`) | pinned in `packageManager` |
| Git | any recent | LF line endings are enforced by `.gitattributes` |
| Docker | 20.10.7 or newer | **Only** for the local Supabase stack (`supabase start`). 20.10.7 works (LV1) with `edge_runtime` and analytics disabled in `supabase/config.toml` (the edge container exits 255 there) |
| Supabase CLI | installed by `pnpm install` (devDependency); always run as `pnpm exec supabase ...` | needs Docker for `start`/`db reset` |
| Playwright Chromium | `pnpm e2e:install` once | e2e only |
| PowerShell | Windows PowerShell 5.1 or pwsh | the packaging script is PowerShell. 5.1 has **no `&&`**; chain with `;` |
| Azure CLI | **2.60 or newer** | only for deploy. Older CLIs fail with `WSAECONNRESET` against the new unique default hostnames |

You do **not** need any API key, Supabase project or Azure account to build, test and run the app in mock mode.

## 3. Clone, install, run, test

```
git clone https://github.com/deanobrien/familymeals.git
cd familymeals
pnpm install --frozen-lockfile
pnpm dev                       # http://localhost:3100
```

Mock mode (default, no env file needed): mock AI provider (deterministic sample data, "nothing is read from your photos"), in-memory demo data, mock auth as "Alice Smith / household A" with a banner on every page. Data resets when the server restarts. To use a real AI provider locally, open Settings > AI provider in the running app and paste a key (stored encrypted in `apps/web/.data/`, git-ignored; the dev encryption secret is auto-generated into the same folder, see section 5).

Verification (what "green" means; run from the repo root):

```
pnpm typecheck       # 11 tasks
pnpm lint
pnpm test            # turbo: unit tests in every package (about 1,000+ tests; counts in claude/status-and-next-steps.md)
pnpm build           # 9 tasks, includes the Next production build
pnpm e2e:install && pnpm test:e2e   # Playwright; read docs/TESTING.md first (isolation)
```

Run against the **local Supabase stack** (needs Docker running): follow [SUPABASE.md](SUPABASE.md) section 1. Short version (verified by LV1, D140-D149):

```
pnpm exec supabase start                   # ports 554xx; applies all 23 migrations + supabase/seed.sql
pnpm dev:live                              # app on http://localhost:3131, DATA_BACKEND=supabase, mock AI, temp data dir (scripts/dev-live.mjs reads the stack's keys; no .env.local needed)
pnpm test:e2e:live                         # live suite (e2e/live/), own dev server on 3133; 20/20 pass
```

Email confirmation is ON locally and minimum password is 10: sign up, then open the confirmation link in Mailpit at http://127.0.0.1:55424. The stack uses ports 554xx (API 55421, DB 55422, Studio 55423, Mailpit 55424) because another local Supabase project (golfbook) owns 543xx: never stop its containers. Regenerate `packages/db/src/database.types.ts` after each migration.

Deploy to Azure App Service: [DEPLOY-APP-SERVICE.md](DEPLOY-APP-SERVICE.md).

## 4. Environments

| Environment | Web | Data | Auth | AI | Used for |
|---|---|---|---|---|---|
| Local mock | `pnpm dev` (3100) | in-memory, resets on restart | mock auth (Alice / household A) | mock (or key pasted in Settings) | day-to-day UI work, all unit + e2e tests |
| Local Supabase | `pnpm dev:live` (3131) | Docker Supabase (ports 554xx) | real Supabase Auth (Mailpit :55424, confirmations on) | mock or Settings key | verifying repositories, RLS, Realtime (LV1, done); `pnpm test:e2e:live` |
| Supabase cloud | n/a | project ref `guzsjqoosjqxfuqrjhxu`, URL https://guzsjqoosjqxfuqrjhxu.supabase.co, region London (eu-west-2) | Supabase Auth | n/a | the production-like database. **Migrations are NOT yet pushed** (section 8) |
| Azure App Service | https://family-recipes-dean-cph4g5cuh9fmhhfy.ukwest-01.azurewebsites.net (resource group `rg-family-recipes`, app `family-recipes-dean`, UK West, owner's personal Azure subscription, not the employer's) | Supabase cloud (once pushed) + `/home/data` files for uploaded photos | Supabase Auth | per-household key in Settings, or `AI_PROVIDER` + key app settings | first real deploy (test, not production) |

## 5. Where every secret and private setting lives (names only)

Never commit values. If a value is lost, regenerate it as shown.

| Name | What | Where it is configured | How to (re)generate |
|---|---|---|---|
| `APP_SECRET` (>= 16 chars; use 32 random bytes hex) | encrypts stored AI provider keys (AES-256-GCM). **If it changes, stored AI keys become unreadable and must be re-entered in Settings** | Azure App Service application setting; owner's password manager | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| dev app secret file | the same, for local dev only | auto-created as `apps/web/.data/app-secret` (git-ignored) on first key save; production refuses it (set `APP_SECRET`) | delete the folder to reset (AI keys saved locally are then lost) |
| `SUPABASE_SERVICE_ROLE_KEY` | privileged, bypasses RLS; server only. The normal user request path never uses it (D100); only `lib/server/auth/admin.ts` reads it, for exceptional server-side paths that re-verify the acting user, plus the dev fallback | App Service application setting; Supabase dashboard > Project Settings > API | rotate in the Supabase dashboard, update the app setting, restart |
| `CRON_SECRET` (>= 16 chars) | shared secret for `POST /api/jobs/storage-cleanup` (header `x-cron-secret`); also needs `SUPABASE_SERVICE_ROLE_KEY` | Azure App Service application setting and the Logic App / WebJob that calls the endpoint | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`; update both places together |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_URL` | public values, **baked into the build** and the CSP | App Service app settings **and** the build environment (`.env.cloud` / `apps/web/.env.production.local`) | Supabase dashboard > Project Settings > API |
| `NEXT_PUBLIC_SITE_URL` | public origin used in emailed links; baked into the build | same as above | the App Service default hostname |
| Supabase database password, `SUPABASE_ACCESS_TOKEN` | needed by `supabase link` / `db push` | owner's password manager; `pnpm exec supabase login` (token) | Supabase dashboard (database password reset; account access tokens) |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, Azure OpenAI key | AI providers | preferably entered per household in Settings > AI provider (stored encrypted); or App Service setting | each provider's console |
| GitHub access | pushing to the repo | owner's machine credentials | n/a |
| Azure login | deploy | `az login --use-device-code` on the owner's personal subscription (see DEPLOY-APP-SERVICE.md section 5) | n/a |

`.env.cloud` (git-ignored, lives at the repo root on the owner's machine only) lists the **public** values used when building the zip. Format, one `KEY=value` per line, `#` comments:

```
NEXT_PUBLIC_SUPABASE_URL=https://guzsjqoosjqxfuqrjhxu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from the Supabase dashboard>
SUPABASE_PROJECT_REF=guzsjqoosjqxfuqrjhxu
NEXT_PUBLIC_SITE_URL=https://family-recipes-dean-cph4g5cuh9fmhhfy.ukwest-01.azurewebsites.net
```

`scripts/package-appservice.ps1` does not read `.env.cloud` itself: load these into the shell (or copy the `NEXT_PUBLIC_*` lines into `apps/web/.env.production.local`) before packaging; see DEPLOY-APP-SERVICE.md section 1. The service role key is deliberately never stored there. If you do not have this file, recreate it from the Supabase dashboard.

## 6. Current state

- **Merged and green (mock mode)**: all foundation lanes (ui, ai, refdata, qa, engine L3/L7/L8/L9/L10/L17a/L22a, domain/schema/RLS), app lanes (home/settings/privacy, library, photo import, planner + prompt planning, pantry + pantry scan, shopping, receipts, auth/households/invitations, Android app), real cost and nutrition (C1), refdata coverage (R2), Supabase repositories for every store (S1, S2) with Realtime hints replacing polling, AI provider settings (OpenAI/Azure/Anthropic), planner hardening (PL2: single `PlanConstraints`, editable chips), Azure App Service deploy prep (D1: standalone build, health endpoint, security headers/CSP, production config guard).
- **Tests**: see the newest counts in `claude/status-and-next-steps.md` (latest recorded: web 441, engine 749, ai 92, refdata 59, mobile 42, domain 38, recipe-import 31, ui 26, e2e fixtures 26, db 16, plan-orchestrator 14; Playwright 172 passed / 100 skipped (`fixme`)).
- **Verified live against a LOCAL Supabase (LV1, D140-D149)**: all 23 migrations plus `supabase/seed.sql` apply cleanly on Postgres 17.11; PostgREST as the signed-in user, RLS through the real client, Auth sign-up/confirm and the Realtime hint feed run in the live suite (`pnpm test:e2e:live`, 20/20). LV1 fixed three bugs (invitation email lock, empty reference ingredients in the DB, `pantry_source` enum values; migrations `001910`, `001920`, and the seed).
- **Storage (ST1, D190-D196)**: recipe covers, import page photos and receipt photos use private Supabase Storage buckets via an `ImageStore` (local files remain the dev / mock implementation); signed-URL serving, household isolation (other household and anonymous refused), bearer access and the cleanup job are covered by unit tests, PGlite RLS script `010_st1_storage_uploads.sql` and the live suite `e2e/live/storage.live.spec.ts` against the local stack. Not yet run against the hosted project.
- **Still not verified**: the hosted Supabase project and its Auth redirect flows, the CSP against the hosted Supabase, sharp on Linux, heavy multi-connection concurrency, live AI model accuracy (photo extraction, plan parsing, pantry scan).
- **Supabase cloud project exists but is empty**: nothing pushed yet; the LV1 gate is clear, so the owner can run `pnpm exec supabase link --project-ref guzsjqoosjqxfuqrjhxu` then `pnpm exec supabase db push --include-seed`.
- **Azure App Service resources exist** (see section 4); a zip has been built and the portal/Kudu upload path worked out, but the app is not yet confirmed healthy with the real Supabase project (smoke checklist in DEPLOY-APP-SERVICE.md section 7 is the first real test).
- **Product name** still undecided (working name "Family Recipes"; scope `@fr/*`).

## 7. In progress at the time of writing (parallel lanes, each in its own worktree on a `prj018/*` branch, merged by the integrator)

| Lane | What | Notes for whoever continues |
|---|---|---|
| B1 | Bug fixes found while testing | **done and merged** (D160-D164): sandbox import save (resolveRequestAuth accepts dev sandbox ids), per-household in-memory recipe libraries, 44px tap targets, 900px nav breakpoint kept, "offline shopper loses the race" flake was a spec race (not an app bug) |
| LV1 | Live verification against a **local Supabase** (Docker) | **done and merged** (D140-D149): live suite 20/20, three bugs fixed; open items in section 9 |
| D2 | Deploy-zip "no rebuild" fix | **done and merged** (commit "Package: stop App Service Oryx/Kudu server-side builds"): the packaging script now emits start-only `package.json` files, no lockfiles and a `.deployment` file; see DEPLOY-APP-SERVICE.md section 6. Needs a real redeploy to confirm |
| X1 | Recipe discovery from TheMealDB | new recipe-source provider; see ROADMAP idea backlog |
| X2 | Open Food Facts product source | new product-source provider (barcodes/pack data) |

If a lane's branch is merged into your checkout, its decisions are in `DECISIONS.md` (new blocks above D155) and this table can be deleted.

## 8. Exact next steps

1. LV1 is done; the schema is cleared for the cloud.
2. **Push the schema** (owner): `pnpm exec supabase link --project-ref guzsjqoosjqxfuqrjhxu` then `pnpm exec supabase db push --include-seed` (database password from the password manager; `--include-seed` is required so the reference ingredient list is loaded). Then set the hosted Auth settings to set in the dashboard (Authentication): email confirmations ON, minimum password length 10, leaked-password protection ON, Site URL `https://family-recipes-dean-cph4g5cuh9fmhhfy.ukwest-01.azurewebsites.net`, redirect URLs `https://family-recipes-dean-cph4g5cuh9fmhhfy.ukwest-01.azurewebsites.net/auth/callback` and `http://localhost:3100/auth/callback`. Then enable Realtime for the tables in migration `20261019001100_realtime.sql` if the dashboard shows the publication empty ([SUPABASE.md](SUPABASE.md) section 4), and configure Auth URLs (section 5 there).
3. **Rebuild and redeploy the zip** (it now includes the D2 no-rebuild fix): `scripts/package-appservice.ps1`, then Kudu upload; rebuild whenever `NEXT_PUBLIC_*` values change (they are baked in).
4. **Smoke test** on the Azure hostname with the checklist in DEPLOY-APP-SERVICE.md section 7 (sign-up email, household, recipe, photo import, planner, restart).
5. **Android APK on a real phone** (owner; the sync now uses `list_seq` + Realtime, D210-D212, so it is ready for a device): in `apps/mobile` run `eas login`, `eas init` (commit the `projectId` it writes into `app.json`), `eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon key>" --environment preview --visibility plaintext`, then `eas build -p android --profile preview`; open the build link on the phone and install the `.apk` (allow "Install unknown apps"). Needs the hosted schema pushed (step 2) and an account + household created on the web first (the app signs in with email/password only). Full steps, plus Expo Go over the LAN for quick checks, are in [apps/mobile/README.md](../apps/mobile/README.md). Never put a service-role or AI key in an `EXPO_PUBLIC_*` variable. Optional: add `familyrecipes://auth/callback` to the Supabase redirect URLs (D214).
6. **Storage (ST1, D190-D196) is built**: photos live in private Supabase Storage and `ALLOW_LOCAL_FILE_STORE` is gone; phone (bearer) uploads use the caller's own request-scoped client and household via the same `ImageStore` (extract routes run inside `runWithDataContext`, D213). Owner actions: `db push` (migration `20261020002100_st1_storage_uploads.sql`), add `CRON_SECRET` (and keep `SUPABASE_SERVICE_ROLE_KEY`) as App Service settings, delete `ALLOW_LOCAL_FILE_STORE`, rebuild/redeploy, and schedule `POST /api/jobs/storage-cleanup` daily (DEPLOY-APP-SERVICE.md section 4b). The in-progress import record (draft + photos, 1 h) is still process memory, so keep one instance.
7. `packages/db/src/database.types.ts` is generated from the local stack (D141); regenerate after every migration (`pnpm exec supabase gen types typescript --local`, then prettier), or against the cloud project with `--project-id guzsjqoosjqxfuqrjhxu` once pushed.
8. Run the GitHub Actions workflow (`.github/workflows/ci.yml`) once the repo has it enabled; fix anything Linux-specific.
9. Security checklist items before inviting real users: [security/SECURITY-CHECKLIST.md](security/SECURITY-CHECKLIST.md) (custom SMTP, leaked-password protection, rate limits, AI budget caps, export/deletion UI, backups).
10. Remaining roadmap: [ROADMAP.md](ROADMAP.md).

## 9. Known issues and caveats

- `DATA_BACKEND=supabase` cannot be combined with mock-auth demo mode (needs real Supabase env).
- With Supabase, recipe lists with price filters / cost sort load up to 10,000 recipes and cost them in the app (D58).
- Many mock-suite e2e specs are `test.fixme` (live-Supabase flows, now covered by `e2e/live/`); 100 skipped is expected in the mock run.
- The mock e2e suite has 2-3 load-related flaky shopping/journey failures per full run; they pass in isolation (tracked, not yet fixed).
- LV1 open items (the live-before-confirmed Realtime gap was fixed by RT1, D200-D203): receipts, price observations and per-household AI settings have no live tests; recipes created through the form have no ingredient links.
- Dev-only service-role fallback (`SUPABASE_DATA_CONTEXT=service`, D100) exists for scripts; production startup refuses it.
- Photo uploads >10 MB are downscaled in the browser; Next buffers request bodies in middleware up to 10 MB by default, raised to 40 MB in `next.config.mjs` (see `claude/memories/middleware-body-limit-10mb.md`).
- App Service internal hostname (fixed 2026-10-20): never build absolute URLs/redirects from `request.url`/Host; use `publicOrigin()` (`lib/server/site-url.ts`). Email scanners can consume one-time confirmation links (`otp_expired`); the sign-in page explains this and offers "Resend confirmation email". See `claude/memories/app-service-internal-hostname.md`.
- B1 App Service quota is not always available in a region; see DEPLOY-APP-SERVICE.md section 8.
- Receipts/AI quality on real data is unmeasured; the mock provider returns canned data.
- Android: `eas build` has never been run (needs the owner's Expo login) and no APK has been installed on a device yet. The Bearer endpoints and the shopping sync were verified against the LOCAL Supabase stack only (`scripts/verify-mobile-bearer.mjs`, `pnpm --filter @fr/mobile test:live`, D213/D215); a Bearer photo-import bug in the web app was found and fixed on the way (D213). Plain-http LAN backends only work in Expo Go, not in the APK.

## 10. Decisions log

[../DECISIONS.md](../DECISIONS.md) (D1..D154+, newest lanes last). Owner decisions A-D (purchase history survives account deletion, household-custom ingredients deferred, SQL converts metric only, read-only during the 14-day deletion grace) are D21-D24. Open owner decisions: product name; Anthropic/OpenAI keys for production; whether to enable the CI workflow.

## 11. Documentation map

| Doc | Purpose |
|---|---|
| [../CLAUDE.md](../CLAUDE.md) | agent entry point, commands, conventions |
| [ARCHITECTURE.md](ARCHITECTURE.md) | packages, data flows, provider interfaces, backend selection |
| [TESTING.md](TESTING.md) | test suites, how to run, isolation, flakes |
| [SUPABASE.md](SUPABASE.md) | local stack, cloud project, migrations, auth, storage |
| [DEPLOY-APP-SERVICE.md](DEPLOY-APP-SERVICE.md) | Azure deploy runbook |
| [ROADMAP.md](ROADMAP.md) | milestone status and ideas backlog |
| [security/](security/THREAT-MODEL.md) | threat model, privacy, export/deletion, checklist, ops runbook |
| [product/](product/BRIEF.md) | original brief, review, delivery plan (historical) |
| [history/](history/INTEGRATION-NOTES.md) | first-merge reviewer notes, contract seed (historical) |
| [../claude/](../claude/status-and-next-steps.md) | verified status per integration pass; `memories/` = durable gotchas |
| [../supabase/SCHEMA.md](../supabase/SCHEMA.md) | schema, RLS model, RPCs |
| [../e2e/ACCEPTANCE.md](../e2e/ACCEPTANCE.md), [../e2e/A11Y-AUDIT.md](../e2e/A11Y-AUDIT.md) | acceptance matrix, accessibility audit |
- Recipe detail opens at the household default servings (fallback 4) with a per-member localStorage override per recipe (lib/recipes/initial-servings.ts).
