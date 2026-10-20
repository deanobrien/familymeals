# @fr/mobile (Android, Expo SDK 58)

Mock data by default; Supabase when `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set (see `.env.example`; anon values only, never a service-role or AI key).

- `pnpm --filter @fr/mobile test` (jest-expo), `pnpm --filter @fr/mobile exec expo export --platform android` (bundle check; delete `dist/` after), `pnpm --filter @fr/mobile start` (Expo dev server, needs a device/emulator).
- Data: `src/data/DataSource.ts` (interface), `mockDataSource.ts`, `supabaseDataSource.ts` (supabase-js + `@fr/engine/shopping` offline client), `shoppingMapping.ts` (DB rows -> engine state/log), `liveFeed.ts` (Realtime hint feed), `offlineQueue.ts` (AsyncStorage), `createDataSource.ts` (env switch). Decisions D70-D76, D210-D215 in `DECISIONS.md`.
- Import: `src/lib/importApi.ts` posts photos to the web app (`EXPO_PUBLIC_API_BASE_URL` + `/api/extract`, `/api/extract/save`) with the Supabase access token as a Bearer header. Barcode lookup: `src/lib/productApi.ts` (`/api/products/<barcode>`).

## Server-backed features (D340-D347)

Planner, pantry, pantry scan (photos and continuous barcodes), receipts, the shopping lists sheet and handwritten list scan call the web app's JSON API with the Supabase access token (`src/lib/serverApi.ts`, `src/data/ServerApiContext.tsx`; per-feature clients `planApi`, `pantryApi`, `pantryScanApi`, `receiptsApi`, `shoppingListsApi`, `listScanApi`). They need `EXPO_PUBLIC_API_BASE_URL` and Supabase sign-in; in mock mode the screens say so. Bottom tabs: Recipes, Shopping, Capture, More (planner, pantry, scan, receipts, list scan, households). Tests use a fake `ServerApi` via `ServerApiProvider`. Needs a real device: camera/photo flows, haptics and keep-awake while scanning barcodes, authenticated receipt photo display, TalkBack.

## Shopping sync (D210, D211)

The shared list uses the same model as the web Supabase repository:

- **Cursor** = `shopping_command_log.list_seq` (per list, gap-free, assigned in commit order). Never the global `seq`.
- **Snapshot** = the `shopping_list_snapshot(p_household_id)` RPC (items with engine state, purchase events and the command log in one statement), so the cursor (`head`) and the rows always agree.
- **Catch-up** = `shopping_command_log` where `list_seq > cursor` for the active list; a different active list, a gap, an unmappable entry or a divergent replay falls back to one fresh snapshot.
- **Live updates** = a Realtime subscription (INSERT on `shopping_command_log` for the household) is only a hint: it makes the open list re-read. A catch-up also runs once the server has CONFIRMED the subscription, and a 20 s poll runs only while the feed is down.
- **Persistence** (AsyncStorage, keys `fr.shopping.v2.*`): the queued commands per household, the active list pointer per household and, per list, the confirmed state together with its `list_seq` cursor. A cold start resumes from that cursor instead of re-reading everything; offline it shows the cached list with the queued ticks applied.

## Build an installable Android APK (owner steps)

Nothing below has been run for you: `eas build` and the Expo login need your accounts.

1. **Accounts and tools**: a free Expo account (https://expo.dev/signup). Install the CLI once: `npm install -g eas-cli` (or run `npx eas-cli@latest <command>`).
2. **Log in and link the project** (from the repo root, once):
   ```
   cd apps/mobile
   eas login
   eas init            # creates the EAS project and writes expo.extra.eas.projectId + owner into app.json; commit that change
   ```
3. **Give the build the public Supabase values.** `eas.json` already sets `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_API_BASE_URL` (the Azure web app, https). The anon key is public by design but is project-specific, so add it as an EAS environment variable (Supabase dashboard > Project Settings > API > `anon` / `public` key):
   ```
   eas env:create --name EXPO_PUBLIC_SUPABASE_ANON_KEY --value "<anon key>" --environment preview --visibility plaintext
   ```
   Never put the service-role key or an AI key in an `EXPO_PUBLIC_*` variable: everything `EXPO_PUBLIC_*` is readable inside the APK.
4. **Build the APK** (cloud build, 10-20 minutes, free tier queues are slower):
   ```
   eas build -p android --profile preview
   ```
   Answer `Y` if asked to generate a new Android keystore (EAS stores it; do not lose access to the Expo account, it is the only copy). When it finishes, the CLI prints a build page and a QR code / download link for the `.apk`.
5. **Install on the phone**: open the link (or scan the QR) on the phone, download the `.apk`, and allow "Install unknown apps" for the browser/Files app when Android asks. Then open **Family Recipes** and sign in with an account that already exists on the hosted project (the app has password sign-in only; create the account and household on the web first).
6. **Hosted project prerequisites** (otherwise sign-in or sync fails): the schema is pushed (`supabase db push --include-seed`, see `docs/HANDOVER.md` section 8), Realtime is enabled for `shopping_command_log` (migration `20261019001100_realtime.sql`), and, if you want email links to open the app, `familyrecipes://auth/callback` is in Authentication > URL Configuration > Redirect URLs.

Profiles: `preview` = internal-distribution APK (above); `production` = Play Store `.aab` (auto-incrementing version code; not needed for device testing). The package name is `uk.ac.northumbria.familyrecipes`, the deep link scheme `familyrecipes`.

Icons are placeholders (`assets/icon.png`, `adaptive-icon.png`, `splash-icon.png`, generated by `node apps/mobile/scripts/gen-placeholder-assets.mjs`); replace the three 1024x1024 PNGs with real artwork when you have it. The APK talks to https endpoints only: a build that must reach a plain-http LAN server needs cleartext traffic enabled (not configured).

## Dev testing with Expo Go over your LAN

For quick UI/logic checks without building anything (camera, picker, SecureStore and the shopping list all work in Expo Go; deep links use the `exp://` form):

1. Install **Expo Go** from Google Play on the phone. Put the phone and the computer on the same Wi-Fi (guest or "client isolation" networks block it; use a hotspot if needed).
2. Copy `.env.example` to `.env.local` and fill it in. Use the computer's LAN IP, never `localhost`/`127.0.0.1`, for anything the phone must reach:
   ```
   EXPO_PUBLIC_SUPABASE_URL=http://192.168.0.10:55421        # local Supabase (pnpm exec supabase start), or the hosted URL
   EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon key from `pnpm exec supabase status`>
   EXPO_PUBLIC_API_BASE_URL=http://192.168.0.10:3131         # pnpm dev:live (web app against the local stack), or the Azure URL
   ```
   Local Supabase listens on all interfaces; if Windows Firewall prompts for `node`/`docker`, allow it on private networks. Leave the first two empty to use the built-in mock data.
3. `pnpm --filter @fr/mobile start` and scan the QR code with Expo Go from inside Expo Go ("Scan QR code"). If the QR cannot connect, run `pnpm --filter @fr/mobile start --tunnel` (needs `@expo/ngrok`, installed on demand) or `--lan` explicitly.
4. Edit code and the app reloads. Changing `.env.local` needs `pnpm --filter @fr/mobile start --clear`.

## Verifying the web calls (D213)

`node scripts/verify-mobile-bearer.mjs http://localhost:3131` (repo root; needs `pnpm exec supabase start` and `pnpm dev:live`) signs a throw-away user in against the LOCAL stack exactly as the app does and exercises `/api/products/<barcode>`, `/api/extract` and `/api/extract/save` with `Authorization: Bearer <token>`, including the 401 / 403 cases. `pnpm --filter @fr/mobile test:live` runs `SupabaseDataSource` against the same local stack (real RPCs, RLS and Realtime). Both are opt-in and refuse non-local URLs.

## Needs a device or a live Supabase to verify

- Camera capture, photo picker, rotate (native modules; jest mocks them).
- SecureStore session persistence, NetInfo transitions (airplane mode), foreground resync, TalkBack and dark mode on a real Android device.
- The hosted project (the live checks above run against the local stack only), and an installed APK talking to it.
- End-to-end photo import with a real AI provider key on the web server (the local checks use the mock provider).
