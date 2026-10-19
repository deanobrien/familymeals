-- PRJ-018 schema v1 — 0015 atomic ownership transfer.
-- Replaces the app-side two-step (promote, then demote) with one SECURITY DEFINER RPC. Promote-first inside a single
-- transaction keeps the last-owner guard (0002) satisfied at every statement; the household is never ownerless.
-- Refused while the household is pending deletion (owner decision D: read-only grace period).

create or replace function public.transfer_ownership(p_household_id uuid, p_new_owner_member_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me public.household_members%rowtype;
  v_target public.household_members%rowtype;
begin
  if v_uid is null then
    raise exception 'authentication required' using errcode = 'insufficient_privilege';
  end if;
  -- Serialise concurrent transfers / deletion requests for this household.
  perform 1 from public.households h where h.id = p_household_id for update;
  if not found then
    raise exception 'not an active owner' using errcode = 'insufficient_privilege';
  end if;
  select * into v_me from public.household_members
   where household_id = p_household_id and user_id = v_uid and status = 'active' and role = 'owner' for update;
  if not found then
    raise exception 'not an active owner' using errcode = 'insufficient_privilege';
  end if;
  if not public.household_is_active(p_household_id) then
    raise exception 'household is pending deletion and read-only' using errcode = 'insufficient_privilege';
  end if;
  select * into v_target from public.household_members
   where id = p_new_owner_member_id and household_id = p_household_id and status = 'active' for update;
  if not found then
    raise exception 'target is not an active member of this household' using errcode = 'invalid_parameter_value';
  end if;
  if v_target.id = v_me.id then
    raise exception 'cannot transfer ownership to yourself' using errcode = 'invalid_parameter_value';
  end if;
  -- Promote first (two owners briefly), then demote: the last-owner guard never trips.
  update public.household_members set role = 'owner' where id = v_target.id;
  update public.household_members set role = 'member' where id = v_me.id;
end
$$;

revoke all on function public.transfer_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
