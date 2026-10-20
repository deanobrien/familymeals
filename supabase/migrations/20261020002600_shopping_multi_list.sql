-- PRJ-018 SL1 (D263): several named shopping lists per household, ONE of them active.
--
-- Until now a household had a single list (`ensure_shopping_list` = the newest active one). SL1 keeps that contract
-- (every reader - the web repository, the Android app, Realtime filters, `shopping_list_snapshot` - still means "the
-- household's active list") and adds the minimum to hold more than one:
--   * shopping_list_create:   a new named list becomes the active one; the previous active list is ARCHIVED (kept whole:
--                             items, purchases and log). Idempotent on the caller's list id, so a retried "create a new
--                             list" (double submit, lost response) never makes a second list.
--   * shopping_list_activate: switch back to an older list; the current active one is archived.
-- Renaming and archiving are plain updates on shopping_lists (RLS: members; the household must be writable).
-- Both functions are SECURITY INVOKER: RLS decides who may touch which list. They take the same advisory lock as
-- ensure_shopping_list, so two devices switching at once cannot leave two active lists.

create or replace function public.shopping_list_create(
  p_household_id uuid,
  p_name text,
  p_list_id uuid default gen_random_uuid()
) returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_name text := left(btrim(coalesce(p_name, '')), 120);
  v_existing public.shopping_lists%rowtype;
begin
  if v_name = '' then
    raise exception 'a list needs a name' using errcode = 'invalid_parameter_value';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('fr.shopping_list:' || p_household_id::text, 0));
  select * into v_existing from public.shopping_lists where id = p_list_id;
  if found then
    if v_existing.household_id <> p_household_id then
      raise exception 'list_not_found' using errcode = 'no_data_found';
    end if;
    return v_existing.id; -- the same create, replayed
  end if;
  update public.shopping_lists set status = 'archived'
   where household_id = p_household_id and status = 'active';
  insert into public.shopping_lists (id, household_id, name) values (p_list_id, p_household_id, v_name);
  return p_list_id;
end
$$;

create or replace function public.shopping_list_activate(p_household_id uuid, p_list_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('fr.shopping_list:' || p_household_id::text, 0));
  perform 1 from public.shopping_lists where id = p_list_id and household_id = p_household_id;
  if not found then
    raise exception 'list_not_found' using errcode = 'no_data_found';
  end if;
  update public.shopping_lists set status = 'archived'
   where household_id = p_household_id and status = 'active' and id <> p_list_id;
  update public.shopping_lists set status = 'active' where id = p_list_id and status <> 'active';
  return p_list_id;
end
$$;

revoke all on function public.shopping_list_create(uuid, text, uuid) from public, anon;
revoke all on function public.shopping_list_activate(uuid, uuid) from public, anon;
grant execute on function public.shopping_list_create(uuid, text, uuid) to authenticated;
grant execute on function public.shopping_list_activate(uuid, uuid) to authenticated;
