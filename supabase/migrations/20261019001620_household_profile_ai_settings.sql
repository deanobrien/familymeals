-- PRJ-018 S2 (D125-D126): planner household profile and household AI provider settings.

-- ---------------------------------------------------------------------------
-- planner_household_profile: members + hard exclusions for the planner (SECURITY DEFINER because consent_records are
-- own-rows-only under RLS, yet whether an allergy row may be USED depends on the RECORDER's consent).
--   * caller must be an active member of the household
--   * allergy / intolerance exclusions are returned only while the member who recorded them still has an active
--     allergy_data / dietary_restrictions consent for this household; otherwise they are withheld (counted in
--     `withheldExclusions` so the app can say so). 'avoid' rows need no consent.
--   * allergen_group exclusions expand to every reference ingredient carrying that allergen (plus the group name).
-- Returns null for a non-member.
-- ---------------------------------------------------------------------------
create or replace function public.planner_household_profile(p_household_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_ok boolean;
  v_usable jsonb;
  v_withheld integer;
begin
  if auth.uid() is null or not public.is_household_member(p_household_id) then
    return null;
  end if;

  with ex as (
    select x.*,
           (x.kind = 'avoid' or (x.consent_recorded_at is not null and exists (
              select 1 from public.consent_records c
               where c.household_id = x.household_id and c.user_id = x.created_by
                 and c.consent_type in ('allergy_data', 'dietary_restrictions') and c.withdrawn_at is null))) as usable
      from public.household_exclusions x where x.household_id = p_household_id
  ), names as (
    select ex.id, ex.kind, n.name
      from ex
      cross join lateral (
        select g.name from public.ingredients g where g.id = ex.ingredient_id
        union select ex.term where ex.term is not null
        union select replace(ex.allergen_group::text, '_', ' ') where ex.allergen_group is not null
        union select g.name from public.ingredient_allergens a join public.ingredients g on g.id = a.ingredient_id
               where ex.allergen_group is not null and a.allergen_group = ex.allergen_group
      ) n(name)
     where ex.usable and n.name is not null
  )
  select coalesce(jsonb_agg(distinct jsonb_build_object('name', lower(btrim(name)), 'kind', kind)), '[]'::jsonb),
         (select count(*) from ex where not ex.usable)::integer
    into v_usable, v_withheld
    from names;

  return (
    select jsonb_build_object(
      'id', h.id,
      'defaultServings', h.default_servings,
      'weeklyBudgetPence', h.weekly_budget_pence,
      'members', coalesce((
        select jsonb_agg(jsonb_build_object('id', m.user_id,
                                            'displayName', coalesce(m.display_name, p.display_name, 'Member'))
                         order by m.joined_order, m.user_id)
          from (select hm.*, row_number() over (order by hm.created_at, hm.id) as joined_order
                  from public.household_members hm
                 where hm.household_id = h.id and hm.status = 'active') m
          left join public.person_profiles p on p.household_id = h.id and p.user_id = m.user_id), '[]'::jsonb),
      'exclusions', v_usable,
      'withheldExclusions', v_withheld)
    from public.households h where h.id = p_household_id
  );
end
$$;
revoke all on function public.planner_household_profile(uuid) from public;
grant execute on function public.planner_household_profile(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- household_ai_settings: one row per household. The API keys are AES-256-GCM ciphertexts produced by the app server
-- with APP_SECRET (AAD = household + provider); the database never sees a plaintext key and APP_SECRET never leaves
-- the server. No table grants at all: reads and writes go through the two functions below.
--   get_household_ai_settings  any active member (the server needs the ciphertext to call the provider for any member)
--   save_household_ai_settings owner of an ACTIVE household only (grace period = read-only)
-- ---------------------------------------------------------------------------
create table public.household_ai_settings (
  household_id  uuid primary key references public.households (id) on delete cascade,
  provider      text not null check (provider in ('mock', 'openai', 'azure', 'anthropic')),
  config        jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),   -- non-secret: base URL, model, deployment...
  keys          jsonb not null default '{}'::jsonb check (jsonb_typeof(keys) = 'object'),     -- {provider: {enc, hint}}
  updated_by    uuid references auth.users (id) on delete set null,
  updated_at    timestamptz not null default now()
);
alter table public.household_ai_settings enable row level security;
revoke all on public.household_ai_settings from anon, authenticated;

create or replace function public.get_household_ai_settings(p_household_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select case when auth.uid() is not null and public.is_household_member(p_household_id) then (
    select jsonb_build_object('provider', s.provider, 'config', s.config, 'keys', s.keys, 'updatedAt', s.updated_at)
      from public.household_ai_settings s where s.household_id = p_household_id) end
$$;

create or replace function public.save_household_ai_settings(p_household_id uuid, p_provider text, p_config jsonb, p_keys jsonb)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare k text;
begin
  if auth.uid() is null or not public.is_household_owner(p_household_id) or not public.household_is_active(p_household_id) then
    raise exception 'only the owner of an active household can change AI settings' using errcode = 'insufficient_privilege';
  end if;
  if jsonb_typeof(p_config) is distinct from 'object' or jsonb_typeof(p_keys) is distinct from 'object' then
    raise exception 'malformed settings' using errcode = 'invalid_parameter_value';
  end if;
  for k in select jsonb_object_keys(p_keys) loop
    if k not in ('openai', 'azure', 'anthropic')
       or (p_keys -> k ->> 'enc') !~ '^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$' then
      -- only ciphertext blobs are accepted, so a plaintext key can never be stored by mistake
      raise exception 'keys must be encrypted blobs' using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  insert into public.household_ai_settings as s (household_id, provider, config, keys, updated_by, updated_at)
  values (p_household_id, p_provider, p_config, p_keys, auth.uid(), now())
  on conflict (household_id) do update set
    provider = excluded.provider, config = excluded.config, keys = excluded.keys,
    updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end
$$;

revoke all on function public.get_household_ai_settings(uuid) from public;
revoke all on function public.save_household_ai_settings(uuid, text, jsonb, jsonb) from public;
grant execute on function public.get_household_ai_settings(uuid) to authenticated;
grant execute on function public.save_household_ai_settings(uuid, text, jsonb, jsonb) to authenticated;
