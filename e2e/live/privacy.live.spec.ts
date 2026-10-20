// Live Supabase (DX1): data export contents under real RLS, household deletion with grace/cancel through the UI,
// account deletion, and the scheduled purge job (/api/jobs/purge) end to end, incl. Storage and auth users.
import { expect, test, type Page } from '@playwright/test';
import type { SupabaseClient } from '@supabase/supabase-js';
// Same reader the unit tests use (pure node: zlib + CRC check).
import { unzip, unzipText } from '../../apps/web/lib/server/export/unzip';
import { adminClient, createConfirmedUser, signIn, userClient, type LiveUser } from './support/live.js';

test.describe.configure({ mode: 'serial' });

interface JobResult {
  ok: boolean;
  households: { purged: number; replayed: number };
  accounts: { deleted: number; replayed: number; blocked: number; failed: number };
}
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);

async function household(c: SupabaseClient, name: string): Promise<string> {
  const { data, error } = await c.from('households').insert({ name }).select('id').single();
  if (error || !data) throw new Error(`create household: ${error?.message}`);
  return data.id as string;
}

async function join(owner: SupabaseClient, member: SupabaseClient, hid: string, displayName: string): Promise<void> {
  const { data, error } = await owner.rpc('create_invitation', { p_household_id: hid });
  if (error) throw new Error(`invite: ${error.message}`);
  const token = (Array.isArray(data) ? data[0] : data).token as string;
  const acc = await member.rpc('accept_invitation', { p_token: token });
  if (acc.error) throw new Error(`accept: ${acc.error.message}`);
  const { data: me } = await member.auth.getUser();
  await member.from('household_members').update({ display_name: displayName }).eq('household_id', hid).eq('user_id', me.user!.id);
}

async function recipe(c: SupabaseClient, hid: string, title: string): Promise<string> {
  const { data, error } = await c.from('recipes').insert({ household_id: hid, title }).select('id').single();
  if (error || !data) throw new Error(`recipe: ${error?.message}`);
  await c.from('recipe_steps').insert({ recipe_id: data.id, household_id: hid, step_number: 1, instructions: `Cook ${title}` });
  return data.id as string;
}

async function exportZip(page: Page, button: 'Export my data' | 'Export whole household') {
  await page.goto('/settings');
  await page.getByRole('button', { name: button }).click();
  const link = page.getByTestId('export-download');
  await expect(link).toBeVisible();
  const href = (await link.getAttribute('href'))!;
  const res = await page.request.get(href);
  expect(res.status()).toBe(200);
  const files = unzip(await res.body());
  const json = (n: string) => JSON.parse(unzipText(files, n));
  return { href, files, json, all: [...files.keys()].filter((n) => n.endsWith('.json')).map((n) => unzipText(files, n)).join('\n') };
}

async function signedIn(browser: import('@playwright/test').Browser, u: LiveUser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, u);
  return { context, page };
}

const jobsSecret = () => {
  const s = process.env.JOBS_SECRET;
  if (!s) throw new Error('JOBS_SECRET missing (set by playwright.live.config.ts)');
  return s;
};

async function runJob(page: Page): Promise<JobResult> {
  const res = await page.request.post('/api/jobs/purge', { headers: { 'x-jobs-secret': jobsSecret() } });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

test('export: owner gets the household, a member only their own data; nothing from other households or other people', async ({ browser }) => {
  const owner = await createConfirmedUser('dx-own');
  const member = await createConfirmedUser('dx-mem');
  const outsider = await createConfirmedUser('dx-out');
  const oc = await userClient(owner);
  const mc = await userClient(member);
  const xc = await userClient(outsider);
  const hid = await household(oc, 'Export home');
  await join(oc, mc, hid, 'Mia');
  const ownerRecipe = await recipe(oc, hid, 'Owner stew');
  const memberRecipe = await recipe(mc, hid, 'Member curry');
  await mc.from('consent_records').insert({ household_id: hid, consent_type: 'allergy_data', wording_version: 'v1' });
  await mc.storage.from('recipe-images').upload(`${hid}/recipes/${memberRecipe}/1.jpg`, JPEG, { contentType: 'image/jpeg' });
  await mc.from('recipe_images').insert({ recipe_id: memberRecipe, household_id: hid, storage_path: `${hid}/recipes/${memberRecipe}/1.jpg`, mime_type: 'image/jpeg' });
  const xhid = await household(xc, 'Outsider home');
  await recipe(xc, xhid, 'Outsider secret');

  // Owner: whole household
  const o = await signedIn(browser, owner);
  const hx = await exportZip(o.page, 'Export whole household');
  const recipes = hx.json('data/recipes.json');
  expect(recipes.recipes.map((r: { id: string }) => r.id).sort()).toEqual([ownerRecipe, memberRecipe].sort());
  expect(hx.json('data/household.json').members.map((m: { display_name: string | null }) => m.display_name)).toContain('Mia');
  expect(hx.json('data/consents.json').consent_records).toEqual([]); // the member's consent is theirs alone
  expect(hx.json('data/account.json')).toMatchObject({ user_id: owner.id, email: owner.email, role: 'owner' });
  expect(hx.files.get(`images/recipe-images/recipes/${memberRecipe}/1.jpg`)).toEqual(new Uint8Array(JPEG));
  const manifest = hx.json('manifest.json');
  expect(manifest.counts.recipes).toBe(2);
  expect(manifest.missingImages).toEqual([]);
  for (const leak of ['Outsider secret', member.email, member.id, outsider.id, 'token_hash']) expect(hx.all).not.toContain(leak);
  // Rate limit: a second household export in 24 h is refused
  await o.page.getByRole('button', { name: 'Export whole household' }).click();
  await expect(o.page.getByTestId('export-error')).toContainText('24 hours');

  // Member: own subset only, cannot export the household, cannot use the owner's link
  const m = await signedIn(browser, member);
  await m.page.goto('/settings');
  await expect(m.page.getByRole('button', { name: 'Export whole household' })).toHaveCount(0);
  const forced = await m.page.request.post('/api/export', { data: { scope: 'household' } });
  expect(forced.status()).toBe(403);
  expect((await m.page.request.get(hx.href)).status()).toBe(404);
  const mx = await exportZip(m.page, 'Export my data');
  expect(mx.json('data/recipes.json').recipes.map((r: { id: string }) => r.id)).toEqual([memberRecipe]);
  expect(mx.json('data/consents.json').consent_records).toHaveLength(1);
  expect(mx.json('data/household.json').members).toHaveLength(1);
  for (const leak of ['Owner stew', owner.email, owner.id]) expect(mx.all).not.toContain(leak);

  // Audit rows: each user sees only their own
  const audit = await oc.from('data_export_requests').select('scope, status');
  expect(audit.data).toEqual([{ scope: 'household', status: 'downloaded' }]);
  await o.context.close();
  await m.context.close();
});

test('deletion: grace + cancel in the UI, account deletion, then the purge job removes rows, storage and auth users', async ({ browser }) => {
  const owner = await createConfirmedUser('dx-del-own');
  const member = await createConfirmedUser('dx-del-mem');
  const oc = await userClient(owner);
  const mc = await userClient(member);
  const hid = await household(oc, 'Doomed home');
  await join(oc, mc, hid, 'Max');
  const rid = await recipe(oc, hid, 'Last supper');
  const path = `${hid}/recipes/${rid}/1.jpg`;
  expect((await oc.storage.from('recipe-images').upload(path, JPEG, { contentType: 'image/jpeg' })).error).toBeNull();
  const { data: list } = await oc.from('shopping_lists').insert({ household_id: hid, name: 'Weekly' }).select('id').single();
  const { data: item } = await oc
    .from('shopping_list_items')
    .insert({ shopping_list_id: list!.id, household_id: hid, display_name: 'milk', quantity_kind: 'exact', quantity_value: 2, unit: 'l', original_text: '2 l' })
    .select('id')
    .single();
  const eventId = crypto.randomUUID();
  const rec = await mc.rpc('record_purchase', {
    p_event_id: eventId,
    p_item_id: item!.id,
    p_mode: 'purchase',
    p_qty: { kind: 'exact', value: 1, unit: 'l', originalText: '1 l' },
  });
  expect(rec.error).toBeNull();
  expect((rec.data as { status: string }).status).toBe('applied');

  // Job endpoint refuses without the secret
  const o = await signedIn(browser, owner);
  expect((await o.page.request.post('/api/jobs/purge')).status()).toBe(401);
  expect((await o.page.request.post('/api/jobs/purge', { headers: { 'x-jobs-secret': 'wrong'.repeat(10) } })).status()).toBe(401);

  // Owner: wrong confirmation / wrong password are refused; then scheduled with a 14-day countdown; then cancelled
  await o.page.goto('/settings');
  await o.page.getByRole('button', { name: 'Delete household' }).click();
  let dialog = o.page.getByRole('dialog');
  await dialog.getByLabel(/Type the household name/).fill('Wrong name');
  await dialog.getByLabel('Your password').fill(owner.password);
  await dialog.getByRole('button', { name: 'Delete household' }).click();
  await expect(dialog.getByRole('alert')).toContainText('did not match');
  await dialog.getByLabel(/Type the household name/).fill('Doomed home');
  await dialog.getByLabel('Your password').fill('Not-The-Password-1');
  await dialog.getByRole('button', { name: 'Delete household' }).click();
  await expect(dialog.getByRole('alert')).toContainText('password was not correct');
  await dialog.getByLabel('Your password').fill(owner.password);
  await dialog.getByRole('button', { name: 'Delete household' }).click();
  await expect(o.page.getByTestId('data-notice')).toContainText('Household deletion scheduled');
  await expect(o.page.getByTestId('household-deletion-pending')).toBeVisible();
  await expect(o.page.getByTestId('grace-days')).toHaveText('14');
  // read-only: writes refused by the database
  expect((await oc.from('recipes').insert({ household_id: hid, title: 'During grace' })).error?.code).toBe('42501');
  await o.page.getByRole('button', { name: 'Cancel deletion' }).click();
  await expect(o.page.getByTestId('data-notice')).toContainText('cancelled');
  await expect(o.page.getByRole('button', { name: 'Delete household' })).toBeVisible();

  // Member deletes their account: leaves now, signed out; the job deletes the auth user and anonymises purchases
  const m = await signedIn(browser, member);
  await m.page.goto('/settings');
  await m.page.getByRole('button', { name: 'Delete my account' }).click();
  dialog = m.page.getByRole('dialog');
  await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
  await dialog.getByLabel('Your password').fill(member.password);
  await dialog.getByRole('button', { name: 'Delete my account' }).click();
  await expect(m.page).toHaveURL(/\/sign-in\?deleted=1/);
  await expect(m.page.getByTestId('account-deletion-notice')).toBeVisible();

  const admin = adminClient();
  let job = await runJob(o.page);
  expect(job.ok).toBe(true);
  expect(job.accounts.deleted).toBeGreaterThanOrEqual(1);
  const gone = await admin.auth.admin.getUserById(member.id);
  expect(gone.data.user).toBeNull();
  const pe = await admin.from('purchase_events').select('created_by, created_by_display_name').eq('id', eventId).single();
  expect(pe.data).toEqual({ created_by: null, created_by_display_name: 'Max' });
  expect((await admin.from('households').select('id').eq('id', hid)).data).toHaveLength(1); // not due: untouched

  // Owner schedules again (UI); force the grace period to have passed; the job purges it all
  await o.page.goto('/settings');
  await o.page.getByRole('button', { name: 'Delete household' }).click();
  dialog = o.page.getByRole('dialog');
  await dialog.getByLabel(/Type the household name/).fill('Doomed home');
  await dialog.getByLabel('Your password').fill(owner.password);
  await dialog.getByRole('button', { name: 'Delete household' }).click();
  await expect(o.page.getByTestId('household-deletion-pending')).toBeVisible();
  const past = new Date(Date.now() - 15 * 86_400_000).toISOString();
  const due = new Date(Date.now() - 60_000).toISOString();
  expect((await admin.from('households').update({ deletion_requested_at: past, purge_after: due }).eq('id', hid)).error).toBeNull();

  job = await runJob(o.page);
  expect(job.households.purged).toBeGreaterThanOrEqual(1);
  for (const table of ['households', 'recipes', 'shopping_lists', 'purchase_events', 'household_members']) {
    const { data } = await admin.from(table).select('*').eq(table === 'households' ? 'id' : 'household_id', hid);
    expect(data ?? [], table).toHaveLength(0);
  }
  const objs = await admin.storage.from('recipe-images').list(`${hid}/recipes/${rid}`);
  expect(objs.data ?? []).toHaveLength(0);
  const ledger = await admin.from('deletion_ledger').select('subject_type, purged_at').eq('subject_id', hid);
  expect((ledger.data ?? []).some((l) => l.subject_type === 'household' && l.purged_at)).toBe(true);

  // Idempotent: a second run finds nothing more for this household
  job = await runJob(o.page);
  expect(job.ok).toBe(true);

  // Replay after a "restore": the household reappears; the next run deletes it again from the ledger
  expect((await admin.from('households').insert({ id: hid, name: 'Doomed home (restored)', created_by: null })).error).toBeNull();
  job = await runJob(o.page);
  expect(job.households.replayed).toBeGreaterThanOrEqual(1);
  expect((await admin.from('households').select('id').eq('id', hid)).data).toHaveLength(0);
  await o.context.close();
  await m.context.close();
});
