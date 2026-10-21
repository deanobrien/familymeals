# PRJ-018 Schema v1 (lane L1)

Postgres/Supabase migrations, RLS, storage and `@fr/domain` zod types. Source: BRIEF §5/§13/§16, BRIEF-REVIEW schema
adjustments, plus requests from L24 (privacy lifecycle) and L17a (shopping concurrency).

## Layout

| Path | Contents |
|---|---|
| `supabase/migrations/2026101900NN00_foundation.sql` (NN = migration number 01..14; baseline is `20261019000000`) | `extensions` schema + `pg_trgm`, all enums, `unit_dimension()`, `quantity_is_valid()`, `try_uuid()`, `set_updated_at()` |
| `0002_households.sql` | households, household_members, invitations, person_profiles, household_exclusions; `is_household_member/owner()`; owner bootstrap; last-owner guard; `create_invitation()` / `accept_invitation()` |
| `0003_reference_data.sql` | ingredients, ingredient_aliases, ingredient_densities, ingredient_unit_weights, ingredient_nutrients, ingredient_allergens; shared-or-own product_packs, ingredient_prices |
| `0004_recipes.sql` | recipes, recipe_versions, recipe_images, recipe_ingredients, recipe_steps, recipe_tags, recipe_tag_links, recipe_favourites, recipe_ratings; search triggers; `search_recipes()` |
| `0005_meal_planning.sql` | meal_plans, planned_meals (+ date-in-range trigger) |
| `0006_shopping.sql` | shopping_lists, shopping_list_items, shopping_list_item_sources, purchase_events (append-only trigger), view `shopping_list_item_progress` |
| `0007_receipts_pantry.sql` | receipts, receipt_lines, pantry_items; receipt FKs from purchases/prices |
| `0008_nutrition_ai.sql` | nutrition_profiles, nutrition_profile_values, ai_usage |
| `0009_rls.sql` | RLS on every table, grants, all policies, member self-service guard |
| `0010_storage.sql` | private buckets `recipe-images`, `receipt-images` + household-path policies |
| `0011_realtime.sql` | `supabase_realtime` publication (guarded no-op elsewhere) |
| `20261020002100_st1_storage_uploads.sql` | ST1 (D190): reference-aware `enqueue_storage_cleanup` (service role only), `save_receipt` persists `image_paths`, `enqueue_stale_uploads()` (24 h backstop), `purge_old_receipt_images()` (90 days), `claim_storage_cleanup()` (job claim), recipe archive releases the cover. Object paths `<household_id>/<page|cover|receipt>/<id>/<file>` |
| `0012_privacy_lifecycle.sql` | consent_records, storage_cleanup_queue, deletion_ledger, households.status/purge_after; `request/cancel_household_deletion()`, `member_leave()`, `purge_household()` |
| `0013_shopping_commands.sql` | shopping_command_log; `shopping_item_outstanding()`, `record_purchase()`, `void_purchase()` |
| `0014_owner_decisions.sql` | purchase_events nullable actors + `created_by_display_name` snapshot; `is_household_writable()`, `household_is_active()`; grace-period read-only policies + guard triggers |
| `0015_transfer_ownership.sql` | `transfer_ownership(p_household_id, p_new_owner_member_id)` - atomic owner swap RPC |
| `001520` / `001540` | S1 repository RPCs (D51); `pantry_settings.purchase_mode` source of truth (D104) |
| `002300` / `002301` | IL1 (D223, D225): `save_recipe` explicit unlink (null/empty `ingredientId` = not in list); exact-match backfill of recipe ingredient links |
| `001600_shopping_repository.sql` | S2 (D120-D122): engine item state on `shopping_list_items`, shopping quantities `numeric(18,6)`, `shopping_command_log.list_seq` per-list commit-ordered cursor (`shopping_list_log_heads` counter), `ensure_shopping_list`, `shopping_list_snapshot`, `apply_shopping_command` |
| `001610_receipts_prices.sql` | S2 (D123, D124, D127): `receipts.review_state`, `receipt_lines.parsed`, `save_receipt` / `get_receipt` / `list_receipts`, `record_price_observations` / `household_price_observations` (idempotent per source), `household_purchase_records` |
| `001620_household_profile_ai_settings.sql` | S2 (D125, D126): `planner_household_profile` (consent-gated allergy exclusions), `household_ai_settings` (no grants; ciphertext keys) + member-read / owner-write RPCs |
| `20261021001200_notifications.sql` | P1-C (D380-D389): `notification_devices` (own rows; `register_push_device` / `unregister_push_device`), `notification_settings` + `notification_preferences` (own rows, writable household), `notifications` (in-app centre + push outbox; unique `(user_id, household_id, dedupe_key)`; users update `read_at` only), service-only `notification_delivery_attempts` + `notification_job_state`; `request_test_notification` / `complete_test_push`; derived feed `activity_events()` (security invoker); service-role helpers `jobs_expiry_candidates`, `jobs_notification_recipients`, `jobs_recent_shoppers`. Tests: `packages/db/tests/rls/012_p1c_notifications.sql` |
| `20261020002800_pantry_par_levels.sql` | PR1 (D280): `pantry_par_levels` (per ingredient or free-text name; min / restock-to / pack / enabled / snoozed_until; one per ingredient and per normalised name) + `restock_settings` (`auto_add`); member RLS, read-only in the deletion grace period, cascade on purge. Tests: `packages/db/tests/rls/010_pr1_pantry_par_levels.sql` |
| `20261021001100_p1b_member_dislikes.sql` | P1-B (D378): `member_dislikes` (household, member user id via composite FK to `household_members`, lower-case term, unique per member) + `set_member_dislikes(household, member, terms[])` (security invoker, replaces a list atomically, max 30). Members read; own list or owner writes; read-only in the deletion grace period. Not health data (no consent), separate from `household_exclusions`. Tests: `packages/db/tests/rls/012_p1b_member_dislikes.sql` |
| `20261020002500_dx1_export_deletion.sql` | DX1 (D250-D259): `data_export_requests` (own-row select; `begin_data_export` rate limit / `record_data_export_download`); `request_household_deletion` grace clamp; `request/cancel_account_deletion`, `my_account_deletion`; `deletion_subject` + `account`; purchase-event anonymisation shape; `invitations` CHECK relaxed to `accepted_by is null or accepted_at is not null` (account deletion of an invitee failed); service-role-only `jobs_purge_due` (+ ledger replay), `jobs_due_account_deletions`, `jobs_prepare/complete_account_purge`, `jobs_status` (queue processing is ST1's `claim_storage_cleanup`). Tests: `packages/db/tests/rls/011_dx1_export_deletion.sql` |
| `packages/domain/src/` | `@fr/domain`: primitives, CONTRACT-SEED shapes, one row schema per table/view, RPC DTOs, row mapping |
| `packages/db/tests/rls/*.sql` | plain-SQL assert scripts (BEGIN…ROLLBACK); `000_helpers.sql` defines `tests.act_as()` etc. |
| `packages/db/tests/support/supabase-stub.sql` | stand-in for `auth`/`storage`/roles — **CI only, never on Supabase** |
| `packages/domain/test/*.test.ts`, `packages/db/test/migrations.pglite.test.ts` | Vitest: zod tests, compile-time CONTRACT-SEED compatibility, PGlite migration + RLS runner |

38 tables + 1 view. Migration `20261019001400_owner_decisions.sql` (0014) applies the owner decisions below. Requires Postgres 15+ (`security_invoker` views, `ON DELETE SET NULL (col)`, `NULLS NOT DISTINCT`).

## ER summary

```
auth.users ─┬─< household_members >── households ──< invitations
            └─< consent_records >──┘   │  ├──< person_profiles     ├──< household_exclusions ─? ingredients / allergen_group / term
                                       │  ├──< recipes ──< recipe_ingredients ─? ingredients
                                       │  │      ├──< recipe_steps, recipe_images, recipe_versions, nutrition_profiles ──< nutrition_profile_values
                                       │  │      ├──< recipe_tag_links >── recipe_tags
                                       │  │      └──< recipe_favourites / recipe_ratings (per user)
                                       │  ├──< meal_plans ──< planned_meals ─? recipes
                                       │  ├──< shopping_lists (─? meal_plans) ──< shopping_list_items ──< shopping_list_item_sources ─? planned_meals / recipes / recipe_ingredients
                                       │  │                                         └──< purchase_events ─? receipt_lines
                                       │  ├──< shopping_command_log (per list, seq-ordered)
                                       │  ├──< receipts ──< receipt_lines ─? shopping_list_items
                                       │  ├──< pantry_items, ai_usage
                                       │  └──< product_packs / ingredient_prices (household_id NULL = reference row)
                                       │  └──< stores ──< store_aisles ──< store_placements   (AS1, D290; target = ingredient id | item name | category label, text)
ingredients ──< ingredient_aliases, ingredient_densities, ingredient_unit_weights, ingredient_nutrients, ingredient_allergens
storage_cleanup_queue, deletion_ledger   (no FKs; service role only)
```

**Store locations (P2-A, migration `20261021002000`).** `store_locations` (PK `store_id`; composite FK `(store_id, household_id)` to `stores`, cascade): `lat`, `lng`, `radius_m` 50-1000 (default 150), `source` `device | postcode` (a postcode row names its postcode, a device row has none). The spot a member saved for a shop; no live position is stored anywhere. RLS as the store book (members select; writable-household members write). RLS tests: `packages/db/tests/rls/013_p2a_store_locations.sql`. Migration `20261021002010` adds `near_store` to `notification_type_is_valid` (the Android-only, off-by-default nudge preference).

**Stores and aisles (AS1, migration `20261020002900`).** `stores` (unique name per household, case-insensitive), `store_aisles` (label, `sort_order`), `store_placements` (unique per `(store_id, target_type, target_key)`; `target_type` in `ingredient | item | category`). Composite FKs `(store_id, household_id)` and `(aisle_id, store_id)` keep rows in one household and one store; deleting an aisle or store cascades. RLS: members select, writable-household members write (read-only in the deletion grace period). Functions: `household_store_book(p_household_id)` (jsonb, security invoker) and `copy_store_layout(p_household_id, p_from_store, p_to_store)` (replaces the target's aisles and placements atomically). RLS tests: `packages/db/tests/rls/010_as1_store_aisles.sql`.

The four concepts the brief insists stay separate are separate tables: **recipe requirement**
(`recipe_ingredients`), **shopping requirement** (`shopping_list_items` + provenance in `shopping_list_item_sources`),
**purchase** (`purchase_events`, `receipt_lines`), **stock** (`pantry_items`).

## Key design decisions

- **UUID PKs** (`gen_random_uuid()`), `timestamptz` everywhere, `updated_at` via trigger.
- **Money = integer pence** (`*_pence integer`). AI cost is integer **millipence** (`ai_usage.cost_millipence bigint`) since calls cost fractions of a penny.
- **Quantity** (CONTRACT `Quantity`) is flattened to `quantity_kind, quantity_value, quantity_min, quantity_max, unit, approx_label, original_text` on every table that holds one, with one shared CHECK `quantity_is_valid()` (same rules as the zod `Quantity` refine): `to_taste`/`unparsed` can never carry a value or unit — no invented weight for "a pinch". `original_text` always preserved. zod rows expose a single `quantity` field; `fromDbRow()/toDbRow()` fold/unfold.
- **`Recipe.method` dropped** — steps only (`recipe_steps`).
- **Tenancy is denormalised**: every household-scoped row has `household_id`, and child tables use **composite FKs** `(parent_id, household_id) → parent(id, household_id)`. A row can never reference another household's parent even if a policy were wrong or the service role writes it (tested).
- **Density / unit weights** are separate reference tables; unit weights are CHECK-forced `estimate = true`. No row ⇒ engine refuses conversion.
- **Nutrition**: `value_status known|zero|unknown|unavailable` with CHECK (unknown/unavailable ⇒ NULL, zero ⇒ 0). Ingredient composition per 100 g (`ingredient_nutrients`, source + version, CoFID primary) vs recipe-level calculated cache (`nutrition_profiles` + values, basis total/per_serving).
- **Prices**: `price_kind` encodes the hierarchy. Reference rows (`household_id NULL`) may only be `generic_estimate`/`retailer_verified`; household rows only `user_confirmed`/`receipt` (users can't forge verified prices); `receipt` requires `receipt_line_id`. `observed_on` + `source` mandatory.
- **Purchases are append-only** `purchase_events` with a client-generated id. Trigger blocks DELETE and any UPDATE except the one-time void (`voided_by` = voiding user, `voided_at`). Purchased/outstanding are **derived**: view `shopping_list_item_progress` (same-unit sums, `has_unit_mismatch` flag) and `shopping_item_outstanding()` (same-unit + metric mass/volume conversion; NULL when density/engine conversion is needed).
- **Shopping writes (L17a)**: clients cannot INSERT/UPDATE `purchase_events`; they call `record_purchase(event_id, item_id, 'tick'|'purchase', …)` / `void_purchase(void_id, event_id)` (SECURITY DEFINER, explicit membership check). Each takes `FOR SHARE` on the list then `FOR UPDATE` on the item, dedupes on `command_id` *under the lock*, rejects a tick with nothing outstanding (`already_complete` + `completedBy`), and appends **every** outcome (incl. rejections) to `shopping_command_log` (`seq` identity = realtime feed + reconnect cursor). When SQL can't convert units the server passes `p_expected_outstanding` + `p_expected_event_count` (engine-computed); SQL re-checks the event count under the lock and rejects `needs_engine_outstanding` if stale.
- **Invitations**: own table, raw 64-hex token returned once by `create_invitation()`, only `sha256` stored, ≤30-day expiry, single use; `accept_invitation()` is the only join path for non-owners.
- **Exclusions (L17a/L9)**: `household_exclusions` matchable by `ingredient_id`, `allergen_group` (UK 14, joined via `ingredient_allergens`) or free-text `term`; at least one required. Allergy/intolerance rows need `consent_recorded_at` **and** an active `consent_records` row for the recording user (trigger).
- **Search**: `recipes.search_tsv` (generated, weighted title > ingredients/tags > description) + trigram GIN on title, ingredient text and tag text; denormalised `search_ingredients`/`search_tags` maintained by triggers. `search_recipes(household, query)` is SECURITY INVOKER (RLS applies).
- **Recipe history**: `recipe_versions` (jsonb `original` AI extraction / `corrected` user content, source image paths, model) — insert/select only.
- **Realtime**: lists, items, purchase events, command log, plans, pantry are published; clients still resync from tables/log on reconnect. The web client subscribes to command-log INSERTs as a hint and catches up by `list_seq` (D122).

## RLS model

- RLS **enabled on every table** in `public` (migration fails otherwise; also asserted by a test). `anon` has no table grants.
- `is_household_member(hid)` / `is_household_owner(hid)`: `SECURITY DEFINER`, `search_path = ''`, check `auth.uid()` has an **active** membership. Policies call these; no recursion on `household_members`.
- **Household-scoped tables** (recipes and children, plans, lists, items, sources, receipts, lines, pantry, nutrition, profiles, exclusions): member CRUD on `household_id`.
- **households**: select = member (or creator, so `insert … returning` works); insert = `created_by = auth.uid()` (trigger adds creator as owner); update/delete = owner.
- **household_members**: select = members of that household; insert = owner; update/delete = owner, or self (rename/leave). Trigger stops non-owners changing role, reactivating, or editing `invitation_id`; last active owner cannot be demoted/removed.
- **invitations**: owner only.
- **recipe_favourites / recipe_ratings**: household-readable, writable only for `user_id = auth.uid()`.
- **consent_records**: own rows only (owners can't read other members' consents); only `withdrawn_at` may change.
- **purchase_events**: member select; writes via RPC only (grants revoked); no delete.
- **shopping_command_log, ai_usage**: member select; writes server-side only.
- **Reference tables** (ingredients, aliases, densities, unit weights, nutrients, allergens): select to authenticated; no write grants (service role / L5 importer writes).
- **product_packs / ingredient_prices**: `household_id IS NULL` rows readable by all authenticated, household rows member-only; users can write only household rows.
- **storage_cleanup_queue, deletion_ledger**: RLS on, no policies, no grants → service role only.
- **Storage**: buckets private (10 MB, jpeg/png/webp/heic). Path `<household_id>/…`; all four object policies require `is_household_member(try_uuid(first folder))`. Bad paths fail closed. Read via signed URLs.
- RLS-visible view: `shopping_list_item_progress` is `security_invoker`.
- Every `SECURITY DEFINER` function pins `search_path` (asserted by a test).

## Deletion / cascade (L24)

- Every table with `household_id` has an `ON DELETE CASCADE` FK path from `households` that includes `household_id` (asserted by a test). `purge_household()` (service role) enqueues remaining storage objects, deletes the household, and marks the ledger.
- Grace period: `request_household_deletion()` sets `status = 'pending_deletion'`, `purge_after = now()+14d`, writes `deletion_ledger`; `cancel_household_deletion()` reverts. Cron calls `purge_household(id)` when due. Members keep READ access during grace; the household is read-only (owner decision D, 0014).
- ST1 (D190): the queue never receives an object a live row still references; archiving a recipe releases its cover; `enqueue_stale_uploads`, `purge_old_receipt_images` and `claim_storage_cleanup` are service-role-only job functions (the cleanup endpoint is the sole caller).
- Row deletions enqueue Storage objects automatically: `recipe_images` delete, recipe delete/cover replacement, receipt delete, receipt `image_paths` removal (for the "delete receipt images after N days" setting).
- `member_leave()` marks the membership `left`, nulls the display name, deletes that member's person profile, consents and favourites for that household; shared content stays. Blocks the sole owner (transfer first) and the last member (use household deletion).
- **Where cascade is deliberately NOT used inside a household** (NO ACTION — still removed by the household purge because the same statement cascades both sides):
  - `purchase_events → shopping_list_items` and `purchase_events → receipt_lines`: purchase history is retained; lists/receipts with purchases are archived, not deleted.
  - `planned_meals → recipes`: approved plans keep their recipes; the app archives recipes instead of deleting them.
  - Provenance/match links use `ON DELETE SET NULL (col)` with text snapshots (`shopping_list_item_sources`, `receipt_lines.matched_shopping_list_item_id`, `pantry_items.receipt_line_id`) so editing a recipe never erases history.
  - `storage_cleanup_queue`, `deletion_ledger` have **no FK** so they outlive the purge they record.
- User deletion: `created_by`-style columns are `ON DELETE SET NULL`; `household_members`/`consent_records`/favourites/ratings cascade. **Owner decision A (0014):** `purchase_events.created_by` / `voided_by` are now nullable with `ON DELETE SET NULL`, and a `created_by_display_name` snapshot is captured at insert (member display name, else person profile name), so an account can be deleted while purchase history survives. The append-only trigger permits exactly one extra UPDATE shape: the FK anonymisation (actor columns going to NULL, nothing else changing). In `@fr/domain` the persistence type `PurchaseEventRow` has `createdBy: Uuid | null` + `createdByDisplayName`; the contract-level `PurchaseEvent` keeps required `createdBy` for new events.

### Naming mapping for L24 / L17a requests

| Requested | L1 name | Note |
|---|---|---|
| `consent_record` | `consent_records` | plural table convention; `consent_type` enum `allergy_data`, `dietary_restrictions`; `wording_version` = requested `version` |
| `storage_cleanup_queue` | same | `object_path`, `attempts`, `last_error`, `processed_at`, `reason` |
| `deletion_ledger` | same | + `cancelled_at`, `requested_by` |
| `household` / `household_member` / `person_profile` / `recipe_image` | `households` / `household_members` / `person_profiles` / `recipe_images` | |
| household status `pending_deletion`, `purge_after` | `households.status`, `households.purge_after`, `deletion_requested_at` | |
| `household_exclusion` (ingredient_id, term, allergen_group) | `household_exclusions` | |
| `shopping_command_log.list_id`, `actor`, `payload` | `shopping_list_id`, `created_by`, `command` (+ `command_type`, `status`, `reason`, `result`) | |
| `shopping_list_item.removed_at` | `shopping_list_items.status = 'removed'` | |
| `purchase_event` | `purchase_events` | |
| `audit_log` (in L24 purge sketch) | not created | `deletion_ledger` covers purge records; general audit log is out of L1 scope |


## Owner decisions (merge batch 3, 2026-10-19)

- **A. Purchase history survives account deletion** - see "User deletion" above. Migration 0014; tests in `packages/db/tests/rls/004_owner_decisions.sql` and `migrations.pglite.test.ts`.
- **B. Household-custom ingredients: deferred.** `ingredients` stays reference-only; unmatched lines keep `ingredient_id NULL` (text kept). FUTURE WORK: add a nullable `household_id` to `ingredients` (shared-or-own, like `product_packs`) plus alias/density scoping. No schema change now.
- **C. SQL converts metric only; imperial/cup conversion stays in `@fr/engine`.** `metric_base_factor()` / `shopping_item_outstanding()` only convert mg/g/kg and ml/l. tsp/tbsp/cup/floz/pint are never converted in SQL (UK vs US cup ambiguity; pint = 568.26125 ml and the other factors are owned by `@fr/engine/units`). When SQL cannot compute outstanding, the engine path is used (`p_expected_outstanding` + `p_expected_event_count`, rejected as `needs_engine_outstanding` if stale).
- **D. Read-only during the 14-day deletion grace period** (`households.status = 'pending_deletion'`):
  - `is_household_writable(hid)` = active member AND household `active`. Migration 0014 rewrites every INSERT/UPDATE/DELETE policy (public + storage) that used `is_household_member()` to use it (done dynamically; a test asserts none remain). SELECT policies are unchanged, so members can still read and export.
  - Owner-gated writes (`households` update, `household_members` insert/owner-update, `invitations` insert/update) also require `household_is_active()`.
  - RPC-only write paths (`record_purchase`, `void_purchase`, `create_invitation`, `accept_invitation` via the inserts they perform) are guarded by `guard_household_writable()` triggers (end-user calls only: `auth.uid() is not null`), raising `insufficient_privilege`.
  - Still allowed: `cancel_household_deletion()` (owner), `member_leave()`, withdrawing consent, service-role `purge_household()`.

- **`transfer_ownership(household, new_owner_member)`** (0015, SECURITY DEFINER, authenticated only): caller must be the active owner; target must be a different ACTIVE member of the same household; refused (`42501`, read-only) while the household is `pending_deletion`. Promotes the target then demotes the caller in one transaction, so the last-owner guard always holds and exactly one owner remains. Errors: `42501` not owner / read-only, `22023` bad target or self. Tests: `packages/db/tests/rls/005_transfer_ownership.sql`.

## Validation

```
pnpm install
pnpm --filter @fr/domain typecheck && pnpm --filter @fr/domain test
pnpm --filter @fr/db test     # applies stub + every supabase/migrations/*.sql to PGlite and runs tests/rls/*.sql (no Docker)
```
`packages/db/test/migrations.pglite.test.ts` applies `tests/support/supabase-stub.sql` + all migrations to PGlite (Postgres 17 WASM,
in-process, with `pg_trgm` + `pgcrypto`) and runs every `tests/rls/*.sql`. Against a real local Supabase stack, skip the stub:
`psql "$DB_URL" -f tests/rls/000_helpers.sql -f tests/rls/001_households_membership.sql ...`.
Not covered by PGlite (single connection): true two-session concurrent tick race - needs a pgTAP/psql test with two
sessions once the Supabase local stack is available (logic is lock-based; idempotency/rejection paths are tested).

## Open questions

1. **Generated DB types** (`supabase gen types`): `packages/db/src/database.types.ts` is a placeholder; regenerate once a Supabase stack exists.
2. **Vitamins/minerals**: `nutrient_key` is the CONTRACT 10; extend enum when L8 needs more.
3. **SQL `quantity_is_valid()` is looser than the zod `Quantity`** (zod additionally requires `approxLabel` and forbids a unit on `approximate`, per the ratified L6 strictness). Tighten SQL only if a DB-level guarantee is wanted.
4. **`ReceiptLine` naming**: the ratified canonical wire line lives in `@fr/domain` as `ReceiptParseLine` (+ `ReceiptParse`) because `ReceiptLine` is the persisted row schema; alias at the engine/ai merge if the shorter name is preferred.
5. **Not yet in `@fr/domain`**: `ExtractedRecipe`, `PlanConstraints` (ratified canonical) - they arrive with the ai/engine contract swap.

## P1-A cooking (`20261021001000_cooking.sql`)

- **recipe_cooked** (household, recipe, user, cooked_at, servings, rating?): household-readable, writable only for `user_id = auth.uid()` in a writable household.
- **recipe_cook_notes** (cooked_id, note, is_private): a private note is readable only by its author; household notes by every member; only the cook can write.
- **recipe_dont_suggest** (recipe, user): household-readable (the planner needs everyone's), self-written.
- `recipe_cook_summaries(household)` (invoker): count + last cooked per recipe. A trigger on `household_members.status` (left / revoked) deletes the leaver's rows in these tables.
