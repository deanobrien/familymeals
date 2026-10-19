-- PRJ-018 LV1 (live local Supabase verification, DECISIONS D144): accept_invitation() ignored invitations.email.
-- The owner UI promises "Email (optional, locks the invite to this address)", but any signed-in user holding the
-- link could join. Now an email-locked invitation is accepted only by the account with that (confirmed) address,
-- and a wrong account gets the SAME generic error as an unknown / used / revoked / expired token (no oracle).
-- Also refuses joining a household that is pending deletion (read-only grace period, owner decision D).

create or replace function public.accept_invitation(p_token text)
returns uuid -- household_id joined
language plpgsql security definer
set search_path = ''
as $$
declare
  v_inv public.invitations%rowtype;
  v_uid uuid := auth.uid();
  v_email text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = 'insufficient_privilege';
  end if;
  select * into v_inv from public.invitations
   where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex')
   for update;
  if found and v_inv.email is not null then
    select lower(u.email) into v_email from auth.users u where u.id = v_uid and u.email_confirmed_at is not null;
  end if;
  if not found or v_inv.revoked_at is not null or v_inv.accepted_at is not null or v_inv.expires_at <= now()
     or (v_inv.email is not null and v_email is distinct from lower(v_inv.email))
     or not public.household_is_active(v_inv.household_id) then
    raise exception 'invitation invalid or expired' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.household_members (household_id, user_id, role, status, invitation_id)
  values (v_inv.household_id, v_uid, v_inv.role, 'active', v_inv.id)
  on conflict (household_id, user_id) do update
    set status = 'active', revoked_at = null, role = excluded.role, invitation_id = excluded.invitation_id;
  update public.invitations set accepted_at = now(), accepted_by = v_uid where id = v_inv.id;
  return v_inv.household_id;
end
$$;

revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;
