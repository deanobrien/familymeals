> **Hosting note:** these documents were written before the hosting decision and say "Vercel" in places. The app actually runs on **Azure App Service** (Linux, Node 22; see `docs/DEPLOY-APP-SERVICE.md`); read "Vercel env vars" as "App Service application settings" and "Vercel logs/rollback" as "App Service log stream / redeploying the previous `appservice.zip`". The Supabase, RLS, privacy and AI-gateway content applies unchanged. Several controls are **designed but not yet built** (AI budgets, general rate limits; export and deletion ARE built since DX1, D250-D259, see DATA-EXPORT-DELETION.md "Status"): check `docs/ROADMAP.md` before assuming a control exists.

# DATA-EXPORT-DELETION.md

## Status (DX1, 2026-10-20; decisions D250-D259; migration `20261020002500_dx1_export_deletion.sql`)

Built and tested (PGlite `packages/db/tests/rls/011_dx1_export_deletion.sql`, web units in `lib/server/export|jobs`, live `e2e/live/privacy.live.spec.ts`). Where the build differs from the design below, the build wins:

- **Export**: Settings > Your data > "Export my data" (any member: rows they created + their profile, consents, favourites, ratings, and children of those rows) / "Export whole household" (owners). `POST /api/export {scope}` -> `begin_data_export` (audit row in `data_export_requests`; **1 per user, household and scope per 24 h**; failed builds do not count) -> `GET /api/export/<id>` **streams** the zip, built on demand as the signed-in user (RLS client for rows and Storage). Nothing is stored, so there is no `exports/` bucket and nothing to expire or purge (D250). Link: 1 hour, at most 5 downloads, same user only, access re-checked at download. Layout as in section 1 plus `data/prices.json`, `data/spending.json` (P2-B: manual spend entries and retailer-to-store links; receipts and prices are in purchases/prices), `data/ai_usage.json`, `data/notifications.json` (P1-C: the requester's own notification settings, preferences and notifications; push device tokens are never exported); other members' account ids become `"another member"` (yours `"you"`); no emails except your own; never AI keys, invitations or internal logs (`lib/server/export/tables.ts`). Manifest has SHA-256 checksums (not signed). Own zip writer, no ZIP64 (D251). Demo mode exports the in-memory recipe library.
- **Household deletion**: owner, typed household name + current password (re-auth, D258) -> `request_household_deletion` (end users can no longer shorten the 14 days, D252) -> read-only grace with countdown in Settings and Household -> owner cancels or the purge job purges. Member email notification is still TODO (needs the transactional email hook).
- **Account deletion**: Settings > "Delete my account" (type DELETE + password) -> `request_account_deletion` (D253): leave shared households now (refused while sole owner of a shared household); sole-member households are scheduled for deletion; the account is deleted by the job once those are purged (or at the next run). Cancel available while pending. The job anonymises purchase history (`created_by`/`voided_by` nulled, `created_by_display_name` snapshot kept or "Former member", D254) and calls `auth.admin.deleteUser` (service role, job only).
- **Purge job**: `POST /api/jobs/purge` with `x-jobs-secret: <JOBS_SECRET>` (D256): due households + deletion-ledger replay -> due accounts -> ST1's storage cleanup (`runStorageCleanup`, the same code as `/api/jobs/storage-cleanup`, D195) -> status counts. Images are read for export through ST1's `ImageStore` (D255). Replaces the `/api/internal/purge-due` and `/api/internal/storage-cleanup` routes sketched in section 3. Scheduling: DEPLOY-APP-SERVICE.md 3c (Azure Logic App recommended, D259). Restore drill: OPS-RUNBOOK section 3 step 4 (D257).
- **Schema fix**: deleting an account that had accepted an invitation used to fail (`invitations` CHECK vs `accepted_by ON DELETE SET NULL`); fixed in the DX1 migration (D253).
- **Not built yet**: weekly orphan reconciliation (ST1's 24 h stale-upload sweep covers abandoned uploads) (objects whose household no longer exists), member notification emails, a "recently deleted" soft-delete for single recipes.

Covers UK GDPR Art 15/20 (access, portability) and Art 17 (erasure). Table names below follow BRIEF §5 plus BRIEF-REVIEW additions; adjust to L1's final schema.

## 1. Export

**Trigger:** Settings -> "Export my data" (member scope) and "Export household" (owner only). Rate limit: 1 per 24 h per user.
**Flow:** `POST /api/export` creates an `export_job` row (status `queued`) -> background route (Vercel cron/queue or Supabase Edge Function) builds the archive -> stores in private bucket `exports/{user_id}/{job_id}.zip` -> emails a link to the signed-in app page (not a public link) -> signed URL valid 24 h -> object auto-deleted after 7 days. Audit-log `export_requested` / `export_downloaded`.

**Archive layout**
```
export-YYYYMMDD/
  README.txt            what is included, schema version, how to read it
  manifest.json         { schemaVersion, generatedAt, scope, counts, checksums }
  data/
    account.json        email, display name, created_at (no password hash)
    household.json      settings, members (display names + roles only; no other members' emails)
    recipes.json        recipes, steps, ingredients (original text + parsed), tags, ratings, versions
    meal_plans.json
    shopping_lists.json (items + provenance)
    purchases.json      purchase events, receipts (parsed lines)
    pantry.json
    dietary.json        only if user consented; own data only
    consents.json
  images/
    recipes/{recipe_id}/{n}.jpg
    receipts/{receipt_id}.jpg
  recipes.csv           flat convenience copy (title, servings, ingredients, method)
```
Rules: JSON UTF-8, ISO-8601 UTC timestamps, UUID references so it re-imports. Query as the requesting user (RLS client) so scope is enforced by the database; stream images into the zip (no full buffering). Exclude other members' personal data, invitation tokens, audit logs of other users, and AI usage content (none stored). Sign manifest checksums so users can verify integrity.

## 2. Deletion semantics

| Action | Effect |
|---|---|
| **Delete recipe/receipt/image** | Row + storage objects removed (soft-delete 30 days optional "recently deleted"; hard purge afterwards). Shopping/purchase history keeps ingredient text snapshots, drops the FK link. |
| **Member leaves household** | `household_member.status='left'`; access revoked immediately (RLS + Realtime). Content they created **stays with the household** (shared data; `created_by` set to null / "former member"). Their personal data (person profile, dietary info, consent records for that household, display name) is deleted. |
| **Owner leaves** | Blocked unless another active member exists: UI forces "Transfer ownership" (pick a member; confirm) first. After transfer, behaves as member leave. |
| **Last member leaves / is deleted** | Household is deleted (see below) after an explicit warning: "This deletes all recipes, plans and lists." 14-day grace (status `pending_deletion`, restorable by that user) then hard purge. |
| **Owner deletes household** | Requires typing the household name; all members notified by email; status `pending_deletion` for 14 days (only owner can cancel), then hard purge. |
| **Delete account** | If user is sole member of households -> household deletion flow. If member of others -> leave each (owner must transfer or delete). Then delete `auth.users` row, profile, consents, sessions. Audit entry kept as `user_hash` only. |

DB invariants: trigger `prevent_last_owner_removal`; every household has >= 1 active owner or is `pending_deletion`.

## 3. Hard purge implementation

### SQL
```sql
-- Household purge: cascade from household. All household-scoped tables use ON DELETE CASCADE
-- on household_id (L1 to confirm). Function is SECURITY DEFINER, service-role only.
create or replace function public.purge_household(p_household_id uuid)
returns void language plpgsql security definer set search_path = public, storage as $$
begin
  -- 1. queue storage objects for deletion BEFORE rows vanish
  insert into storage_cleanup_queue(bucket, path)
  select bucket_id, name from storage.objects
  where bucket_id in ('recipe-images','receipt-images')
    and (storage.foldername(name))[1] = p_household_id::text;
  -- 2. delete rows (cascade)
  delete from household where id = p_household_id;
  -- 3. audit (no content)
  insert into audit_log(action, subject_hash, at)
  values ('household_purged', encode(digest(p_household_id::text,'sha256'),'hex'), now());
end $$;
revoke all on function public.purge_household(uuid) from public, anon, authenticated;
```
`member_leave(p_household_id)`: security-definer, uses `auth.uid()`, sets status, nulls `created_by` only where policy requires, deletes `person_profile` and `consent_record` rows for that user, errors if sole owner with other members.

### Storage cleanup
- Never rely on cascade for objects (Storage tables are separate). Use `storage_cleanup_queue(bucket, path, attempts, done_at)`.
- Worker route `/api/internal/storage-cleanup` (cron every 10 min, secret-header protected) calls `supabase.storage.from(bucket).remove(paths)` in batches of 100 using the service role; retries with backoff; alert if queue age > 1 h.
- Also delete on single-image/recipe delete via DB trigger enqueue (`AFTER DELETE ON recipe_image`).
- Weekly reconciliation job: objects whose first path segment is not an existing household -> enqueue (catches orphans).
- Delete `exports/` objects with the user.

### Server routes
- `POST /api/export` / `GET /api/export/:id` (status + signed URL).
- `POST /api/household/:id/leave`, `POST /api/household/:id/transfer-owner`.
- `DELETE /api/household/:id` (owner; typed-name confirmation; sets `pending_deletion`, `purge_after = now()+14d`).
- `POST /api/household/:id/restore` (within grace).
- `DELETE /api/account` (re-auth required; orchestrates above; finally `auth.admin.deleteUser`).
- Cron `/api/internal/purge-due` -> `select purge_household(id) from household where status='pending_deletion' and purge_after < now()`.
All require re-authentication (password or fresh magic link < 5 min) for destructive actions, and write audit rows.

## 4. Third-party copies
- **Anthropic:** no content stored by us; rely on provider retention terms (confirm API retention window, ideally zero-retention). State this in the notice.
- **Logs/monitoring:** contain no content; expire per retention (30 days).
- **Email provider:** delivery logs contain addresses; retention per provider.

## 5. Backups interplay
- Supabase daily backups / PITR retain deleted data until they age out. Set PITR window to the **minimum that meets recovery needs (7 days)** and daily backups 7 days; state in privacy notice "removed from backups within 14 days".
- **Restore rule:** after any restore, re-run the **deletion ledger**: keep `deletion_ledger(subject_type, subject_id, purged_at)` outside restorable scope (or re-apply from audit export) and replay purges so deleted households/users do not reappear. Include this step in OPS-RUNBOOK restore drill.
- Do not export backups to unmanaged locations; if any manual dump is taken, delete within 14 days.

## 6. Acceptance tests
- Export contains only requester-visible data; outsider/other-household rows absent (RLS test).
- Export images zip opens, counts match manifest.
- Member leave: access revoked at once; their dietary rows gone; household content remains.
- Owner cannot leave with other members; transfer works; last-owner trigger enforced.
- Household delete: after purge, 0 rows in any table by household_id; 0 storage objects under prefix (query `storage.objects`).
- Restore drill replays ledger.
- Account deletion removes auth user and exports.

## 7. Implementation order
1. `storage_cleanup_queue`, `deletion_ledger`, triggers (migration, lane-named).
2. `purge_household`, `member_leave`, last-owner trigger + pgTAP/SQL tests.
3. Delete/leave/transfer routes + UI confirmations.
4. Export job + archive builder.
5. Cron workers + alerts.
