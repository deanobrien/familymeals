# DEPLOY-APP-SERVICE.md

First test deploy of Family Recipes (`apps/web`) to Azure App Service: Linux, Node 22 LTS, B1 plan, UK South, in your own subscription. Decisions: D150-D154 in `DECISIONS.md`. Nothing here is run by the build: you create the Azure resources in the portal and run the deploy command yourself.

**This is a test deploy, not production.** Until the Supabase-backed stores land: AI provider settings and uploaded photos are files under `/home/data` (needs `ALLOW_LOCAL_FILE_STORE=true`), and shopping, receipts, price observations and the planner household profile are in memory (lost on every restart / redeploy). Recipes, plans and pantry go to Supabase when `DATA_BACKEND=supabase`.

## 0. Before you start

- A Supabase project (London, eu-west-2) with all `supabase/migrations/*.sql` applied (`pnpm exec supabase link` then `pnpm exec supabase db push`, or paste them into the SQL editor in order). Note the project URL, the anon (publishable) key and the service role key (Project settings, API).
- An Anthropic API key (or enter provider keys later in the app's Settings screen).
- Node 22 or 24 and pnpm on your Windows machine (Node 24 builds fine; the server runs on Node 22).
- Generate an `APP_SECRET`: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep it in your password manager. **If it changes, stored AI keys become unreadable** (you re-enter them).

## 1. Build the package (Windows, no admin rights needed)

```powershell
cd C:\TFS\FamilyRecipes            # your checkout of this branch
$env:NEXT_PUBLIC_SUPABASE_URL = 'https://<project-ref>.supabase.co'
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY = '<anon key>'
powershell -ExecutionPolicy Bypass -File scripts\package-appservice.ps1
```

Output: `dist\appservice.zip`. The two `NEXT_PUBLIC_*` values are public, but they are **baked into the build** (browser bundle, middleware, CSP `connect-src`): rebuild the zip after changing them. The script can instead read them from `apps\web\.env.production.local` (git-ignored). Never put secrets in the zip.

What the script does: copies the tree to `%TEMP%\fr-appservice-build` (symlink-free hoisted install, Windows cannot create symlinks without Developer Mode), builds Next in `standalone` mode, adds `.next/static` and `public`, makes sure the **linux-x64 sharp** binaries are inside, and zips with forward-slash entries. Start command inside the zip: `node apps/web/server.js`.

## 2. Create the Azure resources (portal)

1. **Resource group**: Create a resource, Resource group. Name `rg-family-recipes`, Region **UK South**.
2. **Web App**: Create a resource, Web App.
   - Resource group `rg-family-recipes`; Name `<unique-name>` (becomes `https://<unique-name>.azurewebsites.net`).
   - **Publish: Code**. **Runtime stack: Node 22 LTS**. **Operating System: Linux**. **Region: UK South**.
   - Pricing plan: create new Linux plan, **Basic B1** (Always On needs Basic or higher).
   - Deployment tab: leave GitHub Actions / continuous deployment **disabled**. Networking: public access **On** (defaults). Monitoring: Application Insights optional (leave off for the first test).
   - Review + create.
3. Wait for deployment, open the Web App.

## 3. Configure (Settings, then Environment variables / Configuration)

### 3a. Application settings

Add each as an App setting (name, value). **Secret** = mark as a secret / do not paste into chat, tickets or git. Click Apply, then Confirm (this restarts the app).

| Name | Value | Where the value comes from | Secret |
|---|---|---|---|
| `NODE_ENV` | `production` | fixed | no |
| `HOSTNAME` | `0.0.0.0` | fixed (makes the Next server listen on all interfaces; App Service sets `PORT` itself and the server honours it) | no |
| `SCM_DO_BUILD_DURING_DEPLOYMENT` | `false` | fixed (the zip is pre-built; stops Kudu running npm) | no |
| `ENABLE_ORYX_BUILD` | `false` | fixed (set together with the row above; the zip is pre-built and also carries a `.deployment` file and a build-script-free root package.json, so Oryx never runs `npm install` / `npm run build`) | no |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<project-ref>.supabase.co` | Supabase, Project settings, API | no (public) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon / publishable key | Supabase, Project settings, API | no (public, RLS protects data) |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key | Supabase, Project settings, API. Server-only, bypasses RLS | **yes** |
| `DATA_BACKEND` | `supabase` | fixed (startup refuses anything else in production) | no |
| `APP_SECRET` | 32+ random chars | you generated it in step 0 | **yes** |
| `NEXT_PUBLIC_SITE_URL` | `https://<unique-name>.azurewebsites.net` | your Web App's default domain (no trailing slash); used in emailed and invite links | no |
| `ALLOW_LOCAL_FILE_STORE` | `true` | fixed, first test deploy only (see the warning at the top; remove once the Supabase stores land) | no |
| `APP_DATA_DIR` | `/home/data` | fixed (persists across restarts and deploys; do not use the wwwroot folder) | no |
| `AI_PROVIDER` | `anthropic` | choose; never `mock` (startup refuses it) | no |
| `ANTHROPIC_API_KEY` | `sk-ant-...` | Anthropic console. Skip this row if you will enter the key in the app's Settings screen instead | **yes** |
| `AI_MODEL_TEXT`, `AI_MODEL_VISION` | model ids | optional overrides, otherwise the built-in defaults | no |

Do **not** set: `AI_ALLOW_MOCK_IN_PRODUCTION`, `SUPABASE_DATA_CONTEXT`, `SUPABASE_DEFAULT_*`, `SUPABASE_URL`/`SUPABASE_ANON_KEY` (dev fallbacks). If a required setting is missing or a forbidden one is set, every request returns 500 and the Log stream shows "Invalid production configuration" with the exact reasons (fix the settings, Apply). `HOSTNAME=0.0.0.0` matters: without it Next builds redirects against localhost.

Optional hardening: store the secrets as Key Vault references (`@Microsoft.KeyVault(SecretUri=...)`) instead of plain settings.

### 3b. General settings (Settings, Configuration, General settings)

- **Stack settings**: Node 22 LTS (already chosen).
- **Startup Command**: `node apps/web/server.js`
- **Always On**: On.
- **HTTPS Only**: On (Settings, Configuration or TLS/SSL settings). Minimum TLS 1.2.
- **HTTP version / Web sockets**: defaults (Supabase Realtime is browser to Supabase, not through this app).
- **ARR affinity**: Off (the app is stateless apart from Supabase cookies; one B1 instance anyway).
- **FTP state**: FTPS only or Disabled.
- **Health check** (Monitoring, Health check): Enable, path **`/api/health`**. Save.
- **Logging** (Monitoring, App Service logs): Application logging **File System**, level Information. Then use **Log stream** to watch startup.

## 4. Supabase Auth URL configuration

Supabase dashboard, Authentication, URL Configuration:

- **Site URL**: `https://<unique-name>.azurewebsites.net`
- **Redirect URLs**: add `https://<unique-name>.azurewebsites.net/auth/callback`. If emailed confirmation or reset links land on the Site URL instead of `/auth/callback` (the app appends `?next=...`), also add `https://<unique-name>.azurewebsites.net/auth/callback?*` (still no wildcard host, no wildcard on the path).
- Keep `http://localhost:3100/auth/callback` only on your dev/staging project, not here.
- Check the SECURITY-CHECKLIST section 3 items (email confirmation on, leaked-password protection, min length 10, refresh-token rotation, custom SMTP before inviting real users: the built-in Supabase mailer is rate limited).

## 5. Deploy the zip

Either from a terminal (sign in with your own account; this only uploads the zip to your Web App):

```powershell
az login
az webapp deploy --resource-group rg-family-recipes --name <unique-name> --src-path dist\appservice.zip --type zip
```

or in the portal: Deployment Center, **Zip Deploy / Publish** (Kudu: `https://<unique-name>.scm.azurewebsites.net/ZipDeployUI`, drag `dist\appservice.zip` onto the `/home/site/wwwroot` area), or Advanced Tools (Kudu), Tools, Zip Push Deploy.

**Kudu drag-and-drop path:** open Kudu (`https://<hostname>.scm.<region>-01.azurewebsites.net/`), Debug console, CMD or Bash, go to `/home/site/wwwroot`, **delete everything in it first**, then drag `dist\appservice.zip` onto the "Drag here to upload and unzip" area at the top of the file listing (it unzips into the current folder, `/home/site/wwwroot`). Confirm `apps/web/server.js` sits directly under wwwroot.

**Unique default hostname:** new Web Apps get `<name>-<hash>.<region>-01.azurewebsites.net` (not `<name>.azurewebsites.net`); use that exact hostname (and the matching `.scm.` host) everywhere, including `NEXT_PUBLIC_SITE_URL` and the Supabase URLs. Old `az` CLI versions fail `az webapp deploy` with `WSAECONNRESET` because they target `<name>.scm.azurewebsites.net`, which does not resolve for these apps; upgrade the CLI or use the Kudu upload above.
The first start takes a minute or two (the container extracts the zip, starts Node). Watch Monitoring, Log stream. Redeploying replaces wwwroot but **not** `/home/data`.

## 6. Post-deploy smoke checklist

Replace `<host>` with `<unique-name>.azurewebsites.net`.

- [ ] `curl https://<host>/api/health` returns 200 `{"status":"ok","version":"0.0.0","commit":"<sha>"}` and no secrets. (503 `degraded`, or 500 on every page: read the Log stream for the "Invalid production configuration" list.)
- [ ] `curl -I https://<host>/` shows 307/302 to `/sign-in?next=%2F` (signed-out users are gated), not 200 and not a "mock auth" banner.
- [ ] Response headers on `/sign-in` include `Content-Security-Policy`, `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, and **no** `X-Powered-By`.
- [ ] `curl -I http://<host>/` redirects to https (HTTPS Only).
- [ ] Open `https://<host>/sign-up` in a browser with DevTools open: the page renders styled (static files served), the Console shows **no CSP violations**.
- [ ] Sign up, receive the confirmation email, click it, land signed in (Supabase redirect URLs correct, `NEXT_PUBLIC_SITE_URL` correct).
- [ ] Create a household, add a recipe by hand, reload: it is still there (Supabase backend working through RLS).
- [ ] Settings: AI provider shows Anthropic (not "Sample data"), or add the key here. Import a recipe photo: extraction works and the cover image shows (this exercises **sharp on Linux** and `/home/data/uploads`). If you get an image-processing error, the linux sharp binary is missing: rebuild the zip with the script.
- [ ] Planner: ask for a plan, review the chips, propose, approve.
- [ ] Restart the app (Overview, Restart): `/api/health` returns, you are still signed in, the photo is still served, and (expected) shopping lists are empty again.
- [ ] Log stream shows no stack traces or secrets while doing the above.

## 7. Updating, rolling back, troubleshooting

- Update: re-run the package script, then the deploy command. Keep the previous `dist\appservice.zip` (rename it with the version/date) to roll back.
- Changing a `NEXT_PUBLIC_*` value, the Supabase project or the CSP means a rebuild; changing any other app setting only needs a restart.
- 500 on every request with "Invalid production configuration" in the log: fix the listed settings, Apply.
- `Cannot find module 'sharp'` / `Could not load the "sharp" module using the linux-x64 runtime`: the zip lacks `node_modules/@img/sharp-linux-x64` or `sharp-libvips-linux-x64`; rebuild with the script (it fails loudly if they are missing).
- 502 or "application error" right after deploy: check the Log stream for the port; the start command must be exactly `node apps/web/server.js` and `HOSTNAME=0.0.0.0`.
- Rotate `APP_SECRET`, the service role key or the Anthropic key per `OPS-RUNBOOK.md` section 6 (secret leak): change the App setting, restart. Rotating `APP_SECRET` means re-entering AI keys in Settings.
- Cost: B1 is billed while the plan exists even if the app is stopped; delete the resource group `rg-family-recipes` when you are done testing.
