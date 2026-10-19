-- PRJ-018 schema v1 — 0010 storage buckets (PRIVATE) + household-path policies.
-- Object path convention:  <household_id>/<entity>/<uuid>.<ext>
--   recipe-images:  <household_id>/recipes/<recipe_id>/<image_id>.jpg
--   receipt-images: <household_id>/receipts/<receipt_id>/<page>.jpg
-- Access iff caller is an active member of the household named by the first path segment.
-- Clients read via signed URLs; buckets are never public.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('recipe-images',  'recipe-images',  false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('receipt-images', 'receipt-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy fr_household_objects_select on storage.objects for select to authenticated
  using (
    bucket_id in ('recipe-images', 'receipt-images')
    and public.is_household_member(public.try_uuid((storage.foldername(name))[1]))
  );

create policy fr_household_objects_insert on storage.objects for insert to authenticated
  with check (
    bucket_id in ('recipe-images', 'receipt-images')
    and public.is_household_member(public.try_uuid((storage.foldername(name))[1]))
  );

create policy fr_household_objects_update on storage.objects for update to authenticated
  using (
    bucket_id in ('recipe-images', 'receipt-images')
    and public.is_household_member(public.try_uuid((storage.foldername(name))[1]))
  )
  with check (
    bucket_id in ('recipe-images', 'receipt-images')
    and public.is_household_member(public.try_uuid((storage.foldername(name))[1]))
  );

create policy fr_household_objects_delete on storage.objects for delete to authenticated
  using (
    bucket_id in ('recipe-images', 'receipt-images')
    and public.is_household_member(public.try_uuid((storage.foldername(name))[1]))
  );
