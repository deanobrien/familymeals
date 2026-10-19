NEXT_PUBLIC_* values are compiled into the build (browser bundle, middleware, CSP): rebuild the zip when they change.

Setting them only as App Service app settings is not enough for the client bundle and the CSP connect-src, which are generated at `next build`. They are public values (Supabase URL, anon key, site URL), loaded by the packaging script from the environment or apps/web/.env.production.local. The owner keeps them in an untracked .env.cloud. Production startup still checks them at runtime and says so in the log (`lib/server/config/production.ts`).
