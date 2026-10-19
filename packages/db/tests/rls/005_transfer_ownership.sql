-- transfer_ownership(): atomic owner -> member swap; refused for non-owners, bad targets, self, and during the grace period.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'alice@example.test'),
  ('b0000000-0000-4000-8000-000000000002', 'bob@example.test'),
  ('c0000000-0000-4000-8000-000000000003', 'carol@example.test'),
  ('d0000000-0000-4000-8000-000000000004', 'dave@example.test'),
  ('e0000000-0000-4000-8000-000000000005', 'erin@example.test');
insert into public.households (id, name, created_by) values
  ('aa000000-0000-4000-8000-0000000000aa', 'Alice home', 'a0000000-0000-4000-8000-000000000001'),
  ('bb000000-0000-4000-8000-0000000000bb', 'Bob home', 'b0000000-0000-4000-8000-000000000002');
insert into public.household_members (id, household_id, user_id, role, display_name) values
  ('c1000000-0000-4000-8000-000000000003', 'aa000000-0000-4000-8000-0000000000aa', 'c0000000-0000-4000-8000-000000000003', 'member', 'Carol'),
  ('d1000000-0000-4000-8000-000000000004', 'aa000000-0000-4000-8000-0000000000aa', 'd0000000-0000-4000-8000-000000000004', 'member', 'Dave');
update public.household_members set status = 'revoked' where id = 'd1000000-0000-4000-8000-000000000004';

-- helper ids
create temp table tids as
  select (select id from public.household_members where user_id = 'a0000000-0000-4000-8000-000000000001' and household_id = 'aa000000-0000-4000-8000-0000000000aa') as alice_m,
         (select id from public.household_members where user_id = 'b0000000-0000-4000-8000-000000000002' and household_id = 'bb000000-0000-4000-8000-0000000000bb') as bob_m;
grant select on tids to authenticated;

-- anon cannot call it
select tests.act_as_anon();
select tests.throws($$ select public.transfer_ownership('aa000000-0000-4000-8000-0000000000aa', 'c1000000-0000-4000-8000-000000000003') $$,
                    '42501', 'anon cannot execute');

-- non-owner refused
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.throws($$ select public.transfer_ownership('aa000000-0000-4000-8000-0000000000aa', 'c1000000-0000-4000-8000-000000000003') $$,
                    '42501', 'member cannot transfer');
-- outsider (owner of a different household) refused
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.throws($$ select public.transfer_ownership('aa000000-0000-4000-8000-0000000000aa', 'c1000000-0000-4000-8000-000000000003') $$,
                    '42501', 'foreign owner cannot transfer');

-- owner refusals
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ select public.transfer_ownership('aa000000-0000-4000-8000-0000000000aa', (select alice_m from tids)) $$,
                    '22023', 'cannot transfer to self');
select tests.throws($$ select public.transfer_ownership('aa000000-0000-4000-8000-0000000000aa', 'd1000000-0000-4000-8000-000000000004') $$,
                    '22023', 'cannot transfer to a revoked member');
select tests.throws($$ select public.transfer_ownership('aa000000-0000-4000-8000-0000000000aa', (select bob_m from tids)) $$,
                    '22023', 'cannot transfer to a member of another household');
select tests.throws($$ select public.transfer_ownership('aa000000-0000-4000-8000-0000000000aa', 'f1000000-0000-4000-8000-0000000000ff') $$,
                    '22023', 'cannot transfer to an unknown member');

-- grace period: refused while pending deletion, works again after cancel
select public.request_household_deletion('aa000000-0000-4000-8000-0000000000aa');
select tests.throws($$ select public.transfer_ownership('aa000000-0000-4000-8000-0000000000aa', 'c1000000-0000-4000-8000-000000000003') $$,
                    '42501', 'refused during deletion grace period');
select public.cancel_household_deletion('aa000000-0000-4000-8000-0000000000aa');

-- success: roles swap, exactly one owner
select public.transfer_ownership('aa000000-0000-4000-8000-0000000000aa', 'c1000000-0000-4000-8000-000000000003');
select tests.is((select count(*) from public.household_members
                  where household_id = 'aa000000-0000-4000-8000-0000000000aa' and role = 'owner' and status = 'active'), 1, 'exactly one owner');
select tests.ok((select role = 'owner' from public.household_members where id = 'c1000000-0000-4000-8000-000000000003'), 'carol is owner');
select tests.ok((select role = 'member' and status = 'active' from public.household_members where user_id = 'a0000000-0000-4000-8000-000000000001'
                   and household_id = 'aa000000-0000-4000-8000-0000000000aa'), 'alice demoted to member, still active');
select tests.ok(not public.is_household_owner('aa000000-0000-4000-8000-0000000000aa'), 'alice no longer owner');

-- ex-owner now refused
select tests.throws($$ select public.transfer_ownership('aa000000-0000-4000-8000-0000000000aa', (select alice_m from tids)) $$,
                    '42501', 'ex-owner cannot transfer again');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.ok(public.is_household_owner('aa000000-0000-4000-8000-0000000000aa'), 'carol is owner (as carol)');

rollback;
