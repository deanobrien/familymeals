-- RLS test helpers (plain-SQL asserts; no pgTAP dependency). Run as a superuser after the migrations.
-- Each test file wraps itself in BEGIN ... ROLLBACK so files are independent and leave no data behind.
-- Usage inside a test:
--   select tests.act_as('<uuid>');       -- become `authenticated` with that JWT sub (transaction-local)
--   select tests.act_as_anon();
--   select tests.reset_actor();          -- back to the superuser session role
--   select tests.ok(<bool>, 'message');
--   select tests.is(<actual>, <expected>, 'message');      -- bigint compare
--   select tests.throws($$ <sql> $$, '<sqlstate or null>', 'message');

create schema if not exists tests;
grant usage on schema tests to anon, authenticated, service_role;

create or replace function tests.act_as(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create or replace function tests.act_as_anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end $$;

create or replace function tests.reset_actor() returns void language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is not true then
    raise exception 'ASSERTION FAILED: %', p_msg;
  end if;
end $$;

create or replace function tests.is(p_actual bigint, p_expected bigint, p_msg text) returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ASSERTION FAILED: % (expected %, got %)', p_msg, p_expected, p_actual;
  end if;
end $$;

-- Executes p_sql (as the CURRENT role) and asserts it raises. p_state NULL = any error.
create or replace function tests.throws(p_sql text, p_state text, p_msg text) returns void language plpgsql as $$
declare v_state text;
begin
  begin
    execute p_sql;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
    if p_state is not null and v_state <> p_state then
      raise exception 'ASSERTION FAILED: % (expected SQLSTATE %, got %: %)', p_msg, p_state, v_state, sqlerrm;
    end if;
    return;
  end;
  raise exception 'ASSERTION FAILED: % (statement succeeded, expected error)', p_msg;
end $$;

-- Row count affected by a DML statement run as the current role (RLS-filtered UPDATE/DELETE -> 0, no error).
create or replace function tests.affected(p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on all functions in schema tests to anon, authenticated, service_role;

-- Fixed fixture identities shared by test files.
--   alice  a0000000-...-0001  owner of household HA (aa..)
--   carol  c0000000-...-0003  invited member of HA
--   bob    b0000000-...-0002  owner of household HB (bb..), outsider to HA
