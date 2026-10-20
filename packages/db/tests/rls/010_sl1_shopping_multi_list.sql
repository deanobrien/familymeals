-- SL1 (D263): several shopping lists per household, one active; create / activate / rename / archive under RLS.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-4000-8000-000000000001', 'alice@example.test'),
  ('b0000000-0000-4000-8000-000000000002', 'bob@example.test'),
  ('c0000000-0000-4000-8000-000000000003', 'carol@example.test');
insert into public.households (id, name, created_by) values
  ('aa000000-0000-4000-8000-0000000000aa', 'Alice home', 'a0000000-0000-4000-8000-000000000001'),
  ('cc000000-0000-4000-8000-0000000000cc', 'Carol home', 'c0000000-0000-4000-8000-000000000003');
insert into public.household_members (household_id, user_id, role, display_name) values
  ('aa000000-0000-4000-8000-0000000000aa', 'b0000000-0000-4000-8000-000000000002', 'member', 'Bob');

select tests.act_as('a0000000-0000-4000-8000-000000000001');
create temp table t_first as select public.ensure_shopping_list('aa000000-0000-4000-8000-0000000000aa') as id;

-- create: the new list is the active one, the previous is archived whole
select tests.ok((select public.shopping_list_create('aa000000-0000-4000-8000-0000000000aa', 'Shopping list - 20 Oct', 'f1000000-0000-4000-8000-000000000001'))
                = 'f1000000-0000-4000-8000-000000000001', 'create returns the new id');
select tests.is((select count(*) from public.shopping_lists where household_id = 'aa000000-0000-4000-8000-0000000000aa' and status = 'active'), 1, 'exactly one active list');
select tests.ok((select status = 'archived' from public.shopping_lists where id = (select id from t_first)), 'previous list archived');
select tests.ok((select public.ensure_shopping_list('aa000000-0000-4000-8000-0000000000aa')) = 'f1000000-0000-4000-8000-000000000001', 'ensure_shopping_list now returns the new list');
select tests.ok((select public.shopping_list_snapshot('aa000000-0000-4000-8000-0000000000aa') ->> 'listId') = 'f1000000-0000-4000-8000-000000000001', 'snapshot follows the active list');

-- idempotent on the list id (double submit / lost response): no second list, nothing re-archived
select tests.ok((select public.shopping_list_create('aa000000-0000-4000-8000-0000000000aa', 'Shopping list - 20 Oct', 'f1000000-0000-4000-8000-000000000001'))
                = 'f1000000-0000-4000-8000-000000000001', 'replayed create returns the same id');
select tests.is((select count(*) from public.shopping_lists where household_id = 'aa000000-0000-4000-8000-0000000000aa'), 2, 'replay made no extra list');
select tests.ok((select status = 'active' from public.shopping_lists where id = 'f1000000-0000-4000-8000-000000000001'), 'replay leaves the new list active');

-- a name is required
select tests.throws($$ select public.shopping_list_create('aa000000-0000-4000-8000-0000000000aa', '   ') $$, '22023', 'blank name refused');

-- a member (Bob) can switch back; the current list is archived
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select tests.ok((select public.shopping_list_activate('aa000000-0000-4000-8000-0000000000aa', (select id from t_first))) = (select id from t_first), 'activate returns the list');
select tests.ok((select status = 'active' from public.shopping_lists where id = (select id from t_first)), 'older list active again');
select tests.ok((select status = 'archived' from public.shopping_lists where id = 'f1000000-0000-4000-8000-000000000001'), 'the other is archived');
select tests.is((select count(*) from public.shopping_lists where household_id = 'aa000000-0000-4000-8000-0000000000aa' and status = 'active'), 1, 'still exactly one active');

-- rename and archive are ordinary member updates
update public.shopping_lists set name = 'Weekly shop' where id = (select id from t_first);
select tests.ok((select name = 'Weekly shop' from public.shopping_lists where id = (select id from t_first)), 'rename works');

-- unknown / foreign lists
select tests.throws($$ select public.shopping_list_activate('aa000000-0000-4000-8000-0000000000aa', gen_random_uuid()) $$, 'P0002', 'unknown list refused');
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.throws($$ select public.shopping_list_activate('aa000000-0000-4000-8000-0000000000aa', (select id from t_first)) $$, 'P0002', 'a stranger cannot activate (RLS hides the list)');
select tests.throws($$ select public.shopping_list_create('aa000000-0000-4000-8000-0000000000aa', 'Hijack', 'f1000000-0000-4000-8000-000000000009') $$, '42501', 'a stranger cannot create in another household');
select tests.ok((select count(*) from public.shopping_lists where household_id = 'aa000000-0000-4000-8000-0000000000aa') = 0, 'a stranger sees no lists');
-- Carol can run the same flow in her own household, independently
select tests.ok((select public.shopping_list_create('cc000000-0000-4000-8000-0000000000cc', 'Carol list', 'f2000000-0000-4000-8000-000000000001')) is not null, 'Carol creates in her own household');
select tests.reset_actor();
select tests.is((select count(*) from public.shopping_lists where household_id = 'aa000000-0000-4000-8000-0000000000aa' and status = 'active'), 1, 'Alice household unaffected');

-- anonymous callers have no access
select tests.act_as_anon();
select tests.throws($$ select public.shopping_list_create('aa000000-0000-4000-8000-0000000000aa', 'Anon') $$, '42501', 'anon cannot create');

rollback;
