-- PRJ-018 ST1 (D190): Supabase Storage uploads. Everything the app needs on the database side of private images.
--
-- Object paths (the first segment is what the storage RLS policies check, migration 0010):
--   recipe-images   <household_id>/page/<upload_id>/page-N.jpg        TEMPORARY page photos of a recipe import
--   recipe-images   <household_id>/cover/<upload_id>/cover.jpg        recipes.cover_image_path
--   receipt-images  <household_id>/receipt/<receipt_id>/receipt.jpg   receipts.image_paths
--
-- Adds:
--   1. enqueue_storage_cleanup: never queues an object that a row still references (a duplicated recipe shares its
--      cover path with the original; deleting one must not delete the other's image), and is service-role only.
--   2. save_receipt: persists image_paths (only when the caller sends them, so later saves never wipe them).
--   3. enqueue_stale_uploads(): 24h backstop for abandoned imports (unsaved page photos, orphan covers / receipt photos).
--   4. purge_old_receipt_images(): clears image_paths 90 days after confirmation (docs/security/PRIVACY.md); the
--      existing receipts trigger then queues the objects.
--   5. claim_storage_cleanup(): the cleanup job's batch claim (attempt counter, skips rows that became referenced again).
--   6. archiving a recipe (what the app calls "delete") releases its cover so the object is queued for deletion.
-- All job functions are SECURITY DEFINER and executable by service_role only; the cleanup endpoint
-- (app/api/jobs/storage-cleanup) is the only caller.

-- ---------------------------------------------------------------------------
-- 1. enqueue_storage_cleanup, reference-aware and not callable by end users
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_storage_cleanup(p_bucket text, p_path text, p_household_id uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_path is null or p_path = '' then
    return;
  end if;
  if p_bucket = 'recipe-images' and (
       exists (select 1 from public.recipes r where r.cover_image_path = p_path)
    or exists (select 1 from public.recipe_images i where i.storage_path = p_path)) then
    return; -- still referenced by a live row
  end if;
  if p_bucket = 'receipt-images' and exists (select 1 from public.receipts r where p_path = any (r.image_paths)) then
    return;
  end if;
  insert into public.storage_cleanup_queue (bucket, object_path, household_id, reason)
  values (p_bucket, p_path, p_household_id, p_reason)
  on conflict (bucket, object_path) where processed_at is null do nothing;
end
$$;
revoke all on function public.enqueue_storage_cleanup(text, text, uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. save_receipt with image_paths (p_receipt.imagePaths: text[]; absent key = leave as is)
-- ---------------------------------------------------------------------------
create or replace function public.save_receipt(p_household_id uuid, p_receipt jsonb, p_lines jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := (p_receipt ->> 'id')::uuid;
  v jsonb;
  q jsonb;
  v_item uuid;
  v_status public.receipt_line_match_status;
  v_has_paths boolean := (p_receipt ? 'imagePaths') and jsonb_typeof(p_receipt -> 'imagePaths') = 'array';
  v_paths text[] := coalesce((select array_agg(x) from jsonb_array_elements_text(
                                case when (p_receipt ? 'imagePaths') and jsonb_typeof(p_receipt -> 'imagePaths') = 'array'
                                     then p_receipt -> 'imagePaths' else '[]'::jsonb end) x), '{}'::text[]);
begin
  insert into public.receipts as r (id, household_id, retailer, purchased_on, total_pence, status, reconciled_at, review_state, image_paths)
  values (v_id, p_household_id, left(nullif(p_receipt ->> 'retailer', ''), 80), (p_receipt ->> 'purchasedOn')::date,
          (p_receipt ->> 'totalPence')::integer, (p_receipt ->> 'status')::public.receipt_status,
          (p_receipt ->> 'reconciledAt')::timestamptz, p_receipt -> 'reviewState', v_paths)
  on conflict (id) do update set
    retailer = excluded.retailer, purchased_on = excluded.purchased_on, total_pence = excluded.total_pence,
    status = excluded.status, reconciled_at = excluded.reconciled_at, review_state = excluded.review_state,
    image_paths = case when v_has_paths then excluded.image_paths else r.image_paths end
  where r.household_id = p_household_id;
  if not found then
    raise exception 'receipt_not_found' using errcode = 'no_data_found';
  end if;

  for v in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    q := coalesce(v -> 'quantity', jsonb_build_object('kind', 'unparsed', 'originalText', ''));
    -- a suggestion/confirmation may only point at one of THIS household's items; otherwise the line is unmatched
    select i.id into v_item from public.shopping_list_items i
     where i.id = public.try_uuid(v ->> 'matchedItemId') and i.household_id = p_household_id;
    v_status := coalesce(v ->> 'matchStatus', 'unmatched')::public.receipt_line_match_status;
    if v_item is null and v_status in ('suggested', 'confirmed') then v_status := 'unmatched'; end if;
    insert into public.receipt_lines as l (
      id, receipt_id, household_id, line_no, description,
      quantity_kind, quantity_value, quantity_min, quantity_max, unit, approx_label, original_text,
      unit_price_pence, line_total_pence, match_status, matched_shopping_list_item_id, match_score, added_to_pantry, parsed)
    values (
      (v ->> 'id')::uuid, v_id, p_household_id, (v ->> 'lineNo')::integer,
      left(coalesce(nullif(btrim(v ->> 'description'), ''), 'item'), 300),
      (q ->> 'kind')::public.quantity_kind, (q ->> 'value')::numeric, (q ->> 'min')::numeric, (q ->> 'max')::numeric,
      (q ->> 'unit')::public.unit, q ->> 'approxLabel', coalesce(q ->> 'originalText', ''),
      (v ->> 'unitPricePence')::integer, (v ->> 'lineTotalPence')::integer, v_status, v_item,
      least(greatest((v ->> 'matchScore')::numeric, 0), 1), coalesce((v ->> 'addedToPantry')::boolean, false),
      v -> 'parsed')
    on conflict (id) do update set
      line_no = excluded.line_no, description = excluded.description,
      match_status = excluded.match_status, matched_shopping_list_item_id = excluded.matched_shopping_list_item_id,
      match_score = excluded.match_score, added_to_pantry = excluded.added_to_pantry, parsed = excluded.parsed
    where l.receipt_id = v_id and l.household_id = p_household_id;
    if not found then
      raise exception 'receipt line % belongs to another receipt', v ->> 'id' using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  return v_id;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Abandoned uploads (unsaved imports, receipt photos whose row never saved)
-- ---------------------------------------------------------------------------
create or replace function public.enqueue_stale_uploads(p_max_age interval default interval '24 hours')
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare
  o record;
  v_before integer;
  v_after integer;
begin
  select count(*) into v_before from public.storage_cleanup_queue where processed_at is null;
  for o in
    select b.bucket_id, b.name, (storage.foldername(b.name))[1] as hh, (storage.foldername(b.name))[2] as kind
      from storage.objects b
     where b.bucket_id in ('recipe-images', 'receipt-images')
       and b.created_at < now() - p_max_age
       and (storage.foldername(b.name))[2] in ('page', 'cover', 'receipt')
  loop
    -- enqueue_storage_cleanup skips anything a live row still references (a cover in use, a kept receipt photo)
    perform public.enqueue_storage_cleanup(o.bucket_id, o.name, public.try_uuid(o.hh), 'stale_upload');
  end loop;
  select count(*) into v_after from public.storage_cleanup_queue where processed_at is null;
  return greatest(v_after - v_before, 0);
end
$$;
revoke all on function public.enqueue_stale_uploads(interval) from public, anon, authenticated;
grant execute on function public.enqueue_stale_uploads(interval) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Receipt photo retention: 90 days after confirmation (PRIVACY.md). Parsed lines stay as purchase history.
-- ---------------------------------------------------------------------------
create or replace function public.purge_old_receipt_images(p_days integer default 90)
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare v_n integer;
begin
  update public.receipts
     set image_paths = '{}'
   where status = 'reconciled'
     and reconciled_at < now() - make_interval(days => greatest(p_days, 0))
     and cardinality(image_paths) > 0;
  get diagnostics v_n = row_count;
  return v_n; -- receipts_enqueue_cleanup queued the objects
end
$$;
revoke all on function public.purge_old_receipt_images(integer) from public, anon, authenticated;
grant execute on function public.purge_old_receipt_images(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Cleanup job batch claim
-- ---------------------------------------------------------------------------
create or replace function public.claim_storage_cleanup(p_limit integer default 100, p_max_attempts integer default 8)
returns setof public.storage_cleanup_queue
language plpgsql security definer
set search_path = ''
as $$
begin
  -- rows whose object became referenced again (e.g. a cover re-attached) are retired, not deleted
  update public.storage_cleanup_queue q
     set processed_at = now(), last_error = 'skipped: still referenced'
   where q.processed_at is null
     and ((q.bucket = 'recipe-images' and (exists (select 1 from public.recipes r where r.cover_image_path = q.object_path)
                                           or exists (select 1 from public.recipe_images i where i.storage_path = q.object_path)))
       or (q.bucket = 'receipt-images' and exists (select 1 from public.receipts r where q.object_path = any (r.image_paths))));
  return query
    update public.storage_cleanup_queue q
       set attempts = q.attempts + 1
     where q.id in (select c.id from public.storage_cleanup_queue c
                     where c.processed_at is null and c.attempts < p_max_attempts
                     order by c.enqueued_at
                     limit greatest(p_limit, 1)
                     for update skip locked)
    returning q.*;
end
$$;
revoke all on function public.claim_storage_cleanup(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_storage_cleanup(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Deleting a recipe in the app ARCHIVES it (planned meals reference recipes), so the row and its cover would live on.
--    Archiving releases the cover: cover_image_path is cleared, and the existing cover trigger (0012) queues the object
--    for deletion (skipped while a duplicate still uses the same path). Nothing restores an archived recipe.
-- ---------------------------------------------------------------------------
create or replace function public.recipes_release_cover_on_archive()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'archived' and old.status is distinct from 'archived' and new.cover_image_path is not null then
    update public.recipes set cover_image_path = null where id = new.id;
  end if;
  return null;
end
$$;
revoke all on function public.recipes_release_cover_on_archive() from public, anon, authenticated;
drop trigger if exists recipes_release_cover_on_archive on public.recipes;
create trigger recipes_release_cover_on_archive after update of status on public.recipes
  for each row execute function public.recipes_release_cover_on_archive();
