> **Hosting note:** these documents were written before the hosting decision and say "Vercel" in places. The app actually runs on **Azure App Service** (Linux, Node 22; see `docs/DEPLOY-APP-SERVICE.md`); read "Vercel env vars" as "App Service application settings" and "Vercel logs/rollback" as "App Service log stream / redeploying the previous `appservice.zip`". The Supabase, RLS, privacy and AI-gateway content applies unchanged. Several controls are **designed but not yet built** (AI budgets, general rate limits; export and deletion ARE built since DX1, D250-D259, see DATA-EXPORT-DELETION.md "Status"): check `docs/ROADMAP.md` before assuming a control exists.

# SECURITY-CHECKLIST.md — Pre-release

Tick every box (with link to evidence) before production go-live. Items marked [CI] should be automated.

## 1. Secrets
- [ ] `.env*` git-ignored; only `.env.example` (no real values) committed. [CI] gitleaks/trufflehog on PRs and history.
- [ ] Vercel env vars set per environment (Preview != Production); Production secrets not exposed to Preview builds.
- [ ] Only `NEXT_PUBLIC_SUPABASE_URL` and anon/publishable key are public. `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, SMTP, cron secrets are server-only. [CI] scan `.next/static` for key patterns / `service_role` JWT.
- [ ] `lib/supabase/admin.ts` and `packages/ai` import `server-only`; ESLint restricts imports.
- [ ] Separate Anthropic API key per environment with workspace spend limit set; keys rotatable (document rotation steps; rotate on staff change or leak).
- [ ] Separate Supabase projects for dev/staging/prod; no prod keys on laptops.

## 2. HTTP headers and CSP (Next.js `next.config.js` headers or middleware with nonce)
- [ ] `Content-Security-Policy` (start in Report-Only, then enforce):
  `default-src 'self'; script-src 'self' 'nonce-{n}' 'strict-dynamic'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: https://<project>.supabase.co; connect-src 'self' https://<project>.supabase.co wss://<project>.supabase.co; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests`
  (No Anthropic origin: AI is server-side only. Add Sentry host if used.)
- [ ] `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- [ ] `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` (legacy), `Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()` (camera needed for capture).
- [ ] `poweredByHeader: false`; no source maps served publicly (or uploaded to monitoring only).
- [ ] Cookies: Secure, HttpOnly (auth cookies via `@supabase/ssr`), SameSite=Lax.
- [ ] Verify with securityheaders.com / Mozilla Observatory target A. [CI] header test hitting preview URL.

## 3. Supabase settings
- [ ] Project region London (eu-west-2). [ ] DPA signed.
- [ ] **RLS enabled on every `public` table**, no `using (true)` except read-only reference data. [CI] lint + `tests/rls` matrix passes (THREAT-MODEL R3).
- [ ] Views are `security_invoker`; definer functions pin `search_path`; `anon` has no table privileges beyond what is intended (revoke default grants).
- [ ] Storage buckets private; size/MIME limits set (`image/jpeg,png,webp,heic`, 10 MB); storage RLS by household prefix tested.
- [ ] Realtime: authorization enabled / only RLS-backed tables published; no sensitive tables in publication unless required.
- [ ] Auth: email confirmation required; **leaked password protection enabled**; min password length >= 10; signups allowed only as intended; "secure email change" and "secure password change" on; JWT expiry 3600 s; refresh token rotation on; redirect URL allow-list lists exact prod/preview URLs (no wildcards on prod); MFA optional for owners (nice to have).
- [ ] Auth email templates: branded, plain, no secrets beyond link; subject/body do not reveal whether an account exists; links point at your domain `/auth/confirm?token_hash=...`; custom SMTP with SPF/DKIM/DMARC configured.
- [ ] Auth rate limits reviewed (sign-in, OTP, email send). CAPTCHA decision recorded.
- [ ] Database: no public network access beyond pooled connection needs; SSL enforced; network restrictions if plan allows; service-role key stored only in Vercel.
- [ ] PITR on (paid plan) and backup schedule confirmed (OPS-RUNBOOK).
- [ ] Supabase security advisor (linter) clean: no "RLS disabled", "function search_path mutable", "exposed auth.users view".
- [ ] Postgres extensions minimal; `statement_timeout` set for `authenticated` role.

## 4. Rate and AI usage limits
- [ ] Edge/middleware rate limiting on: auth routes, invite accept, uploads, AI routes, export, search. Return 429 + `Retry-After`.
- [ ] AI caps per household (e.g. 20 extractions/day, 30 plan prompts/day, configurable in table) enforced **before** provider call using `ai_usage`; global monthly budget kill switch (`AI_ENABLED=false`).
- [ ] `max_tokens`, max images/size per call, timeout (30-60 s), bounded retries (<= 2) with jitter; no retry on 4xx.
- [ ] Anthropic workspace spend limit + billing alert (OPS-RUNBOOK section 7).
- [ ] Upload limits (10 MB/file, 8 files, pixel cap, per-household storage cap) tested.

## 5. Input validation and app security
- [ ] Every route handler/server action validates input with zod and checks session + household membership (`requireHouseholdMember`).
- [ ] No `dangerouslySetInnerHTML` with user/AI content; markdown rendered through sanitiser.
- [ ] Redirect targets allow-listed; Origin check on mutations.
- [ ] Uploaded images re-encoded, EXIF stripped, magic bytes verified.
- [ ] AI outputs zod-validated and human-confirmed before save; prompt builders contain no household identifiers/allergy identity.
- [ ] Error responses generic (no stack traces, SQL, or table names).

## 6. Logging redaction
- [ ] Single `logger` wrapper (pino or similar) with allow-listed fields: `requestId, userId, householdId, route, status, durationMs, errorCode`.
- [ ] Redact paths: `*.email, *.token, *.password, authorization, cookie, *.prompt, *.image*, *.receipt*, *.allergies, *.dietary*, *.ingredient_text`. Never log request/response bodies or AI payloads (log token counts only).
- [ ] Sentry/monitoring `beforeSend` scrubs request bodies, cookies, headers, and user email; `sendDefaultPii: false`.
- [ ] Vercel log drains (if any) only to EU destinations; retention <= 30 days.
- [ ] [CI] test: trigger errors with fake PII and assert it is absent in captured logs.

## 7. Dependencies and supply chain
- [ ] `pnpm audit --prod` has no high/critical (or documented exceptions). [CI] on PR + weekly.
- [ ] Dependabot/Renovate enabled; lockfile committed; `pnpm install --frozen-lockfile` in CI.
- [ ] Pin Node version (`.nvmrc` / `engines`); Next.js and Supabase libs on patched versions (check advisories, notably Next.js middleware/auth-bypass CVEs: do not rely on middleware alone for authz — enforce in handlers and RLS).
- [ ] GitHub Actions pinned by SHA; minimal workflow permissions; no secrets to forked-PR workflows.
- [ ] `npm`/`pnpm` lifecycle scripts reviewed (`onlyBuiltDependencies`).
- [ ] SBOM/licence check (permissive licences; CoFID is Open Government Licence: attribution shown).

## 8. Privacy and compliance gates
- [ ] DPIA completed; ICO registration/fee; privacy notice and consent wording live (PRIVACY.md).
- [ ] Export and deletion flows pass acceptance tests (DATA-EXPORT-DELETION.md section 6).
- [ ] Sub-processor DPAs filed; Anthropic retention/training terms confirmed.
- [ ] Cookie use limited to essential; no consent banner needed (re-check if analytics added).

## 9. Final verification
- [ ] External-style review: attempt cross-household access via REST, storage, realtime with two test users (THREAT-MODEL test catalogue green).
- [ ] Manual abuse pass: oversize upload, injected-text receipt, replayed offline batch, revoked member session.
- [ ] Production env smoke test (OPS-RUNBOOK section 4), headers verified, security advisor clean.
- [ ] Incident contact and runbook in place (OPS-RUNBOOK section 6).
