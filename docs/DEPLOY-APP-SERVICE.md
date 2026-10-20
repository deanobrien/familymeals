# DEPLOY-APP-SERVICE.md

Deploying Family Recipes (`apps/web`) to Azure App Service: Linux, Node 22 LTS, Basic B1 plan, in the owner's **personal** Azure subscription. Decisions: D150-D154 in `DECISIONS.md`. Nothing here is run by the build: you create the Azure resources in the portal and run the packaging/deploy steps yourself.

**Current deployment (reference values, all public):**

| Item | Value |
|---|---|
| Resource group | `rg-family-recipes` |
| Web App name | `family-recipes-dean` |
| Region | UK West |
| Default hostname | `family-recipes-dean-cph4g5cuh9fmhhfy.ukwest-01.azurewebsites.net` |
| Kudu (SCM) hostname | `family-recipes-dean-cph4g5cuh9fmhhfy.scm.ukwest-01.azurewebsites.net` |
| Supabase project | ref `guzsjqoosjqxfuqrjhxu`, URL `https://guzsjqoosjqxfuqrjhxu.supabase.co` (London) |

**Important**: new Web Apps get a **unique default hostname** (`<name>-<random>.<region>-01.azurewebsites.net`), not `<name>.azurewebsites.net`. Use the hostname shown on the app's Overview page everywhere below (`<host>`). `NEXT_PUBLIC_SITE_URL` and the Supabase Auth URLs must use it.

**This is a test deploy, not production.** Shopping, receipts, price observations, planner profile and AI provider settings (S2, D120-D129) and, since ST1 (D190-D196), uploaded recipe and receipt photos (private Supabase Storage buckets) are all in Supabase when `DATA_BACKEND=supabase`; nothing user-visible is a local file any more, and the old `ALLOW_LOCAL_FILE_STORE=true` setting is no longer needed (a leftover one is ignored; delete it). Keep **one instance**: the short-lived in-progress import (photos + draft held for the review screen, 1 hour) is still in process memory, so a scale-out would send a user to an instance that has forgotten their upload (they are asked to upload again, nothing is lost or leaked).

## 0. Prerequisites

- Supabase project (London) with every `supabase/migrations/*.sql` applied: see [SUPABASE.md](SUPABASE.md). Note the URL, the anon (publishable) key and the service role key (Dashboard > Project Settings > API).
- Node 22 or 24, pnpm 9.4 and Git on a Windows machine (the packaging script is PowerShell). Windows PowerShell 5.1 is fine; it has **no `&&`**, chain commands with `;`.
- Azure CLI **2.60 or newer** if you deploy with `az` (older versions fail with `WSAECONNRESET` against the unique default hostnames; the Kudu portal route needs no CLI).
- `APP_SECRET`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep it in your password manager. **If it changes, stored AI keys become unreadable** (re-enter them in Settings).
- An AI provider key (optional now: each household can enter its own in Settings > AI provider).

### Azure CLI login for a personal subscription (if the machine also has an employer login)

Use a separate config directory so the personal subscription never mixes with other logins, and device-code login (no browser redirect to the wrong tenant):

```powershell
$env:AZURE_CONFIG_DIR = "$HOME\.azure-personal"
az login --use-device-code
az account show        # confirm it is the personal subscription
```

Set `AZURE_CONFIG_DIR` again in every new shell.

## 1. Build the package

The two `NEXT_PUBLIC_*` values (and `NEXT_PUBLIC_SITE_URL`) are public but **baked into the build** (browser bundle, middleware, CSP `connect-src`). **Rebuild the zip whenever the Supabase project or the site hostname changes.**

The owner keeps these in a git-ignored `.env.cloud` at the repo root (public values only, one `KEY=value` per line; the service role key is never stored there):

```
# Supabase cloud (PRJ-018) - public values only; gitignored.
NEXT_PUBLIC_SUPABASE_URL=https://guzsjqoosjqxfuqrjhxu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>
SUPABASE_PROJECT_REF=guzsjqoosjqxfuqrjhxu
NEXT_PUBLIC_SITE_URL=https://<host>
```

The script reads `NEXT_PUBLIC_*` from the process environment or from `apps\web\.env.production.local` (not from `.env.cloud` directly), so load them first:

```powershell
cd <your checkout>
Get-Content .env.cloud | Where-Object { $_ -match '^\s*(NEXT_PUBLIC_[A-Z_]+)\s*=\s*(.*?)\s*$' } | ForEach-Object { Set-Item "Env:$($Matches[1])" $Matches[2] }
powershell -ExecutionPolicy Bypass -File scripts\package-appservice.ps1
```

Output: `dist\appservice.zip` (git-ignored). Never put secrets in the zip.

What the script does: copies the tree to `%TEMP%\fr-appservice-build` (a short, symlink-free, hoisted install; Windows without Developer Mode cannot create symlinks, which Next's standalone copy needs), builds Next in `standalone` mode, adds `.next/static` and `public`, makes sure the **linux-x64 sharp** binaries are included, and zips with forward-slash entries (tar.exe; `Compress-Archive` writes backslashes that break on Linux). Start command inside the zip: `node apps/web/server.js`.

If the build fails with `EPERM` symlink errors you are building in the repo instead of the hoisted copy; if it fails removing/overwriting a libvips DLL because a previous process locks it, close node processes or pass a fresh build root: `scripts\package-appservice.ps1 -BuildRoot C:\frbuild2`. (See `claude/memories/`.)

## 2. Create the Azure resources (portal)

1. **Resource group** `rg-family-recipes`, region UK West.
2. **Web App**: Publish **Code**, Runtime stack **Node 22 LTS**, OS **Linux**, region **UK West**, new Linux plan **Basic B1** (Always On needs Basic or higher). Deployment: leave GitHub Actions/continuous deployment disabled. Public access on. Application Insights optional (off for the first test).
3. **B1 quota error** ("Operation cannot be completed without additional quota", SKU Basic VMs 0): the region has no Basic quota for the subscription. Options: pick another region (UK South, North Europe, West Europe are the nearest; the Web App and the Supabase London project need not be co-located but latency is better close by), request a quota increase (Portal > Subscriptions > Usage + quotas, Basic App Service plan VMs; can take a while for new/free subscriptions), or use the **F1 free** plan for a throwaway smoke test (no Always On, 60 CPU-min/day, 1 GB; the app will cold-start and sleep, and the health-check setting is unavailable). Moving region changes the default hostname: rebuild the zip (section 1).
4. Open the app and note the **default hostname** on Overview.

## 3. Configure

### 3a. Application settings (Settings > Environment variables)

**Secret** = never paste into chat, tickets or git. Apply restarts the app.

| Name | Value | Source | Secret |
|---|---|---|---|
| `NODE_ENV` | `production` | fixed | no |
| `HOSTNAME` | `0.0.0.0` | fixed (Next listens on all interfaces; App Service sets `PORT`) | no |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` | fixed: the zip is pre-built, stop Kudu running a build | no |
| `ENABLE_ORYX_BUILD` | `false` | fixed, set together with the row above: the zip is pre-built and also carries a `.deployment` file and a build-script-free root `package.json`, so Oryx never runs `npm install` / `npm run build` | no |
| `WEBSITES_CONTAINER_START_TIME_LIMIT` | `600` | the first start extracts a large zip and can exceed the 230 s default; raise (max 1800) if the log shows the container being killed | no |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://guzsjqoosjqxfuqrjhxu.supabase.co` | Supabase API settings | no |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key | Supabase API settings | no (RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key | Supabase API settings; server-only, bypasses RLS | **yes** |
| `DATA_BACKEND` | `supabase` | fixed (startup refuses anything else in production) | no |
| `APP_SECRET` | 32+ random chars | step 0 | **yes** |
| `NEXT_PUBLIC_SITE_URL` | `https://<host>` (no trailing slash) | the app's default hostname; also baked into the build | no |
| `CRON_SECRET` | 32+ random chars | protects the storage-cleanup endpoint (section 4b); without it (or the service role key) the endpoint answers 503 and nothing is cleaned up | **yes** |
| `APP_DATA_DIR` | `/home/data` | persists across restarts and deploys; never use wwwroot | no |
| `AI_PROVIDER` | `anthropic` (or `openai`) | choose; never `mock` (startup refuses it) | no |
| `ANTHROPIC_API_KEY` (or `OPENAI_API_KEY`) | provider key | skip if you will enter it in Settings instead | **yes** |
| `AI_MODEL_TEXT`, `AI_MODEL_VISION` | model ids | optional overrides | no |

Do **not** set `AI_ALLOW_MOCK_IN_PRODUCTION`, `SUPABASE_DATA_CONTEXT`, `SUPABASE_DEFAULT_*`, `SUPABASE_URL`/`SUPABASE_ANON_KEY` (dev fallbacks). If a required setting is missing or a forbidden one set, every request returns 500 and the Log stream shows "Invalid production configuration" with the reasons. Optional hardening: Key Vault references for the secrets.

### 3b. General settings

- Startup command: `node apps/web/server.js`. Always On: on. HTTPS Only: on, minimum TLS 1.2. ARR affinity: off. FTP: FTPS only or disabled.
- Health check (Monitoring): enabled, path `/api/health`.
- App Service logs: Application logging File System, Information; use Log stream to watch startup.

## 4. Supabase Auth URL configuration

Supabase dashboard > Authentication > URL Configuration:

- **Site URL**: `https://<host>`
- **Redirect URLs**: `https://<host>/auth/callback`; if emailed links land on the Site URL instead (the app appends `?next=...`) also add `https://<host>/auth/callback?*`. No wildcard host, no wildcard path.
- Keep `http://localhost:3100/auth/callback` only on a dev project, not here.
- Check SECURITY-CHECKLIST section 3: email confirmation on, leaked-password protection, minimum length 10, refresh-token rotation, custom SMTP before inviting real users (the built-in mailer is heavily rate limited). See [SUPABASE.md](SUPABASE.md).

## 4b. Storage buckets and the cleanup schedule (ST1, D190-D196)

**Buckets.** Photos live in two **private** buckets, `recipe-images` and `receipt-images`, created (and forced private, 10 MiB, jpeg/png/webp/heic) by migration `20261019001000_storage.sql`, so `supabase db push` is the whole setup. After the push check Dashboard > Storage: both buckets exist and show **Private**; do not add policies or make them public. Object paths are `<household_id>/<kind>/<id>/<file>` and the storage policies only allow active members of that household. The app talks to Storage as the signed-in user (never the service role) and shows images through `/api/images/...`, which answers with a 302 to a 5-minute signed URL. The CSP already allows images from the Supabase origin.

**Cleanup job.** Storage never cascades from row deletes, so a small job deletes the objects: it expires receipt photos 90 days after the receipt was confirmed, queues abandoned uploads (older than 24 h and not referenced by any recipe or receipt), and deletes everything queued in `storage_cleanup_queue` (deleted recipes release their cover, deleted receipts and purged households queue theirs). The job is the endpoint

```
POST https://<host>/api/jobs/storage-cleanup      header:  x-cron-secret: <CRON_SECRET>
```

It needs the app settings `CRON_SECRET` (16+ chars) and `SUPABASE_SERVICE_ROLE_KEY` (it is the only place the service role is used for Storage, and only to delete). It answers 401 for a wrong or missing secret, 503 when not configured, and 200 with JSON counts `{ ok, receiptImagesExpired, staleQueued, deleted, failed }`. A failed delete stays queued and is retried on the next run (up to 8 attempts). It is safe to run any number of times. **Schedule it at least daily**; pick one:

- **Azure Logic App (recommended, no code):** create a Consumption Logic App, trigger *Recurrence* (every 1 day, any time), action *HTTP*: method POST, URI `https://<host>/api/jobs/storage-cleanup`, header `x-cron-secret` = the secret (store it as a secure parameter, not plain text). Use *Run trigger* once to test; the run history shows the JSON.
- **WebJob (same App Service):** Kudu > WebJobs, or upload a `cleanup.ps1`/`.sh` under `/home/site/wwwroot/App_Data/jobs/triggered/storage-cleanup/` with a `settings.job` of `{"schedule": "0 0 3 * * *"}` that calls `curl -fsS -X POST -H "x-cron-secret: $CRON_SECRET" http://localhost:$PORT/api/jobs/storage-cleanup` (the app settings are visible to the WebJob as environment variables). Requires Always On (already on).
- Quick manual run, any time: `curl -fsS -X POST -H "x-cron-secret: <secret>" https://<host>/api/jobs/storage-cleanup`.

Until it is scheduled nothing breaks; unwanted photos simply linger. Check the cleanup status with the queue: `select count(*) filter (where processed_at is null) as pending, count(*) filter (where last_error is not null and processed_at is null) as failing from storage_cleanup_queue;` (service role / SQL editor only).

## 5. Deploy the zip

**Route A (the one that has worked): Kudu drag-and-drop.**

1. Open `https://<scm-host>/` (the Kudu hostname above; sign in with the Azure account that owns the app), **Debug console > Bash** (or CMD).
2. Navigate to `/home/site/wwwroot` in the file browser (top of the page shows the folder tree).
3. **Clear it first**: delete everything in `wwwroot` (including `hostingstart.html` and any older deploy). Leaving old files can mix two builds.
4. Drag `dist\appservice.zip` onto the area labelled **"Drag here to upload and unzip"**. Kudu uploads and extracts into the current folder. Wait for the progress to finish (the zip is large).
5. Restart the app (Overview > Restart) and watch Log stream.

**Route B: `az webapp deploy`** (Azure CLI 2.60+, see step 0 for the login):

```powershell
az webapp deploy --resource-group rg-family-recipes --name family-recipes-dean --src-path dist\appservice.zip --type zip
```

This goes through Kudu's zip-deploy pipeline. Since the D2 fix the zip is built so that Oryx has nothing to build (section 6), but route A is the one proven end to end; use route B only with Azure CLI 2.60+.

Redeploying replaces wwwroot but **not** `/home/data`. Keep the previous zip (rename with date/commit) to roll back.

## 6. Pitfalls that cost time

- **Kudu/Oryx rebuild** (fixed by lane D2, `scripts/package-appservice.ps1` step 3b): Oryx used to find the root `package.json` with a build script and run `npm install` + `npm run build` (failing with "turbo: not found" or replacing the standalone output). The script now rewrites the zip's root and `apps/web` `package.json` to minimal start-only manifests (`node apps/web/server.js`), removes lockfiles, `pnpm-workspace.yaml`, `turbo.json` and `.npmrc`, and adds a `.deployment` file with `SCM_DO_BUILD_DURING_DEPLOYMENT=false`. Keep it that way; also keep the two app settings, clear wwwroot before a drag-and-drop upload, and confirm `apps/web/server.js` sits directly under wwwroot afterwards.
- **Unique default hostname**: not `<name>.azurewebsites.net`. Old `az` versions fail against it with `WSAECONNRESET`: update the CLI.
- **`NEXT_PUBLIC_*` baked at build time**: changing a Supabase URL/key or the hostname needs a rebuilt zip, not just an app setting.
- **sharp on Linux**: the zip must contain `node_modules/@img/sharp-linux-x64` and `sharp-libvips-linux-x64` (the script verifies and fails loudly). Symptom otherwise: `Could not load the "sharp" module using the linux-x64 runtime` when importing a photo.
- **Quota**: see section 2 step 3.
- **Cost**: B1 is billed while the plan exists even if the app is stopped; delete the resource group `rg-family-recipes` when finished testing.

## 7. Post-deploy smoke checklist

`<host>` as above.

- [ ] `curl https://<host>/api/health` returns 200 `{"status":"ok","version":"0.0.0","commit":"<sha>"}` and no secrets. (503 `degraded`, or 500 on every page: read the Log stream for the "Invalid production configuration" list.)
- [ ] `curl -I https://<host>/` redirects (307/302) to `/sign-in?next=%2F`, not 200 and not a "mock auth" banner.
- [ ] `/sign-in` response headers include `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and no `X-Powered-By`.
- [ ] `curl -I http://<host>/` redirects to https.
- [ ] `https://<host>/sign-up` renders styled in a browser with DevTools open and no CSP violations in the Console.
- [ ] Sign up, receive the confirmation email, click it, land signed in.
- [ ] Create a household, add a recipe by hand, reload: still there (Supabase backend through RLS).
- [ ] Settings: AI provider shows the real provider (not "Sample data"), or add the key here. Import a recipe photo: extraction works and the cover image shows (this exercises sharp on Linux and Supabase Storage: the image URL is `/api/images/...` and redirects to a `.../storage/v1/object/sign/recipe-images/...` signed URL; the receipt flow likewise shows "View the receipt photo"). Run the cleanup endpoint once with `curl` (section 4b) and expect `{"ok":true,...}`.
- [ ] Planner: ask for a plan, review the chips, propose, approve; generate the shopping list; open it in a second browser and see an item change appear (Realtime).
- [ ] Restart the app: `/api/health` returns, you are still signed in, the cover photo is still served, shopping lists are still there (they are in Supabase).
- [ ] Log stream shows no stack traces or secrets.

## 8. Updating, rolling back, troubleshooting

- Update: rebuild the zip (section 1) then redeploy (section 5).
- Every page shows "This site is not configured yet" (503), or the Azure health check fails: open `https://<host>/api/health`. It returns 503 JSON `{status:"misconfigured", problems:[...]}` naming each bad setting (names and guidance only, never values); the same lines are logged as `[config] ...` in the Log stream. Fix the settings and Apply. A "differs between the build and the App Service setting" problem means a NEXT_PUBLIC_* value changed after the zip was built: rebuild the zip. (Note: `SUPABASE_SERVICE_ROLE_KEY` is not read by any production code path today, so it is not validated.)
- 502 / "application error" right after deploy: check the Log stream for the port and for Oryx output; the start command must be exactly `node apps/web/server.js` and `HOSTNAME=0.0.0.0`; raise `WEBSITES_CONTAINER_START_TIME_LIMIT` if the container is killed during first start.
- Rotating `APP_SECRET`, the service role key or an AI key: change the app setting and restart (`security/OPS-RUNBOOK.md` section 6). Rotating `APP_SECRET` means re-entering AI keys in Settings.
- Email links (sign-up confirmation, password reset) redirect to `https://<container-id>:8080/...`: App Service sets `HOSTNAME` to the container id and the app sits behind a reverse proxy, so `request.url`, `nextUrl.origin` and the Host header carry the INTERNAL host. All absolute URLs and redirects are built by `publicOrigin()` (`apps/web/lib/server/site-url.ts`), which uses `NEXT_PUBLIC_SITE_URL` (baked at build: rebuild the zip if it changes; must be https in production) and only trusts forwarded headers for localhost dev. Never build redirects from `request.url`. Also set the Supabase Auth Site URL / redirect allow-list to the public URL (section 4).
- "That link has expired or was already used" / `#error=access_denied&error_code=otp_expired` right after clicking a confirmation email: email security scanners (corporate gateways, some mail providers) open one-time links automatically and consume them, so the user's own click fails. The account is usually already confirmed: try signing in, or use "Resend confirmation email" on the sign-in page. Supabase reports this in the URL hash, so the sign-in page reads it client-side.
