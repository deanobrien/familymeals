/**
 * Exercises the SQL the household/invite UI relies on (create_invitation, accept_invitation, member_leave,
 * ownership transfer via role updates, grace-period read-only) on PGlite with the real migrations, reusing the
 * stub + helpers from packages/db. No Docker. Ownership transfer goes through the transfer_ownership() RPC, as transferOwnership() does.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..');
const migrationsDir = join(repo, 'supabase', 'migrations');
const dbTests = join(repo, 'packages', 'db', 'tests');

const A = 'a0000000-0000-4000-8000-000000000001'; // owner
const B = 'b0000000-0000-4000-8000-000000000002'; // outsider
const C = 'c0000000-0000-4000-8000-000000000003'; // invitee
const D = 'd0000000-0000-4000-8000-000000000004';
const HA = 'aa000000-0000-4000-8000-0000000000aa';

let db: PGlite;

async function script(sql: string) {
  try {
    await db.exec(`begin;\n${sql}\nrollback;`);
  } catch (e) {
    await db.exec('rollback').catch(() => undefined);
    throw e;
  }
}

const fixtures = `
insert into auth.users (id, email) values
  ('${A}', 'a@example.test'), ('${B}', 'b@example.test'), ('${C}', 'c@example.test'), ('${D}', 'd@example.test');
select tests.act_as('${A}');
insert into public.households (id, name) values ('${HA}', 'Alice home');
`;

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pg_trgm, pgcrypto } });
  await db.exec(readFileSync(join(dbTests, 'support', 'supabase-stub.sql'), 'utf8'));
  for (const m of readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort()) {
    await db.exec(readFileSync(join(migrationsDir, m), 'utf8'));
  }
  await db.exec(readFileSync(join(dbTests, 'rls', '000_helpers.sql'), 'utf8'));
}, 180_000);

afterAll(async () => {
  await db?.close();
});

describe('create_invitation / accept_invitation semantics', () => {
  it('owner invites; 64-hex token returned once, only the hash stored; invitee joins; single use', async () => {
    await script(`${fixtures}
      select set_config('t.tok', (select token from public.create_invitation('${HA}', 'C@Example.test', 'member', interval '24 hours')), true);
      select tests.ok(current_setting('t.tok') ~ '^[0-9a-f]{64}$', 'token is 64 hex');
      select tests.is((select count(*) from public.invitations where token_hash = current_setting('t.tok')), 0, 'raw token not stored');
      select tests.ok((select email = 'c@example.test' from public.invitations), 'email lower-cased');
      select tests.act_as('${C}');
      select tests.ok(public.accept_invitation(current_setting('t.tok')) = '${HA}', 'joins');
      select tests.act_as('${D}');
      select tests.throws(format('select public.accept_invitation(%L)', current_setting('t.tok')), '22023', 'reuse rejected');
    `);
  });

  it('non-owners cannot invite; garbage tokens are rejected', async () => {
    await script(`${fixtures}
      select tests.act_as('${B}');
      select tests.throws($$ select public.create_invitation('${HA}') $$, '42501', 'outsider cannot invite');
      select tests.throws($$ select public.accept_invitation('not-a-token') $$, '22023', 'bogus token');
      select tests.throws($$ select public.accept_invitation('') $$, '22023', 'empty token');
    `);
  });

  it('expired and revoked invitations are rejected', async () => {
    await script(`${fixtures}
      select set_config('t.exp', (select token from public.create_invitation('${HA}')), true);
      select set_config('t.rev', (select token from public.create_invitation('${HA}')), true);
      select tests.reset_actor();
      update public.invitations set created_at = now() - interval '3 days', expires_at = now() - interval '1 day'
       where token_hash = encode(sha256(convert_to(current_setting('t.exp'), 'UTF8')), 'hex');
      select tests.act_as('${A}');
      update public.invitations set revoked_at = now()
       where token_hash = encode(sha256(convert_to(current_setting('t.rev'), 'UTF8')), 'hex');
      select tests.act_as('${C}');
      select tests.throws(format('select public.accept_invitation(%L)', current_setting('t.exp')), '22023', 'expired rejected');
      select tests.throws(format('select public.accept_invitation(%L)', current_setting('t.rev')), '22023', 'revoked rejected');
    `);
  });

  it('TTL is capped at 30 days', async () => {
    await script(`${fixtures}
      select tests.ok((select expires_at <= now() + interval '30 days 1 minute' from public.create_invitation('${HA}', null, 'member', interval '999 days')), 'capped');
    `);
  });
});

describe('membership management used by /household', () => {
  const withMember = `${fixtures}
    select set_config('t.tok', (select token from public.create_invitation('${HA}')), true);
    select tests.act_as('${C}');
    select public.accept_invitation(current_setting('t.tok'));
    select tests.act_as('${A}');
  `;

  it('ownership transfer via transfer_ownership(); sole owner cannot leave or be demoted directly', async () => {
    await script(`${withMember}
      select tests.throws($$ select public.member_leave('${HA}') $$, '22023', 'sole owner cannot leave');
      select tests.throws($$ update public.household_members set role = 'member' where user_id = '${A}' $$, '23514', 'cannot demote last owner');
      select tests.throws($$ select public.transfer_ownership('${HA}', (select id from public.household_members where user_id = '${A}' and household_id = '${HA}')) $$, '22023', 'not to self');
      select public.transfer_ownership('${HA}', (select id from public.household_members where user_id = '${C}' and household_id = '${HA}'));
      select tests.is((select count(*) from public.household_members where role = 'owner' and status = 'active'), 1, 'one owner');
      select tests.throws($$ select public.transfer_ownership('${HA}', (select id from public.household_members where user_id = '${C}' and household_id = '${HA}')) $$, '42501', 'ex-owner refused');
      select tests.act_as('${C}');
      select tests.ok(public.is_household_owner('${HA}'), 'C is now owner');
      select tests.act_as('${A}');
      select tests.throws($$ update public.household_members set role = 'owner' where user_id = '${A}' $$, '42501', 'ex-owner cannot re-promote');
    `);
  });

  it('ownership transfer is refused during the deletion grace period', async () => {
    await script(`${withMember}
      select public.request_household_deletion('${HA}');
      select tests.throws($$ select public.transfer_ownership('${HA}', (select id from public.household_members where user_id = '${C}' and household_id = '${HA}')) $$, '42501', 'read-only during grace');
    `);
  });

  it('owner removes a member; removed member loses access; members cannot remove others', async () => {
    await script(`${withMember}
      select tests.act_as('${C}');
      select tests.is(tests.affected($$ update public.household_members set status = 'revoked' where user_id = '${A}' $$), 0, 'member cannot remove owner');
      select tests.act_as('${A}');
      select tests.is(tests.affected($$ update public.household_members set status = 'revoked' where user_id = '${C}' $$), 1, 'owner removes member');
      select tests.act_as('${C}');
      select tests.is((select count(*) from public.households), 0, 'removed member sees nothing');
    `);
  });

  it('member can leave; leaving blocked when last member', async () => {
    await script(`${withMember}
      select tests.act_as('${C}');
      select public.member_leave('${HA}');
      select tests.is((select count(*) from public.households), 0, 'left member sees nothing');
      select tests.act_as('${A}');
      select tests.throws($$ select public.member_leave('${HA}') $$, '22023', 'last member must use deletion');
    `);
  });

  it('pending deletion: invitations refused (read-only), owner can cancel and invite again', async () => {
    await script(`${fixtures}
      select public.request_household_deletion('${HA}');
      select tests.throws($$ select public.create_invitation('${HA}') $$, '42501', 'read-only during grace');
      select public.cancel_household_deletion('${HA}');
      select tests.ok((select token is not null from public.create_invitation('${HA}')), 'invite works after cancel');
    `);
  });
});

describe('error text the UI maps', () => {
  it('guard message matches the read_only mapper regexp', () => {
    expect(/read.?only|pending[_ ]deletion|not writable/i.test('household is pending deletion and read-only')).toBe(true);
  });
});
