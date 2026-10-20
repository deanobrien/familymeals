-- ST1 (D190): Storage uploads. Household folder RLS on storage.objects, receipts.image_paths via save_receipt, the
-- reference-aware cleanup queue, the 24h stale-upload backstop, 90-day receipt photo retention and the job claim.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'alice@example.test'),
  ('b0000000-0000-4000-8000-000000000002', 'bob@example.test');
insert into public.households (id, name, created_by) values
  ('aa000000-0000-4000-8000-0000000000aa', 'Alice home', 'a0000000-0000-4000-8000-000000000001'),
  ('bb000000-0000-4000-8000-0000000000bb', 'Bob home',   'b0000000-0000-4000-8000-000000000002');

-- ---- storage RLS on the new path convention: <household>/<kind>/<id>/<file> ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
insert into storage.objects (bucket_id, name, owner) values
  ('recipe-images',  'aa000000-0000-4000-8000-0000000000aa/page/a1000000-0000-4000-8000-000000000001/page-1.jpg', 'a0000000-0000-4000-8000-000000000001'),
  ('receipt-images', 'aa000000-0000-4000-8000-0000000000aa/receipt/a8000000-0000-4000-8000-000000000001/receipt.jpg', 'a0000000-0000-4000-8000-000000000001');
select tests.throws($$ insert into storage.objects (bucket_id, name) values
  ('recipe-images', 'bb000000-0000-4000-8000-0000000000bb/cover/a1000000-0000-4000-8000-000000000001/cover.jpg') $$,
  '42501', 'cannot write into another household folder');
select tests.is((select count(*) from storage.objects), 2, 'member sees their own household objects');

select tests.reset_actor();
insert into storage.objects (bucket_id, name) values
  ('recipe-images', 'bb000000-0000-4000-8000-0000000000bb/cover/b1000000-0000-4000-8000-000000000001/cover.jpg');
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.is((select count(*) from storage.objects where name like 'bb000000%'), 0, 'another household''s objects are invisible');
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.is((select count(*) from storage.objects), 1, 'the other household sees only its own');
select tests.is((select count(*) from storage.objects where name like 'aa000000%'), 0, 'and not Alice''s');

-- ---- save_receipt persists image_paths and never wipes them on a later save without the key ----
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select public.save_receipt('aa000000-0000-4000-8000-0000000000aa',
  '{"id":"a8000000-0000-4000-8000-000000000001","status":"parsed","imagePaths":["aa000000-0000-4000-8000-0000000000aa/receipt/a8000000-0000-4000-8000-000000000001/receipt.jpg"]}'::jsonb,
  '[]'::jsonb);
select tests.is((select cardinality(image_paths) from public.receipts where id = 'a8000000-0000-4000-8000-000000000001'), 1, 'receipt image path saved');
select public.save_receipt('aa000000-0000-4000-8000-0000000000aa',
  '{"id":"a8000000-0000-4000-8000-000000000001","status":"parsed","retailer":"Tesco"}'::jsonb, '[]'::jsonb);
select tests.is((select cardinality(image_paths) from public.receipts where id = 'a8000000-0000-4000-8000-000000000001'), 1, 'a save without imagePaths keeps them');
select tests.throws($$ select public.save_receipt('aa000000-0000-4000-8000-0000000000aa',
  '{"id":"a8000000-0000-4000-8000-000000000002","status":"parsed","imagePaths":["bb000000-0000-4000-8000-0000000000bb/receipt/x/receipt.jpg"]}'::jsonb,
  '[]'::jsonb) $$, '23514', 'a receipt image path outside the household folder is refused');

-- ---- reference-aware cleanup queue ----
select tests.reset_actor();
insert into public.recipes (id, household_id, title, cover_image_path) values
  ('a1000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-0000000000aa', 'Original',
   'aa000000-0000-4000-8000-0000000000aa/cover/c1000000-0000-4000-8000-000000000001/cover.jpg'),
  ('a1000000-0000-4000-8000-000000000002', 'aa000000-0000-4000-8000-0000000000aa', 'Duplicate',
   'aa000000-0000-4000-8000-0000000000aa/cover/c1000000-0000-4000-8000-000000000001/cover.jpg');
select tests.act_as('a0000000-0000-4000-8000-000000000001');
delete from public.recipes where id = 'a1000000-0000-4000-8000-000000000001';
select tests.reset_actor();
select tests.is((select count(*) from public.storage_cleanup_queue where reason = 'recipe_deleted'), 0,
                'deleting one recipe does not queue a cover the duplicate still uses');
select tests.act_as('a0000000-0000-4000-8000-000000000001');
delete from public.recipes where id = 'a1000000-0000-4000-8000-000000000002';
select tests.reset_actor();
select tests.is((select count(*) from public.storage_cleanup_queue where reason = 'recipe_deleted'), 1,
                'the last reference going queues the cover');
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ select public.enqueue_storage_cleanup('recipe-images', 'x', null, 'r') $$,
                    '42501', 'users cannot enqueue cleanup rows');
select tests.reset_actor();

-- ---- stale upload backstop (service role only) ----
insert into public.recipes (id, household_id, title, cover_image_path) values
  ('a1000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-0000000000aa', 'Keeps cover',
   'aa000000-0000-4000-8000-0000000000aa/cover/c1000000-0000-4000-8000-000000000003/cover.jpg');
insert into storage.objects (bucket_id, name, created_at) values
  ('recipe-images',  'aa000000-0000-4000-8000-0000000000aa/page/a2000000-0000-4000-8000-000000000001/page-1.jpg', now() - interval '30 hours'),
  ('recipe-images',  'aa000000-0000-4000-8000-0000000000aa/cover/c1000000-0000-4000-8000-000000000002/cover.jpg', now() - interval '30 hours'),
  ('recipe-images',  'aa000000-0000-4000-8000-0000000000aa/cover/c1000000-0000-4000-8000-000000000003/cover.jpg', now() - interval '30 hours'),
  ('recipe-images',  'aa000000-0000-4000-8000-0000000000aa/page/a2000000-0000-4000-8000-000000000002/page-1.jpg', now() - interval '2 hours'),
  ('receipt-images', 'aa000000-0000-4000-8000-0000000000aa/receipt/a8000000-0000-4000-8000-000000000009/receipt.jpg', now() - interval '30 hours');
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ select public.enqueue_stale_uploads() $$, '42501', 'users cannot run the stale-upload sweep');
select tests.reset_actor();
select set_config('role', 'service_role', true);
select tests.is(public.enqueue_stale_uploads(interval '24 hours'), 3,
                'old unsaved page, orphan cover and orphan receipt photo queued; kept cover, kept receipt photo and fresh page are not');
select tests.reset_actor();
select tests.is((select count(*) from public.storage_cleanup_queue where reason = 'stale_upload' and object_path like '%/page/a2000000-0000-4000-8000-000000000001/%'), 1, 'stale page queued');
select tests.is((select count(*) from public.storage_cleanup_queue where reason = 'stale_upload' and object_path like '%/cover/c1000000-0000-4000-8000-000000000003/%'), 0, 'referenced cover not queued');

-- ---- 90-day receipt photo retention ----
insert into public.receipts (id, household_id, status, reconciled_at, image_paths) values
  ('a8000000-0000-4000-8000-000000000010', 'aa000000-0000-4000-8000-0000000000aa', 'reconciled', now() - interval '100 days',
   array['aa000000-0000-4000-8000-0000000000aa/receipt/a8000000-0000-4000-8000-000000000010/receipt.jpg']),
  ('a8000000-0000-4000-8000-000000000011', 'aa000000-0000-4000-8000-0000000000aa', 'reconciled', now() - interval '10 days',
   array['aa000000-0000-4000-8000-0000000000aa/receipt/a8000000-0000-4000-8000-000000000011/receipt.jpg']);
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ select public.purge_old_receipt_images() $$, '42501', 'users cannot run receipt retention');
select tests.reset_actor();
select set_config('role', 'service_role', true);
select tests.is(public.purge_old_receipt_images(90), 1, 'one receipt past retention');
select tests.reset_actor();
select tests.is((select cardinality(image_paths) from public.receipts where id = 'a8000000-0000-4000-8000-000000000010'), 0, 'old receipt photo path cleared (parsed lines are kept)');
select tests.is((select cardinality(image_paths) from public.receipts where id = 'a8000000-0000-4000-8000-000000000011'), 1, 'recent receipt photo kept');
select tests.is((select count(*) from public.storage_cleanup_queue where reason = 'receipt_image_removed'
                  and object_path like '%/receipt/a8000000-0000-4000-8000-000000000010/%'), 1, 'cleared photo queued for deletion');

-- ---- archiving a recipe (the app's "delete") releases and queues its cover ----
insert into public.recipes (id, household_id, title, cover_image_path) values
  ('a1000000-0000-4000-8000-000000000004', 'aa000000-0000-4000-8000-0000000000aa', 'To archive',
   'aa000000-0000-4000-8000-0000000000aa/cover/c1000000-0000-4000-8000-000000000004/cover.jpg');
select tests.act_as('a0000000-0000-4000-8000-000000000001');
update public.recipes set status = 'archived' where id = 'a1000000-0000-4000-8000-000000000004';
select tests.reset_actor();
select tests.ok((select cover_image_path is null from public.recipes where id = 'a1000000-0000-4000-8000-000000000004'), 'archived recipe no longer holds the cover');
select tests.is((select count(*) from public.storage_cleanup_queue
                  where object_path like '%/cover/c1000000-0000-4000-8000-000000000004/%'), 1, 'archived recipe cover queued for deletion');

-- ---- job claim: attempts counted, re-referenced rows retired ----
insert into public.storage_cleanup_queue (bucket, object_path, household_id, reason) values
  ('recipe-images', 'aa000000-0000-4000-8000-0000000000aa/cover/c1000000-0000-4000-8000-000000000003/cover.jpg',
   'aa000000-0000-4000-8000-0000000000aa', 'cover_replaced');
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ select * from public.claim_storage_cleanup(10) $$, '42501', 'users cannot claim cleanup work');
select tests.reset_actor();
select set_config('role', 'service_role', true);
select tests.ok((select count(*) from public.claim_storage_cleanup(100)) >= 4, 'claimed the pending objects');
select tests.reset_actor();
select tests.is((select count(*) from public.storage_cleanup_queue where processed_at is null and attempts = 1), (select count(*) from public.storage_cleanup_queue where processed_at is null), 'attempts incremented on claim');
select tests.ok((select processed_at is not null and last_error like 'skipped%' from public.storage_cleanup_queue
                  where object_path like '%c1000000-0000-4000-8000-000000000003%'), 're-referenced row retired, not deleted');

rollback;
