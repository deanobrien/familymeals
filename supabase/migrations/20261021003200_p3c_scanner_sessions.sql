-- PRJ-018 P3-C (D447-D449): "use my phone as the scanner" for a desktop session (the D275 design, now built). Additive only.
--
--   scanner_sessions  one row per desktop session: bound to a household and the user who started it, expires in at most 10
--                     minutes, can be revoked, and accepts pushes from ONE phone (the first to connect claims it). Only the
--                     SHA-256 of the pairing token is stored; the raw token travels once, in the QR code's URL fragment.
--   scanner_items     what the phone pushed: barcodes (a counted read) or photo markers. Idempotent per (session, client_id).
--   scanner_photos    the photo bytes, kept apart so Realtime never ships them (max 2 MB each, 10 per session).
--
-- The phone is NOT signed in: it holds a capability (session id + token). It can only call the SECURITY DEFINER functions
-- scanner_connect / scanner_push, which validate token, expiry, revocation, device claim, rate and size caps themselves. Tables
-- have no policy for anon at all. The desktop user reads rows through RLS (creator only) and Supabase Realtime (a hint; the
-- page also polls). NOTHING here touches the pantry: the desktop review decides what to add.
--
-- Realtime: scanner_items joins the supabase_realtime publication (guarded like the shopping log).

create table public.scanner_sessions (
  id              uuid primary key default gen_random_uuid(),
  household_id    uuid not null references public.households (id) on delete cascade,
  user_id         uuid not null references auth.users (id) on delete cascade,
  purpose         text not null check (purpose in ('pantry', 'receipt')),
  token_hash      text not null check (token_hash ~ '^[0-9a-f]{64}$'),
  device_hash     text check (device_hash is null or device_hash ~ '^[0-9a-f]{64}$'),
  expires_at      timestamptz not null,
  revoked_at      timestamptz,
  connected_at    timestamptz,
  last_push_at    timestamptz,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  item_count      integer not null default 0 check (item_count >= 0),
  photo_count     integer not null default 0 check (photo_count >= 0),
  created_at      timestamptz not null default now(),
  check (expires_at <= created_at + interval '10 minutes 5 seconds')
);
create index scanner_sessions_user_idx on public.scanner_sessions (user_id, created_at desc);
create index scanner_sessions_expiry_idx on public.scanner_sessions (expires_at);

create table public.scanner_items (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references public.scanner_sessions (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  seq          bigint generated always as identity,
  client_id    text not null check (char_length(client_id) between 8 and 64),
  kind         text not null check (kind in ('barcode', 'photo')),
  barcode      text check (barcode is null or barcode ~ '^([0-9]{8}|[0-9]{13})$'),
  count        integer not null default 1 check (count between 1 and 99),
  created_at   timestamptz not null default now(),
  unique (session_id, client_id),
  check ((kind = 'barcode' and barcode is not null) or (kind = 'photo' and barcode is null))
);
create index scanner_items_session_idx on public.scanner_items (session_id, seq);

create table public.scanner_photos (
  item_id    uuid primary key references public.scanner_items (id) on delete cascade,
  session_id uuid not null references public.scanner_sessions (id) on delete cascade,
  mime       text not null check (mime in ('image/jpeg', 'image/png', 'image/webp')),
  bytes      bytea not null check (octet_length(bytes) between 1 and 2000000)
);
create index scanner_photos_session_idx on public.scanner_photos (session_id);

alter table public.scanner_sessions enable row level security;
alter table public.scanner_items enable row level security;
alter table public.scanner_photos enable row level security;
revoke all on public.scanner_sessions, public.scanner_items, public.scanner_photos from anon, authenticated;
grant select on public.scanner_sessions, public.scanner_items, public.scanner_photos to authenticated;

-- The user who started the session reads it (and only while still an active member of the household). No insert / update /
-- delete policies exist: every write goes through the functions below.
create policy scanner_sessions_select on public.scanner_sessions for select to authenticated
  using (user_id = auth.uid() and public.is_household_member(household_id));
create policy scanner_items_select on public.scanner_items for select to authenticated
  using (exists (select 1 from public.scanner_sessions s
                  where s.id = scanner_items.session_id and s.user_id = auth.uid() and public.is_household_member(s.household_id)));
create policy scanner_photos_select on public.scanner_photos for select to authenticated
  using (exists (select 1 from public.scanner_sessions s
                  where s.id = scanner_photos.session_id and s.user_id = auth.uid() and public.is_household_member(s.household_id)));

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.scanner_items;
  end if;
end
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Desktop side (signed in): create / revoke / release the phone / read a photo.
-- ---------------------------------------------------------------------------------------------------------------------

-- Starts a session: the caller must be an active member of an active household. At most 20 sessions per user per hour; any
-- earlier session of this user is revoked (one scanner session at a time) and its items and photos deleted.
create or replace function public.scanner_session_create(p_household_id uuid, p_purpose text, p_token_hash text, p_ttl_seconds integer default 600)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_exp timestamptz;
begin
  if v_user is null or not public.is_household_writable(p_household_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;
  if p_purpose is null or p_purpose not in ('pantry', 'receipt') then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;
  if (select count(*) from public.scanner_sessions s where s.user_id = v_user and s.created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  update public.scanner_sessions set revoked_at = now() where user_id = v_user and revoked_at is null and expires_at > now();
  delete from public.scanner_items where session_id in (select id from public.scanner_sessions where user_id = v_user and revoked_at is not null);
  v_exp := now() + make_interval(secs => greatest(60, least(coalesce(p_ttl_seconds, 600), 600)));
  insert into public.scanner_sessions (household_id, user_id, purpose, token_hash, expires_at)
  values (p_household_id, v_user, p_purpose, p_token_hash, v_exp)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'expiresAt', v_exp);
end
$$;

-- Ends a session now and deletes what the phone sent (photos included). Called on "Disconnect" and after the review is confirmed.
create or replace function public.scanner_session_revoke(p_session_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update public.scanner_sessions set revoked_at = coalesce(revoked_at, now()) where id = p_session_id and user_id = v_user;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  delete from public.scanner_items where session_id = p_session_id;
  return jsonb_build_object('ok', true);
end
$$;

-- Lets a different phone take over (the first one lost its page, or it was the wrong phone): clears the device claim.
create or replace function public.scanner_session_release(p_session_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then return jsonb_build_object('ok', false, 'error', 'forbidden'); end if;
  update public.scanner_sessions set device_hash = null, connected_at = null
   where id = p_session_id and user_id = v_user and revoked_at is null and expires_at > now();
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end
$$;

-- One photo as base64 (the desktop review feeds it to the same pipeline as a file the user chose). RLS applies (SECURITY INVOKER).
create or replace function public.scanner_photo(p_item_id uuid)
returns jsonb
language sql stable
set search_path = ''
as $$
  select coalesce((select jsonb_build_object('mime', p.mime, 'base64', encode(p.bytes, 'base64')) from public.scanner_photos p where p.item_id = p_item_id), 'null'::jsonb)
$$;

-- ---------------------------------------------------------------------------------------------------------------------
-- Phone side (not signed in): capability = session id + token.
-- ---------------------------------------------------------------------------------------------------------------------

-- Checks id + token + device. Returns 'ok' (and the session row through p_row) or an error code. Wrong id and wrong token look the
-- same ('invalid'); ten wrong tokens against a real session revoke it. Internal: not callable by clients.
create or replace function public.scanner_validate(p_session_id uuid, p_token text, p_device text, p_claim boolean)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  s public.scanner_sessions;
  v_hash text := encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex');
  v_dev text;
begin
  if p_session_id is null or p_token is null or char_length(p_token) < 20 or char_length(p_token) > 128
     or p_device is null or char_length(p_device) < 16 or char_length(p_device) > 128 then
    return 'invalid';
  end if;
  select * into s from public.scanner_sessions where id = p_session_id;
  if not found then return 'invalid'; end if;
  if s.token_hash <> v_hash then
    update public.scanner_sessions
       set failed_attempts = failed_attempts + 1,
           revoked_at = case when failed_attempts + 1 >= 10 then coalesce(revoked_at, now()) else revoked_at end
     where id = s.id;
    return 'invalid';
  end if;
  if s.revoked_at is not null then return 'revoked'; end if;
  if s.expires_at <= now() then return 'expired'; end if;
  -- The session's creator must still be an active member of an active household.
  if not exists (select 1 from public.household_members m join public.households h on h.id = m.household_id
                  where m.household_id = s.household_id and m.user_id = s.user_id and m.status = 'active' and h.status = 'active') then
    return 'revoked';
  end if;
  v_dev := encode(sha256(convert_to(p_device, 'UTF8')), 'hex');
  if s.device_hash is not null and s.device_hash <> v_dev then return 'scanner_in_use'; end if;
  if s.device_hash is null and p_claim then
    update public.scanner_sessions set device_hash = v_dev, connected_at = now() where id = s.id;
  end if;
  return 'ok';
end
$$;

create or replace function public.scanner_connect(p_session_id uuid, p_token text, p_device text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_res text := public.scanner_validate(p_session_id, p_token, p_device, true);
  s public.scanner_sessions;
begin
  if v_res <> 'ok' then return jsonb_build_object('ok', false, 'error', v_res); end if;
  select * into s from public.scanner_sessions where id = p_session_id;
  return jsonb_build_object('ok', true, 'purpose', s.purpose, 'expiresAt', s.expires_at, 'itemCount', s.item_count);
end
$$;

-- Pushes one barcode (counted read) or one photo. Idempotent per client_id (a retried push is acknowledged, never duplicated).
-- Caps: 120 pushes per minute, 300 items and 10 photos per session, 1.5 MB per photo (2 MB decoded is the hard table limit).
create or replace function public.scanner_push(
  p_session_id uuid, p_token text, p_device text, p_client_id text, p_kind text,
  p_barcode text default null, p_count integer default 1, p_photo_b64 text default null, p_mime text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_res text := public.scanner_validate(p_session_id, p_token, p_device, true);
  s public.scanner_sessions;
  v_item uuid;
  v_bytes bytea;
begin
  if v_res <> 'ok' then return jsonb_build_object('ok', false, 'error', v_res); end if;
  if p_client_id is null or char_length(p_client_id) not between 8 and 64 or p_kind is null or p_kind not in ('barcode', 'photo') then
    return jsonb_build_object('ok', false, 'error', 'invalid_input');
  end if;
  select * into s from public.scanner_sessions where id = p_session_id for update;
  if exists (select 1 from public.scanner_items where session_id = s.id and client_id = p_client_id) then
    return jsonb_build_object('ok', true, 'duplicate', true, 'itemCount', s.item_count);
  end if;
  if (select count(*) from public.scanner_items where session_id = s.id and created_at > now() - interval '1 minute') >= 120 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  if s.item_count >= 300 then return jsonb_build_object('ok', false, 'error', 'session_full'); end if;

  if p_kind = 'barcode' then
    if p_barcode is null or p_barcode !~ '^([0-9]{8}|[0-9]{13})$' or p_count is null or p_count not between 1 and 99 then
      return jsonb_build_object('ok', false, 'error', 'invalid_input');
    end if;
    insert into public.scanner_items (session_id, household_id, client_id, kind, barcode, count)
    values (s.id, s.household_id, p_client_id, 'barcode', p_barcode, p_count) returning id into v_item;
  else
    if s.photo_count >= 10 then return jsonb_build_object('ok', false, 'error', 'too_many_photos'); end if;
    if p_photo_b64 is null or char_length(p_photo_b64) > 2100000 or p_mime is null or p_mime not in ('image/jpeg', 'image/png', 'image/webp') then
      return jsonb_build_object('ok', false, 'error', 'invalid_input');
    end if;
    begin
      v_bytes := decode(p_photo_b64, 'base64');
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'invalid_input');
    end;
    if octet_length(v_bytes) not between 1 and 1572864 then return jsonb_build_object('ok', false, 'error', 'photo_too_large'); end if;
    insert into public.scanner_items (session_id, household_id, client_id, kind, count)
    values (s.id, s.household_id, p_client_id, 'photo', 1) returning id into v_item;
    insert into public.scanner_photos (item_id, session_id, mime, bytes) values (v_item, s.id, p_mime, v_bytes);
    update public.scanner_sessions set photo_count = photo_count + 1 where id = s.id;
  end if;
  update public.scanner_sessions set item_count = item_count + 1, last_push_at = now() where id = s.id;
  return jsonb_build_object('ok', true, 'duplicate', false, 'itemCount', s.item_count + 1);
end
$$;

-- Housekeeping (service role, from the scheduled purge job): sessions are useless an hour after they expired.
create or replace function public.scanner_purge_expired()
returns integer
language plpgsql security definer
set search_path = ''
as $$
declare v_n integer;
begin
  delete from public.scanner_sessions where expires_at < now() - interval '1 hour';
  get diagnostics v_n = row_count;
  return v_n;
end
$$;

revoke all on function public.scanner_session_create(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.scanner_session_revoke(uuid) from public, anon, authenticated;
revoke all on function public.scanner_session_release(uuid) from public, anon, authenticated;
revoke all on function public.scanner_photo(uuid) from public, anon, authenticated;
revoke all on function public.scanner_validate(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.scanner_connect(uuid, text, text) from public, anon, authenticated;
revoke all on function public.scanner_push(uuid, text, text, text, text, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.scanner_purge_expired() from public, anon, authenticated;
grant execute on function public.scanner_session_create(uuid, text, text, integer) to authenticated;
grant execute on function public.scanner_session_revoke(uuid) to authenticated;
grant execute on function public.scanner_session_release(uuid) to authenticated;
grant execute on function public.scanner_photo(uuid) to authenticated;
grant execute on function public.scanner_connect(uuid, text, text) to anon, authenticated;
grant execute on function public.scanner_push(uuid, text, text, text, text, text, integer, text, text) to anon, authenticated;
grant execute on function public.scanner_purge_expired() to service_role;
