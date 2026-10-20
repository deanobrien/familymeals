> **Hosting note:** these documents were written before the hosting decision and say "Vercel" in places. The app actually runs on **Azure App Service** (Linux, Node 22; see `docs/DEPLOY-APP-SERVICE.md`); read "Vercel env vars" as "App Service application settings" and "Vercel logs/rollback" as "App Service log stream / redeploying the previous `appservice.zip`". The Supabase, RLS, privacy and AI-gateway content applies unchanged. Several controls are **designed but not yet built** (AI budgets, general rate limits; export and deletion ARE built since DX1, D250-D259, see DATA-EXPORT-DELETION.md "Status"): check `docs/ROADMAP.md` before assuming a control exists.

# OPS-RUNBOOK.md

Assumes Vercel (Next.js) + Supabase (London) + Anthropic API. Hosting/repo host are still owner decisions (see PARALLEL-DELIVERY-PLAN); adjust names if they change.

## 1. Environments
| Env | Web | Supabase | AI | Purpose |
|---|---|---|---|---|
| local | `pnpm dev` | Supabase CLI local stack (Docker) or dev project | **Mock provider** (`AI_PROVIDER=mock`) | Development, CI |
| preview | Vercel preview per PR | shared `staging` project (never prod) | real Claude, low caps, separate key | Review, E2E |
| staging | Vercel `staging` branch/domain | `family-staging` (London) | real, separate key + spend limit | Pre-release rehearsal, migration dry-run, restore drill |
| production | Vercel prod | `family-prod` (London, paid plan for PITR) | real, prod key, spend limit/alerts | Live |

Rules: no prod data in lower envs (use seeded fixtures); each env has own keys; env var inventory kept in `.env.example` (names only); production access via named accounts with MFA.

## 2. Migrations workflow
1. Create: `supabase migration new <lane>_<what>` -> timestamped SQL in `packages/db/migrations`. Never edit applied migrations; forward-only fixes.
2. Each migration: RLS on new tables, policies, indexes, rollback notes in a comment (expand/contract pattern for destructive changes).
3. Local: `supabase db reset` (applies all + seed) and run `tests/rls` + unit tests. Regenerate types (`supabase gen types typescript`), commit.
4. CI: apply to a throwaway DB, run lint (RLS enabled, no `using (true)`), tests.
5. Staging: `supabase db push` (linked staging project); smoke test.
6. Production: apply **before** deploying app code that needs it (expand step), after a fresh on-demand backup. Destructive "contract" migrations only one release later.
7. Record in release notes: migration names, risk, rollback plan.
Avoid long locks: `create index concurrently` (outside transaction), batch backfills.

## 3. Backups, PITR and restore drill
- Supabase daily backups + **PITR enabled in prod** (retention 7 days; keep minimal per DATA-EXPORT-DELETION section 5). Storage objects are **not** covered by DB PITR: schedule a weekly copy of buckets (`rclone`/script via S3 API) to a separate private store in the UK/EU with 30-day retention, or accept and document loss window.
- Targets: RPO <= 15 min (PITR), RTO <= 4 h.
- **Restore drill (quarterly and before launch), on staging:**
  1. Note timestamp T. Create a marker row.
  2. Restore staging to T-10 min (PITR) or restore a daily backup into a new project.
  3. Verify: row counts for key tables, marker row state, RLS tests pass, auth users sign in, storage object links resolve.
  4. **Replay deletion ledger** so purged households/users stay deleted (DX1, D257). The ledger is restored WITH the database, so it only knows purges up to the restore point:
     a. BEFORE restoring, export the live ledger (SQL editor / psql): `\copy (select * from public.deletion_ledger) to 'ledger-YYYYMMDD.csv' csv header` (private; delete within 14 days).
     b. Restore.
     c. Load the CSV into a temp table `tmp_ledger` and add missing rows: `insert into public.deletion_ledger select * from tmp_ledger t where not exists (select 1 from public.deletion_ledger l where l.id = t.id);`
     d. Call the purge job (`POST /api/jobs/purge` with `x-jobs-secret`, DEPLOY-APP-SERVICE.md 3c). `jobs_purge_due` re-purges every existing household the ledger marks purged (`households.replayed`) and accounts the ledger marks deleted are deleted from Auth again (`accounts.replayed`); queued storage objects are removed by the same run (ST1's cleanup). Repeat until both replay counts are 0.
     e. If the live DB is gone (no step a), use the newest weekly ledger export: schedule `deletion_ledger` CSV exports alongside the bucket copies above.
  5. Re-point app env vars (URL, keys, JWT secret caveats) and run the E2E smoke suite.
  6. Record duration, issues, and fixes in `docs/restore-drills.md`.
- Before risky migrations: trigger on-demand backup and note its id.

## 4. Deployment steps (production)
Pre-flight: main green (lint, types, unit, RLS, E2E); SECURITY-CHECKLIST items for changes reviewed; migrations reviewed.
1. Tag release `vX.Y.Z`; confirm Vercel preview of the commit passes E2E.
2. Backup (on-demand) in Supabase.
3. Apply migrations to prod (`supabase db push --linked`), watch for errors.
4. Promote the Vercel deployment (or merge to `main` for auto-deploy). Function region `lhr1`.
5. Smoke test (manual, 5 min): sign in; open library; open a recipe with image; add shopping item; second session sees it in realtime; mock/real extraction on a test image; export button reachable; response headers (CSP/HSTS) present.
6. Watch logs/error monitoring for 30 min; check AI usage dashboard.
7. Rollback: Vercel "Instant Rollback" to previous deployment (app); migrations are forward-only, so ship a compensating migration (expand/contract keeps old code compatible). If data corruption: PITR restore per section 3 (with team agreement; this loses writes after T).
Feature flags (env) for AI features: `AI_ENABLED`, per-feature toggles for quick disable.

## 5. Monitoring and alerts
- Purge job (DX1): alert on failed Logic App runs. The response `status` reports `cleanupPending`, `cleanupStuck` (rows that failed 8 attempts: investigate `storage_cleanup_queue.last_error`; ST1 section 4b), `cleanupOldestMinutes` (alert if > 60), `householdsPendingDeletion`, `accountsPendingDeletion`; `accounts.blocked` > 0 means a requested account still owns a shared household or a cancelled sole household.
- Uptime check on `/api/health` (checks DB connectivity, no secrets) every 1 min.
- Error monitoring (scrubbed), Vercel function error rate/latency, Supabase dashboard (CPU, connections, disk, egress).
- Alerts: 5xx rate > 2% for 5 min; DB disk > 80%; auth failure spike; storage cleanup queue age > 1 h; AI spend threshold (below).

## 6. Incident basics
1. **Detect/declare:** anyone raises in the incident channel; assign Incident Lead; note start time.
2. **Triage severity:** SEV1 data exposure/outage of core flow; SEV2 degraded feature (e.g. AI down); SEV3 minor.
3. **Contain:** kill switches first (`AI_ENABLED=false`, maintenance mode env, revoke/rotate keys, disable signups, disable Realtime if leaking). Rollback deployment if regression.
4. **Preserve evidence:** export relevant logs/audit rows before they expire; do not delete data.
5. **Fix and verify;** restore service; post status to users if impacted.
6. **Personal data breach:** assess within hours. If likely risk to individuals, **report to the ICO within 72 hours of becoming aware** (ico.org.uk/report-a-breach); notify affected users without undue delay if high risk. Keep a breach log even if not reportable.
7. **Secret leak:** rotate immediately (Anthropic key, Supabase service role/JWT secret, SMTP, cron secret), redeploy, review usage logs for abuse.
8. **Post-incident:** blameless review in 5 working days; add tests/alerts; update THREAT-MODEL and this runbook.
Contacts table (fill in): owner, backup, Supabase support, Vercel support, ICO.

## 7. AI cost monitoring
- Source of truth: `ai_usage` table (household_id, operation, model, input/output tokens, estimated cost, status, created_at), plus Anthropic console usage.
- Controls: per-household daily/monthly caps; global monthly budget (`AI_MONTHLY_BUDGET_GBP`) checked before each call; model routing (vision model only for extraction/receipts, cheaper model for tagging/constraint parsing); image downscale before send; cache identical requests (hash of image) for a short period; mock provider outside prod.
- Anthropic: set a **workspace spend limit** and email alerts at 50/80/100% of budget; separate key per environment.
- Review: weekly query of cost per operation, per household (top 10), error/retry rate, tokens per call p95. Example:
```sql
select date_trunc('day', created_at) d, operation, model,
       count(*) calls, sum(input_tokens) in_tok, sum(output_tokens) out_tok, sum(cost_estimate) cost
from ai_usage where created_at > now() - interval '30 days'
group by 1,2,3 order by 1 desc, cost desc;
```
- Anomaly alerts: daily spend > 3x 7-day average, or a single household > 20% of daily spend -> investigate, throttle, contact user.
- Also watch Supabase (storage GB, egress) and Vercel (function duration, bandwidth) monthly; stay inside plan limits; image re-encoding keeps storage small.

## 8. Routine tasks
| Cadence | Task |
|---|---|
| Weekly | Review AI spend, dependency audit results, advisor warnings, storage cleanup queue |
| Monthly | Rotate/verify cron secrets if policy requires; review access list (Vercel, Supabase, Anthropic); prune expired invitations/exports |
| Quarterly | Restore drill; review sub-processors and DPAs; re-run threat-model review; test incident process |
| Per release | Section 4; update changelog and docs |
