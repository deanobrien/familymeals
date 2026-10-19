# @fr/mobile (Android, Expo SDK 58)

Mock data by default; Supabase when `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` are set (see `.env.example`; anon values only, never a service-role or AI key).

- `pnpm --filter @fr/mobile test` (jest-expo), `pnpm --filter @fr/mobile exec expo export --platform android` (bundle check; delete `dist/` after), `pnpm --filter @fr/mobile start` (Expo dev server, needs a device/emulator).
- Data: `src/data/DataSource.ts` (interface), `mockDataSource.ts`, `supabaseDataSource.ts` (supabase-js + `@fr/engine/shopping` offline client), `offlineQueue.ts` (AsyncStorage), `createDataSource.ts` (env switch). Decisions D70-D76 in `DECISIONS.md`.
- Import: `src/lib/importApi.ts` posts photos to the web app (`EXPO_PUBLIC_API_BASE_URL` + `/api/extract`, `/api/extract/save`) with the Supabase access token as a Bearer header.

## Server change needed for photo import

`apps/web/app/api/extract` and `/save` currently have no authentication and use the in-memory recipe store. For the phone to use a deployed web app they must: verify `Authorization: Bearer <token>` (`supabase.auth.getUser(token)`), read the multipart `householdId` and check household membership, and save through a Supabase-backed `RecipeSink`. The app already sends all three pieces.

## Needs a device or a live Supabase to verify

- Camera capture, photo picker, rotate (native modules; jest mocks them).
- SecureStore session persistence, NetInfo transitions (airplane mode), foreground resync, TalkBack and dark mode on a real Android device.
- Real `record_purchase` / `void_purchase` / RLS behaviour (tests use a fake client that mirrors migration 0013), including `needs_engine_outstanding` and grace-period read-only households.
- End-to-end photo import (needs the server change above and an AI provider key on the web server).
