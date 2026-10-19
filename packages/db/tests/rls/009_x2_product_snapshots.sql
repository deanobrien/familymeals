-- X2 (D187): household product snapshots. Members of an active household read/write; nobody else; table not directly accessible.
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
insert into public.ingredients (id, name, slug, category, form) values
  ('11000000-0000-4000-8000-000000000001', 'Baked beans', 'baked-beans', 'Tins', null);

-- a member saves a snapshot linked to an ingredient
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select public.save_product_snapshot('aa000000-0000-4000-8000-0000000000aa', '5009000000018', '11000000-0000-4000-8000-000000000001',
  '{"barcode":"5009000000018","name":"Beans","nutrition":{"per":"g","per100":[],"derived":[]}}'::jsonb, '2026-10-19T12:00:00Z');
select tests.is((select jsonb_array_length(public.household_product_snapshots('aa000000-0000-4000-8000-0000000000aa'))), 1, 'member reads own household snapshots');
select tests.ok((select (public.household_product_snapshots('aa000000-0000-4000-8000-0000000000aa') -> 0 ->> 'ingredient_id') = '11000000-0000-4000-8000-000000000001'), 'link to ingredient kept');

-- upsert per (household, barcode): same barcode replaces, no duplicate row
select public.save_product_snapshot('aa000000-0000-4000-8000-0000000000aa', '5009000000018', null,
  '{"barcode":"5009000000018","name":"Beans v2","nutrition":{"per":"g","per100":[],"derived":[]}}'::jsonb, '2026-10-20T12:00:00Z');
select tests.is((select jsonb_array_length(public.household_product_snapshots('aa000000-0000-4000-8000-0000000000aa'))), 1, 'upsert does not duplicate');
select tests.ok((select (public.household_product_snapshots('aa000000-0000-4000-8000-0000000000aa') -> 0 ->> 'ingredient_id') is null), 'relink to none');

-- validation
select tests.throws($$ select public.save_product_snapshot('aa000000-0000-4000-8000-0000000000aa', '5009000000018', null,
  '{"barcode":"9999999999999"}'::jsonb, now()) $$, '22023', 'snapshot barcode must match');
select tests.throws($$ select public.save_product_snapshot('aa000000-0000-4000-8000-0000000000aa', 'not-a-barcode', null,
  '{"barcode":"not-a-barcode"}'::jsonb, now()) $$, '23514', 'barcode format enforced');
select tests.throws($$ select public.save_product_snapshot('aa000000-0000-4000-8000-0000000000aa', '5009000000025', null,
  '[1]'::jsonb, now()) $$, '22023', 'snapshot must be an object');

-- isolation: another household sees nothing and cannot write into or delete from ours
select tests.act_as('c0000000-0000-4000-8000-000000000003');
select tests.ok(public.household_product_snapshots('aa000000-0000-4000-8000-0000000000aa') is null, 'non-member reads nothing');
select tests.throws($$ select public.save_product_snapshot('aa000000-0000-4000-8000-0000000000aa', '5009000000025', null,
  '{"barcode":"5009000000025"}'::jsonb, now()) $$, '42501', 'non-member cannot write');
select tests.throws($$ select public.delete_product_snapshot('aa000000-0000-4000-8000-0000000000aa', '5009000000018') $$, '42501', 'non-member cannot delete');
select tests.is((select jsonb_array_length(public.household_product_snapshots('cc000000-0000-4000-8000-0000000000cc'))), 0, 'own household is empty');
select tests.throws($$ select * from public.household_product_snapshots $$, '42501', 'table not readable directly');
select tests.throws($$ insert into public.household_product_snapshots (household_id, barcode, snapshot, retrieved_at)
  values ('cc000000-0000-4000-8000-0000000000cc', '5009000000025', '{}'::jsonb, now()) $$, '42501', 'table not writable directly');

-- delete by a member
select tests.act_as('b0000000-0000-4000-8000-000000000002');
select public.delete_product_snapshot('aa000000-0000-4000-8000-0000000000aa', '5009000000018');
select tests.is((select jsonb_array_length(public.household_product_snapshots('aa000000-0000-4000-8000-0000000000aa'))), 0, 'member deleted it');

-- grace period: read-only
select tests.reset_actor();
update public.households set status = 'pending_deletion', deletion_requested_at = now(), purge_after = now() + interval '14 days'
 where id = 'aa000000-0000-4000-8000-0000000000aa';
select tests.act_as('a0000000-0000-4000-8000-000000000001');
select tests.throws($$ select public.save_product_snapshot('aa000000-0000-4000-8000-0000000000aa', '5009000000025', null,
  '{"barcode":"5009000000025"}'::jsonb, now()) $$, '42501', 'read-only household: no product writes');
select tests.ok((select jsonb_array_length(public.household_product_snapshots('aa000000-0000-4000-8000-0000000000aa'))) = 0, 'read-only: reads still work');

select tests.reset_actor();
rollback;
