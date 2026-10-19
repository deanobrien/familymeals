-- Households, membership, invitations: bootstrap, owner-only management, cross-household isolation.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'alice@example.test'),
  ('b0000000-0000-4000-8000-000000000002', 'bob@example.test'),
  ('c0000000-0000-4000-8000-000000000003', 'carol@example.test'),
  ('d0000000-0000-4000-8000-000000000004', 'dave@example.test');

-- Alice creates HA through the API path; the bootstrap trigger makes her owner and RETURNING works.
select tests.act_as('a0000000-0000-4000-8000-000000000001');
insert into public.households (id, name) values ('aa000000-0000-4000-8000-0000000000aa', 'Alice home');
select tests.is((select count(*) from public.households), 1, 'alice sees her household');
select tests.ok((select role = 'owner' from public.household_members
                  where user_id = 'a0000000-0000-4000-8000-000000000001'), 'creator bootstrapped as owner');
select tests.throws($$ insert into public.households (name, created_by)
                      values ('spoof', 'b0000000-0000-4000-8000-000000000002') $$,
                    '42501', 'cannot create a household on behalf of someone else');

-- Bob creates HB.
select tests.act_as('b0000000-0000-4000-8000-000000000002');
insert into public.households (id, name) values ('bb000000-0000-4000-8000-0000000000bb', 'Bob home');
select tests.is((select count(*) from public.households), 1, 'bob sees only his household');
select tests.is((select count(*) from public.households where id = 'aa000000-0000-4000-8000-0000000000aa'), 0,
                'bob cannot see HA');
select tests.is((select count(*) from public.household_members), 1, 'bob sees only his own membership');
select tests.is(tests.affected($$ update public.households set name = 'pwned' where id = 'aa000000-0000-4000-8000-0000000000aa' $$),
                0, 'bob cannot rename HA');
select tests.is(tests.affected($$ delete from public.households where id = 'aa000000-0000-4000-8000-0000000000aa' $$),
                0, 'bob cannot delete HA');
select tests.throws($$ insert into public.household_members (household_id, user_id, role)
                      values ('aa000000-0000-4000-8000-0000000000aa', 'b0000000-0000-4000-8000-000000000002', 'owner') $$,
                    '42501', 'bob cannot add himself to HA');
select tests.throws($$ select public.create_invitation('aa000000-0000-4000-8000-0000000000aa') $$,
                    '42501', 'bob cannot invite into HA');

-- Alice invites; raw token returned once, only the hash is stored.
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select set_config('tests.token', (select token from public.create_invitation('aa000000-0000-4000-8000-0000000000aa', 'Carol@Example.test')), true);
select tests.ok(length(current_setting('tests.token')) = 64, 'token is 64 hex chars');
select tests.is((select count(*) from public.invitations where token_hash = current_setting('tests.token')), 0,
                'raw token is not stored');
select tests.ok((select email = 'carol@example.test' from public.invitations), 'email normalised to lower case');

-- Bob cannot read HA invitations.
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.is((select count(*) from public.invitations), 0, 'outsider cannot list invitations');
select tests.throws($$ select public.accept_invitation('not-a-real-token') $$, '22023', 'bogus token rejected');

-- Carol accepts.
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.ok(public.accept_invitation(current_setting('tests.token')) = 'aa000000-0000-4000-8000-0000000000aa',
                'carol joins HA');
select tests.is((select count(*) from public.households), 1, 'carol now sees HA');
select tests.is((select count(*) from public.household_members), 2, 'carol sees both HA members');
select tests.is((select count(*) from public.invitations), 0, 'ordinary member cannot see invitations');

-- Token is single-use.
select tests.act_as('d0000000-0000-4000-8000-000000000004');
select tests.throws(format('select public.accept_invitation(%L)', current_setting('tests.token')), '22023',
                    'accepted token cannot be reused');

-- Expired invitation (inserted directly as superuser with past timestamps).
select tests.reset_actor();
insert into public.invitations (household_id, token_hash, invited_by, created_at, expires_at)
values ('aa000000-0000-4000-8000-0000000000aa', encode(sha256(convert_to('expired-token', 'UTF8')), 'hex'),
        'a0000000-0000-4000-8000-000000000001', now() - interval '10 days', now() - interval '3 days');
select tests.act_as('d0000000-0000-4000-8000-000000000004');
select tests.throws($$ select public.accept_invitation('expired-token') $$, '22023', 'expired token rejected');
select tests.is((select count(*) from public.households), 0, 'dave still sees nothing');

-- Ordinary member cannot escalate or manage others.
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.throws($$ update public.household_members set role = 'owner'
                      where user_id = 'c0000000-0000-4000-8000-000000000003' $$, '42501', 'member cannot self-promote');
select tests.is(tests.affected($$ update public.household_members set status = 'revoked'
                                   where user_id = 'a0000000-0000-4000-8000-000000000001' $$),
                0, 'member cannot revoke the owner');
select tests.throws($$ select public.create_invitation('aa000000-0000-4000-8000-0000000000aa') $$, '42501',
                    'member cannot invite');
select tests.is(tests.affected($$ update public.households set name = 'x' where id = 'aa000000-0000-4000-8000-0000000000aa' $$),
                0, 'member cannot rename household (owner only)');
select tests.is(tests.affected($$ update public.household_members set display_name = 'Caz'
                                   where user_id = 'c0000000-0000-4000-8000-000000000003' $$),
                1, 'member can rename themselves');

-- Owner cannot orphan the household.
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ update public.household_members set role = 'member'
                      where user_id = 'a0000000-0000-4000-8000-000000000001' $$, '23514', 'last owner cannot demote self');
select tests.throws($$ delete from public.household_members
                      where user_id = 'a0000000-0000-4000-8000-000000000001' $$, '23514', 'last owner cannot leave');

-- Revocation removes access immediately.
insert into public.recipes (household_id, title) values ('aa000000-0000-4000-8000-0000000000aa', 'Shepherd''s pie');
select tests.is(tests.affected($$ update public.household_members set status = 'revoked'
                                   where user_id = 'c0000000-0000-4000-8000-000000000003' $$),
                1, 'owner revokes carol');
select tests.ok((select revoked_at is not null from public.household_members
                  where user_id = 'c0000000-0000-4000-8000-000000000003'), 'revoked_at stamped');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.is((select count(*) from public.recipes), 0, 'revoked member loses recipe access');
select tests.is((select count(*) from public.households), 0, 'revoked member loses household access');
select tests.is(tests.affected($$ update public.household_members set status = 'active', revoked_at = null
                                   where user_id = 'c0000000-0000-4000-8000-000000000003' $$),
                0, 'revoked member cannot reactivate themselves');

-- anon sees nothing at all.
select tests.act_as_anon();
select tests.throws($$ select count(*) from public.households $$, '42501', 'anon has no table access');

-- Household deletion cascades cleanly (owner).
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.is(tests.affected($$ delete from public.households where id = 'aa000000-0000-4000-8000-0000000000aa' $$),
                1, 'owner can delete household (cascade incl. last-owner row)');

rollback;
