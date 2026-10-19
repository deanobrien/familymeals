# SUPABASE.md

Supabase provides Postgres, Row Level Security, Auth, Realtime and Storage. The CLI is a devDependency: always run it as `pnpm exec supabase ...` from the repo root. Config and migrations are in `supabase/` (D4). The schema, RLS model and RPC list are in [../supabase/SCHEMA.md](../supabase/SCHEMA.md); read that before changing a migration.

## 1. Local stack (Docker)

Requires Docker Desktop running (Docker 20.10 was too old).

```
pnpm exec supabase start            # first run pulls images; prints API URL, anon key, service_role key
pnpm exec supabase status           # reprint the URLs and keys later
pnpm exec supabase db reset         # drop and re-apply supabase/migrations/* (+ seed if any)
pnpm exec supabase stop
```

Ports (from `supabase/config.toml`): API 54321, DB 54322, Studio 54323 (http://127.0.0.1:54323), Inbucket mail catcher 54324, analytics 54327, pooler 54329. The printed keys are well-known local development keys, not secrets, but still do not paste them into docs.

Run the web app against it: create `apps/web/.env.local` (git-ignored; Next reads `.env*` from `apps/web/`, not the repo root):

```
DATA_BACKEND=supabase
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from supabase status>
NEXT_PUBLIC_SITE_URL=http://localhost:3100
```

then `pnpm dev`. Notes:

- `supabase/config.toml` `[auth]` `site_url` is `http://127.0.0.1:3000` and `additional_redirect_urls` lists only `https://127.0.0.1:3000`, but the dev server runs on **3100**. For local sign-up/confirm flows set `site_url = "http://localhost:3100"` and add `http://localhost:3100/auth/callback` to `additional_redirect_urls` (then `supabase stop` / `start`). Local email confirmation is off by default, so sign-up signs you in; mail is visible in Inbucket.
- No service-role key is needed on the normal path (D100). Only set `SUPABASE_SERVICE_ROLE_KEY` if you exercise the admin-client paths (`apps/web/lib/server/auth/admin.ts`).
- The first end-to-end run of the app on this stack is lane LV1 (HANDOVER section 7); until it lands treat the live path as unverified.

## 2. Migrations

Files are `supabase/migrations/<14-digit timestamp>_<name>.sql`, applied in filename order. All are `20261019...`:

| Timestamp prefix | Name | What |
|---|---|---|
| 000000 | baseline_extensions | extensions baseline (pgcrypto) |
| 000100 - 001100 | foundation, households, reference_data, recipes, meal_planning, shopping, receipts_pantry, nutrition_ai, rls, storage, realtime | schema v1 (L1), RLS on every table, private storage buckets, Realtime publication |
| 001200 | privacy_lifecycle | consent, deletion grace period, purge (L24) |
| 001300 | shopping_commands | `record_purchase` / `void_purchase`, command log |
| 001400 | owner_decisions | decisions A-D (D21-D24) |
| 001500 | transfer_ownership | atomic owner swap RPC (D37) |
| 001520 | recipe_plan_pantry_repositories | S1 repository RPCs (D51) |
| 001540 | pantry_purchase_mode_source_of_truth | D104 |
| 001600 | shopping_repository | S2: engine item state, `list_seq` cursor, `apply_shopping_command` |
| 001610 | receipts_prices | S2: `save_receipt`, price observations |
| 001620 | household_profile_ai_settings | S2: planner profile, per-household AI settings (ciphertext) |

Rules for adding one: new file with a later timestamp, never edit an applied migration once it has been pushed to the cloud project; keep every table RLS-enabled (a test asserts it); add SQL assert scripts under `packages/db/tests/rls/` and run `pnpm --filter @fr/db test` (applies **every** migration to in-process Postgres via PGlite, then runs the RLS scripts). Note PGlite has single-connection limits (no true concurrency), so concurrency semantics need the live stack.

## 3. Cloud project

- Project ref `guzsjqoosjqxfuqrjhxu`, URL `https://guzsjqoosjqxfuqrjhxu.supabase.co`, region London (eu-west-2). Currently **empty: no migrations pushed**.
- Link and push (needs a Supabase access token via `pnpm exec supabase login`, and the database password from the owner's password manager):

```
pnpm exec supabase link --project-ref guzsjqoosjqxfuqrjhxu
pnpm exec supabase db push          # applies pending migrations; review the list it prints
```

- Do this only after LV1 has passed against the local stack. `db push` is not reversible by the CLI; test destructive changes locally first. As an alternative, migrations can be pasted into the dashboard SQL editor in filename order.
- Keys (Dashboard > Project Settings > API): URL and anon key are public; the service role key is secret (HANDOVER section 5).

## 4. Realtime

Migration `...001100_realtime.sql` adds `shopping_lists`, `shopping_list_items`, `purchase_events`, `meal_plans`, `planned_meals`, `pantry_items` to the `supabase_realtime` publication, and `...001300_shopping_commands.sql` adds `shopping_command_log` (both guarded: no-ops if the publication does not exist). The app uses Realtime as a **hint** (D122, `apps/web/lib/shopping/live.ts`): the browser subscribes to `shopping_command_log` INSERTs filtered by `household_id` and then fetches by per-list `list_seq`; it polls only while the channel is down. After a push, confirm in Dashboard > Database > Replication that these tables are in the publication (verify in LV1).

## 5. Auth URL configuration (cloud)

Dashboard > Authentication > URL Configuration: Site URL `https://<host>` and redirect `https://<host>/auth/callback` (details and the `?*` variant in [DEPLOY-APP-SERVICE.md](DEPLOY-APP-SERVICE.md) section 4). Also: email confirmation on, minimum password length 10, leaked-password protection on, refresh-token rotation on, custom SMTP before real invites ([security/SECURITY-CHECKLIST.md](security/SECURITY-CHECKLIST.md) section 3).

## 6. Storage

Private buckets `recipe-images` and `receipt-images` (10 MiB limit; jpeg/png/webp/heic), created by migration `...001000_storage.sql`. Object path `<household_id>/recipes/<recipe_id>/<image_id>.jpg` or `<household_id>/receipts/<receipt_id>/<page>.jpg`; access = active membership of the household in the first path segment; clients use signed URLs. **The web app does not use these buckets yet**: uploaded photos are local files under `APP_DATA_DIR` (`/home/data` on App Service), which is why `ALLOW_LOCAL_FILE_STORE=true` is needed in production. Moving uploads to Storage is on the roadmap.

## 7. Generating types

`packages/db/src/database.types.ts` is a placeholder (the hand-written zod row schemas in `@fr/domain` are the typed contract). To generate real types:

```
pnpm exec supabase gen types typescript --local > packages/db/src/database.types.ts
# or, against the cloud project:
pnpm exec supabase gen types typescript --project-id guzsjqoosjqxfuqrjhxu > packages/db/src/database.types.ts
```

then run typecheck: the placeholder's empty `Database` interface is replaced, so downstream imports may need small fixes.

## 8. RLS model summary

RLS is enabled on every table; `anon` has no grants; helper functions `is_household_member()` / `is_household_owner()` (SECURITY DEFINER, empty search_path) are used by all policies; household-scoped rows carry `household_id` with composite foreign keys so a row can never point at another household's parent; purchases, receipts and the shopping command log are written only through SECURITY DEFINER RPCs; reference data is read-only to clients; a deleted household is read-only for a 14-day grace period (D24). Full detail: [../supabase/SCHEMA.md](../supabase/SCHEMA.md) sections "Key design decisions" and "RLS model".
