-- accept_invitation() honours invitations.email (migration 001910, D144): only the confirmed account with that
-- address can accept; a wrong / unconfirmed account and a pending-deletion household get the generic 22023.
begin;

insert into auth.users (id, email, email_confirmed_at) values
  ('a0000000-0000-4000-8000-000000000001', 'alice@example.test', now()),
  ('b0000000-0000-4000-8000-000000000002', 'bob@example.test', now()),
  ('c0000000-0000-4000-8000-000000000003', 'carol@example.test', now()),
  ('d0000000-0000-4000-8000-000000000004', 'dave@example.test', null);
insert into public.households (id, name, created_by) values
  ('aa000000-0000-4000-8000-0000000000aa', 'Alice home', 'a0000000-0000-4000-8000-000000000001');

select tests.act_as('a0000000-0000-4000-8000-000000000001');
select set_config('t.locked', (select token from public.create_invitation('aa000000-0000-4000-8000-0000000000aa', 'Bob@Example.TEST')), false);
select set_config('t.dave', (select token from public.create_invitation('aa000000-0000-4000-8000-0000000000aa', 'dave@example.test')), false);
select set_config('t.open', (select token from public.create_invitation('aa000000-0000-4000-8000-0000000000aa')), false);

select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.throws($$ select public.accept_invitation(current_setting('t.locked')) $$, '22023', 'wrong account cannot use an email-locked invite');
select tests.act_as('d0000000-0000-4000-8000-000000000004');
select tests.throws($$ select public.accept_invitation(current_setting('t.dave')) $$, '22023', 'unconfirmed address cannot use its locked invite');

select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.ok(public.accept_invitation(current_setting('t.locked')) = 'aa000000-0000-4000-8000-0000000000aa', 'intended address (any case) accepts');

-- pending deletion: even an open invite is refused
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select public.request_household_deletion('aa000000-0000-4000-8000-0000000000aa');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.throws($$ select public.accept_invitation(current_setting('t.open')) $$, '22023', 'cannot join a household pending deletion');

rollback;
