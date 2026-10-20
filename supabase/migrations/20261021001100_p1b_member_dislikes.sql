-- PRJ-018 P1-B (DECISIONS D378): per-person SOFT dislikes ("Sam doesn't like mushrooms").
--
-- A dislike is a mild preference, never an allergy: it is NOT health data, needs no consent, and is never confused with
-- household_exclusions (hard exclusions). The planner only penalises it, Discover only sorts it lower, nothing is ever
-- filtered out because of it. Visible to every household member (so the planner chips can show it); each member edits
-- their own list, and the household owner can edit anyone's (e.g. for a family member who rarely uses the app).
-- (household_id, member_user_id) is a composite FK to household_members, so removing a member removes their dislikes.
-- Writes go through set_member_dislikes() (replace the whole list atomically, as the invoking user so RLS decides).

create table public.member_dislikes (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households (id) on delete cascade,
  member_user_id  uuid not null,
  -- Lower-case free text matched against ingredient names (never an allergen, so no ingredient_id / consent columns).
  term            text not null check (char_length(btrim(term)) between 1 and 60 and term = lower(btrim(term))),
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  foreign key (household_id, member_user_id) references public.household_members (household_id, user_id) on delete cascade
);
create unique index member_dislikes_term_uq on public.member_dislikes (household_id, member_user_id, term);
create index member_dislikes_household_idx on public.member_dislikes (household_id);

alter table public.member_dislikes enable row level security;
revoke all on public.member_dislikes from anon;
grant select, insert, update, delete on public.member_dislikes to authenticated;

create policy member_dislikes_member_select on public.member_dislikes for select to authenticated
  using (public.is_household_member(household_id));
-- Own list, or any list when the caller owns the household; both only while the household is writable (not pending deletion).
create policy member_dislikes_write_insert on public.member_dislikes for insert to authenticated
  with check (public.is_household_writable(household_id) and (member_user_id = auth.uid() or public.is_household_owner(household_id)));
create policy member_dislikes_write_update on public.member_dislikes for update to authenticated
  using (public.is_household_writable(household_id) and (member_user_id = auth.uid() or public.is_household_owner(household_id)))
  with check (public.is_household_writable(household_id) and (member_user_id = auth.uid() or public.is_household_owner(household_id)));
create policy member_dislikes_write_delete on public.member_dislikes for delete to authenticated
  using (public.is_household_writable(household_id) and (member_user_id = auth.uid() or public.is_household_owner(household_id)));

-- Replace one member's whole list. SECURITY INVOKER: the policies above are the authority (a refused row raises 42501).
create or replace function public.set_member_dislikes(p_household_id uuid, p_member_user_id uuid, p_terms text[])
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_terms text[];
  v_count integer;
begin
  select coalesce(array_agg(distinct lower(btrim(t))) filter (where btrim(t) <> ''), '{}')
    into v_terms from unnest(coalesce(p_terms, '{}')) as t;
  if cardinality(v_terms) > 30 then
    raise exception 'too many dislikes' using errcode = '22023';
  end if;
  delete from public.member_dislikes where household_id = p_household_id and member_user_id = p_member_user_id;
  insert into public.member_dislikes (household_id, member_user_id, term)
    select p_household_id, p_member_user_id, t from unnest(v_terms) as t;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;
revoke all on function public.set_member_dislikes(uuid, uuid, text[]) from public;
grant execute on function public.set_member_dislikes(uuid, uuid, text[]) to authenticated;
