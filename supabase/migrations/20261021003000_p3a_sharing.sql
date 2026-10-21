-- PRJ-018 P3-A shared family cookbook (D420-D424).
--   recipe_shares            a link a household gives to another household: one recipe or a collection, optional expiry, revocable
--   recipe_share_items       which recipes the sharer chose (nothing else is ever readable through the share)
--   recipe_share_recipients  a signed-in person who opened the share (their own row only; the sharer sees a COUNT, never who)
--   recipes.source_share_id  "saved from a share" provenance on the recipient's copy
-- The link carries an unguessable token (two v4 UUIDs, ~244 random bits, shown once); only sha256(token) is stored, like invitations.
-- Another household reads through SECURITY DEFINER RPCs that take the token and return ONLY a whitelisted view of the chosen
-- recipes: never notes, ratings, favourites, cooking history, versions / original photos or any household / user id. Any invalid,
-- unknown, expired or revoked token answers NULL (one generic outcome: no enumeration). Images: a storage policy lets a person who
-- opened a LIVE share read just the cover objects of that share's recipes (revoking or expiry closes it at once).
-- Deletion revokes: a household entering pending_deletion revokes every share; a member leaving revokes the shares they made.

create table public.recipe_shares (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households (id) on delete cascade,
  created_by     uuid references auth.users (id) on delete set null default auth.uid(),
  scope          text not null check (scope in ('recipe', 'collection')),
  title          text check (title is null or char_length(btrim(title)) between 1 and 80),
  token_hash     text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  -- off by default: only when the sharer ticks it may a signed-out visitor read the recipes (text only, no photos)
  public_preview boolean not null default false,
  expires_at     timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz not null default now(),
  unique (id, household_id),
  check (scope = 'recipe' or title is not null),
  check (expires_at is null or expires_at > created_at)
);
create index recipe_shares_household_idx on public.recipe_shares (household_id, created_at desc);

create table public.recipe_share_items (
  share_id     uuid not null,
  recipe_id    uuid not null,
  household_id uuid not null,
  position     smallint not null check (position between 0 and 49),
  primary key (share_id, recipe_id),
  foreign key (share_id, household_id) references public.recipe_shares (id, household_id) on delete cascade,
  foreign key (recipe_id, household_id) references public.recipes (id, household_id) on delete cascade
);
create index recipe_share_items_recipe_idx on public.recipe_share_items (recipe_id);

create table public.recipe_share_recipients (
  share_id        uuid not null references public.recipe_shares (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  first_opened_at timestamptz not null default now(),
  last_opened_at  timestamptz not null default now(),
  saved_count     integer not null default 0 check (saved_count >= 0),
  primary key (share_id, user_id)
);
create index recipe_share_recipients_user_idx on public.recipe_share_recipients (user_id);

alter table public.recipes add column source_share_id uuid references public.recipe_shares (id) on delete set null;

alter table public.recipe_shares enable row level security;
alter table public.recipe_share_items enable row level security;
alter table public.recipe_share_recipients enable row level security;
revoke all on public.recipe_shares, public.recipe_share_items, public.recipe_share_recipients from anon, authenticated;
-- Reads only: every write goes through the RPCs below (which check the household and validate the recipes).
grant select on public.recipe_shares, public.recipe_share_items, public.recipe_share_recipients to authenticated;

create policy recipe_shares_select on public.recipe_shares for select to authenticated
  using (public.is_household_member(household_id));
create policy recipe_share_items_select on public.recipe_share_items for select to authenticated
  using (public.is_household_member(household_id));
create policy recipe_share_recipients_select on public.recipe_share_recipients for select to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- A share is live when it is not revoked, not expired and its household is not pending deletion.
-- ---------------------------------------------------------------------------
create or replace function public.share_is_live(p_share_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.recipe_shares s join public.households h on h.id = s.household_id
     where s.id = p_share_id and s.revoked_at is null and (s.expires_at is null or s.expires_at > now()) and h.status = 'active'
  )
$$;
revoke all on function public.share_is_live(uuid) from public, anon, authenticated;

-- The whitelisted, share-safe view of one recipe. Deliberately builds a NEW object field by field.
create or replace function public.share_recipe_doc(p_recipe_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', r.id,
    'title', r.title,
    'description', coalesce(r.description, ''),
    'source_url', coalesce(r.source_url, ''),
    'source_attribution', coalesce(r.source_attribution, ''),
    'prep_minutes', r.prep_minutes,
    'cook_minutes', r.cook_minutes,
    'default_servings', r.default_servings,
    'cuisine', coalesce(r.cuisine, ''),
    'meal_type', r.meal_type,
    'diet_category', r.diet_category,
    'has_cover', r.cover_image_path is not null,
    'tags', coalesce((select jsonb_agg(t.name order by t.name)
                        from public.recipe_tag_links l join public.recipe_tags t on t.id = l.tag_id
                       where l.recipe_id = r.id), '[]'::jsonb),
    'ingredients', coalesce((select jsonb_agg(jsonb_build_object(
                      'display_name', ri.display_name, 'original_text', ri.original_text, 'ingredient_id', ri.ingredient_id,
                      'quantity_kind', ri.quantity_kind, 'quantity_value', ri.quantity_value, 'quantity_min', ri.quantity_min,
                      'quantity_max', ri.quantity_max, 'unit', ri.unit, 'approx_label', ri.approx_label,
                      'preparation', ri.preparation, 'optional', ri.optional, 'position', ri.position) order by ri.position)
                      from public.recipe_ingredients ri where ri.recipe_id = r.id), '[]'::jsonb),
    'steps', coalesce((select jsonb_agg(jsonb_build_object('step_number', s.step_number, 'instructions', s.instructions)
                                        order by s.step_number)
                         from public.recipe_steps s where s.recipe_id = r.id), '[]'::jsonb)
  )
  from public.recipes r where r.id = p_recipe_id
$$;
revoke all on function public.share_recipe_doc(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_recipe_share: any WRITABLE member of the household. Returns the raw token once.
-- ---------------------------------------------------------------------------
create or replace function public.create_recipe_share(
  p_household_id uuid,
  p_scope text,
  p_title text,
  p_recipe_ids uuid[],
  p_ttl interval default null,
  p_public_preview boolean default false
) returns table (share_id uuid, token text, expires_at timestamptz)
language plpgsql security definer
set search_path = ''
as $$
declare
  v_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  v_id uuid := gen_random_uuid();
  v_exp timestamptz;
  v_ids uuid[] := (select coalesce(array_agg(distinct x), '{}') from unnest(coalesce(p_recipe_ids, '{}')) x);
  v_found integer;
begin
  if auth.uid() is null or not public.is_household_writable(p_household_id) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  if p_scope not in ('recipe', 'collection') then
    raise exception 'invalid scope' using errcode = 'invalid_parameter_value';
  end if;
  if (p_scope = 'recipe' and cardinality(v_ids) <> 1) or (p_scope = 'collection' and cardinality(v_ids) not between 1 and 50) then
    raise exception 'invalid recipe selection' using errcode = 'invalid_parameter_value';
  end if;
  select count(*) into v_found from public.recipes r
   where r.household_id = p_household_id and r.id = any (v_ids) and r.status <> 'archived';
  if v_found <> cardinality(v_ids) then
    raise exception 'recipe not found' using errcode = 'invalid_parameter_value';
  end if;
  if (select count(*) from public.recipe_shares s where s.household_id = p_household_id and s.revoked_at is null) >= 200 then
    raise exception 'too many active shares' using errcode = 'invalid_parameter_value';
  end if;
  if p_ttl is not null then
    if p_ttl <= interval '0' or p_ttl > interval '365 days' then
      raise exception 'invalid expiry' using errcode = 'invalid_parameter_value';
    end if;
    v_exp := now() + p_ttl;
  end if;
  insert into public.recipe_shares (id, household_id, created_by, scope, title, token_hash, public_preview, expires_at)
  values (v_id, p_household_id, auth.uid(), p_scope,
          case when p_scope = 'collection' then left(btrim(p_title), 80) else null end,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), coalesce(p_public_preview, false), v_exp);
  insert into public.recipe_share_items (share_id, recipe_id, household_id, position)
  select v_id, x.id, p_household_id, (x.n - 1)::smallint
    from unnest(case when p_recipe_ids is null then '{}'::uuid[] else p_recipe_ids end) with ordinality as x(id, n)
   where x.id = any (v_ids)
   on conflict do nothing;
  return query select v_id, v_token, v_exp;
end
$$;

create or replace function public.revoke_recipe_share(p_share_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare v_hh uuid;
begin
  select household_id into v_hh from public.recipe_shares where id = p_share_id;
  if v_hh is null or auth.uid() is null or not public.is_household_writable(v_hh) then
    return false; -- the same answer for "not yours" and "not there"
  end if;
  update public.recipe_shares set revoked_at = now() where id = p_share_id and revoked_at is null;
  return true;
end
$$;

-- The household's shares for the "Shared" list: counts only (never who opened or saved).
create or replace function public.list_recipe_shares(p_household_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_household_member(p_household_id) then
    raise exception 'not allowed' using errcode = 'insufficient_privilege';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id, 'scope', s.scope, 'title', s.title, 'created_at', s.created_at, 'expires_at', s.expires_at, 'revoked_at', s.revoked_at,
      'public_preview', s.public_preview, 'created_by_me', s.created_by = auth.uid(),
      'recipes', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title) order by i.position)
                             from public.recipe_share_items i join public.recipes r on r.id = i.recipe_id where i.share_id = s.id), '[]'::jsonb),
      'opened_by', (select count(*) from public.recipe_share_recipients p where p.share_id = s.id),
      'saved', (select coalesce(sum(p.saved_count), 0) from public.recipe_share_recipients p where p.share_id = s.id)
    ) order by s.created_at desc)
      from public.recipe_shares s where s.household_id = p_household_id), '[]'::jsonb);
end
$$;

-- ---------------------------------------------------------------------------
-- read_recipe_share: the preview. Anyone with the token (signed in or not). NULL for every kind of invalid token.
--   signed out, public_preview off  -> minimal {minimal: true, title, shared_by, recipe_count}
--   signed out, public_preview on   -> the recipes, no recipient row (and the app shows no photos)
--   signed in                       -> the recipes; the person is recorded as a recipient so Storage lets them read the covers
-- ---------------------------------------------------------------------------
create or replace function public.read_recipe_share(p_token text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_s public.recipe_shares%rowtype;
  v_uid uuid := auth.uid();
  v_by text;
  v_count integer;
  v_recipes jsonb;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into v_s from public.recipe_shares where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found or not public.share_is_live(v_s.id) then
    return null;
  end if;
  select nullif(btrim(m.display_name), '') into v_by from public.household_members m
   where m.household_id = v_s.household_id and m.user_id = v_s.created_by;
  select count(*) into v_count from public.recipe_share_items i join public.recipes r on r.id = i.recipe_id
   where i.share_id = v_s.id and r.status <> 'archived';
  if v_uid is null and not v_s.public_preview then
    return jsonb_build_object('minimal', true, 'scope', v_s.scope, 'title', v_s.title, 'shared_by', v_by, 'recipe_count', v_count);
  end if;
  select coalesce(jsonb_agg(public.share_recipe_doc(r.id) order by i.position), '[]'::jsonb) into v_recipes
    from public.recipe_share_items i join public.recipes r on r.id = i.recipe_id
   where i.share_id = v_s.id and r.status <> 'archived';
  if v_uid is not null and not public.is_household_member(v_s.household_id) then
    insert into public.recipe_share_recipients (share_id, user_id) values (v_s.id, v_uid)
    on conflict (share_id, user_id) do update set last_opened_at = now();
  end if;
  return jsonb_build_object('minimal', false, 'scope', v_s.scope, 'title', v_s.title, 'shared_by', v_by,
                            'recipe_count', v_count, 'expires_at', v_s.expires_at, 'recipes', v_recipes,
                            'signed_in', v_uid is not null, 'own', v_uid is not null and public.is_household_member(v_s.household_id));
end
$$;

-- The cover object path of one recipe in a live share, for the signed-in recipient's image proxy and copy. NULL otherwise.
create or replace function public.share_cover_ref(p_token text, p_recipe_id uuid)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_s public.recipe_shares%rowtype;
  v_path text;
begin
  if auth.uid() is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into v_s from public.recipe_shares where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found or not public.share_is_live(v_s.id) then
    return null;
  end if;
  select r.cover_image_path into v_path from public.recipe_share_items i join public.recipes r on r.id = i.recipe_id
   where i.share_id = v_s.id and i.recipe_id = p_recipe_id and r.status <> 'archived';
  if v_path is null then
    return null;
  end if;
  if not public.is_household_member(v_s.household_id) then
    insert into public.recipe_share_recipients (share_id, user_id) values (v_s.id, auth.uid())
    on conflict (share_id, user_id) do update set last_opened_at = now();
  end if;
  return v_path;
end
$$;

-- "Save a copy": the server creates the recipient's recipe through the normal repository from the share-safe view, then records
-- where it came from. The recipe must be the caller's own, new, and in a household they can write to.
create or replace function public.record_share_save(p_token text, p_source_recipe_id uuid, p_new_recipe_id uuid)
returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare
  v_s public.recipe_shares%rowtype;
  v_hh uuid;
begin
  if auth.uid() is null or p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  select * into v_s from public.recipe_shares where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
  if not found or not public.share_is_live(v_s.id)
     or not exists (select 1 from public.recipe_share_items i where i.share_id = v_s.id and i.recipe_id = p_source_recipe_id) then
    return false;
  end if;
  select household_id into v_hh from public.recipes where id = p_new_recipe_id and created_by = auth.uid() and source_share_id is null;
  if v_hh is null or not public.is_household_writable(v_hh) then
    return false;
  end if;
  update public.recipes set source_share_id = v_s.id where id = p_new_recipe_id;
  insert into public.recipe_share_recipients (share_id, user_id, saved_count) values (v_s.id, auth.uid(), 1)
  on conflict (share_id, user_id) do update set saved_count = public.recipe_share_recipients.saved_count + 1, last_opened_at = now();
  return true;
end
$$;

-- Storage: a person who opened a live share may read the COVER object of its recipes (and nothing else of the sharer's).
create or replace function public.share_image_visible(p_name text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1
      from public.recipe_share_recipients p
      join public.recipe_share_items i on i.share_id = p.share_id
      join public.recipes r on r.id = i.recipe_id
     where p.user_id = auth.uid() and r.cover_image_path = p_name and r.status <> 'archived' and public.share_is_live(p.share_id)
  )
$$;
revoke all on function public.share_image_visible(text) from public, anon;
grant execute on function public.share_image_visible(text) to authenticated;

create policy fr_share_recipient_cover_select on storage.objects for select to authenticated
  using (bucket_id = 'recipe-images' and public.share_image_visible(name));

-- Deletion revokes shares (D424): a household going into its deletion grace period, and a member who leaves, whose shares die with them.
create or replace function public.revoke_shares_on_household_deletion()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if new.status = 'pending_deletion' and old.status is distinct from new.status then
    update public.recipe_shares set revoked_at = now() where household_id = new.id and revoked_at is null;
  end if;
  return new;
end
$$;
create trigger households_revoke_shares after update of status on public.households
  for each row execute function public.revoke_shares_on_household_deletion();

create or replace function public.revoke_shares_on_member_exit()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_hh uuid := case when tg_op = 'DELETE' then old.household_id else new.household_id end;
  v_uid uuid := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
begin
  if tg_op = 'DELETE' or (new.status <> 'active' and old.status = 'active') then
    update public.recipe_shares set revoked_at = now() where household_id = v_hh and created_by = v_uid and revoked_at is null;
  end if;
  return coalesce(new, old);
end
$$;
create trigger household_members_revoke_shares after update of status or delete on public.household_members
  for each row execute function public.revoke_shares_on_member_exit();

revoke all on function public.create_recipe_share(uuid, text, text, uuid[], interval, boolean) from public, anon;
revoke all on function public.revoke_recipe_share(uuid) from public, anon;
revoke all on function public.list_recipe_shares(uuid) from public, anon;
revoke all on function public.read_recipe_share(text) from public;
revoke all on function public.share_cover_ref(text, uuid) from public, anon;
revoke all on function public.record_share_save(text, uuid, uuid) from public, anon;
revoke all on function public.revoke_shares_on_household_deletion() from public, anon, authenticated;
revoke all on function public.revoke_shares_on_member_exit() from public, anon, authenticated;
grant execute on function public.create_recipe_share(uuid, text, text, uuid[], interval, boolean) to authenticated;
grant execute on function public.revoke_recipe_share(uuid) to authenticated;
grant execute on function public.list_recipe_shares(uuid) to authenticated;
grant execute on function public.read_recipe_share(text) to anon, authenticated;
grant execute on function public.share_cover_ref(text, uuid) to authenticated;
grant execute on function public.record_share_save(text, uuid, uuid) to authenticated;
