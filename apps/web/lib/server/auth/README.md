# Auth and household (lane L11)

Cookie-based Supabase auth via `@supabase/ssr`. Middleware (`apps/web/middleware.ts`) refreshes the session and
redirects signed-out users to `/sign-in?next=...` (401 JSON for `/api/**`). Public: `/privacy`, `/sign-in`, `/sign-up`,
`/forgot-password`, `/reset-password`, `/auth/*`, `/invite/*` (see `routes.ts`). Machine endpoints (cron/webhooks) must be
added to `PUBLIC_API_PREFIXES` and verify their own secret.

## Env

| Var | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | server + browser | safe to expose (RLS is the authority) |
| `SUPABASE_SERVICE_ROLE_KEY` | `lib/server/auth/admin.ts` only (`server-only`) | bypasses RLS; re-check membership before use |
| `NEXT_PUBLIC_SITE_URL` | optional | origin for emailed/invite links; defaults to the request host |

Modes (`lib/supabase/env.ts`): `supabase` (env present), `mock` (env missing, NODE_ENV != production: banner, all pages
open as a fixed mock user, `ctx.supabase` throws on use), `unconfigured` (env missing in production: mock REFUSED, protected
routes 503).

Mock mode is the local demo (D35): user Alice Smith (`MOCK_USER_ID`) in household A `The Smiths (A)` (`MOCK_HOUSEHOLD_ID`, the QA
fixture household), bannered on every page by the root layout. Dev/test only: an `fr_household=e2e-<id>` cookie selects an
isolated, empty sandbox household (e2e isolation); other values are ignored. App lanes should normally use
`getAppContext()` from `lib/server/context.ts` (household id, user id, readOnly) rather than this module directly.

## API for other lanes (server only)

```ts
import { requireHouseholdContext, getHouseholdContext, getSessionUser, assertWritable }
  from '@/lib/server/auth/household-context'; // or relative path; no path alias is configured

const ctx = await requireHouseholdContext(); // redirects: signed out -> /sign-in, no household -> /household/new
ctx.user        // { id, email | null }
ctx.household   // { id, name, status: 'active' | 'pending_deletion', role, defaultServings, weeklyBudgetPence, joinedAt }
ctx.role        // 'owner' | 'member'   ctx.isOwner
ctx.readOnly    // household pending deletion: DB refuses writes (owner decision D); hide/disable write UI
ctx.memberships // all active memberships (switcher)
ctx.supabase    // USER-scoped client, RLS applies. Use this by default.
ctx.mode        // 'supabase' | 'mock'
```

- `getHouseholdContext()` returns `null` when signed out or when the user has no household; `requireHouseholdContext()` redirects instead.
- Active household = `fr_household` httpOnly cookie, validated against the user's memberships on every request (an unknown id falls back to the oldest membership). Never take `household_id` from client input for authorisation; use `ctx.household.id`.
- Server actions: call `requireHouseholdContext()` first; call `assertWritable(ctx)` for writes if you want a clean error before the DB guard.
- Browser client: `lib/supabase/browser.ts` (`createSupabaseBrowserClient`), e.g. for Realtime.
- `getSessionUser()` / `getAuthState()` are `React.cache`d per request.

## Rules

- Never log tokens, emails or raw provider errors. Errors are mapped to whitelisted codes (`errors.ts`) and shown via fixed messages.
- Invite tokens: 64 hex, shown once to the owner in the action response (never in a URL), only the sha256 is stored.
- Post-auth redirects go through `safeNextPath()` (same-origin relative paths only).
- Passwords: min 10 chars (also set Supabase Auth min length 10 + leaked-password protection in the project settings).

## Tests

`auth.test.ts` (helpers, mapping, service with a fake client), `invitations.pglite.test.ts` (real migrations on PGlite:
invite/accept/expiry/revoke/leave/ownership transfer/grace-period). E2E: `e2e/specs/auth.spec.ts`.
