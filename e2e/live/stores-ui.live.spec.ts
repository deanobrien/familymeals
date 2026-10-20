// Live Supabase through the real UI + server (LT1, D230): receipts -> price -> recipe cost, AI settings secrecy, barcode
// product snapshots and the pantry feed. Companion to stores-api.live.spec.ts (which drives the SQL surface directly).
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { MealPlanPage } from '../support/pages.js';
import { adminClient, createConfirmedUser, createInviteLink, householdIdOf, signIn, userClient, userWithHousehold } from './support/live.js';

const RECEIPT_IMAGE = fileURLToPath(new URL('../fixtures/receipts/r1-weekly-shop.png', import.meta.url));

async function createRecipe(a: Page, title: string, ingredient: string, amount: string, unit: string): Promise<string> {
  await a.goto('/recipes/new');
  await a.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await a.getByRole('textbox', { name: 'Ingredient 1 name' }).fill(ingredient);
  await a.getByRole('spinbutton', { name: 'Ingredient 1 amount' }).fill(amount);
  await a.getByRole('combobox', { name: 'Ingredient 1 unit' }).selectOption(unit);
  await a.getByRole('textbox', { name: 'Step 1', exact: true }).fill('Simmer.');
  await a.getByRole('button', { name: 'Create recipe' }).click();
  await expect(a).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
  return a.url();
}

async function costOf(page: Page, url: string) {
  await page.goto(url);
  await expect(page.getByTestId('cost-total')).toBeVisible();
  return {
    total: (await page.getByTestId('cost-total').innerText()).split('\n')[0]!.trim(),
    sources: await page.getByTestId('cost-source').allInnerTexts(),
  };
}

/** Plan the recipe on a Monday, approve it and generate the shopping list. */
async function planAndGenerate(a: Page, title: string, week: string) {
  const plan = new MealPlanPage(a);
  await a.goto(`/plan?week=${week}`);
  await plan.addToSlot(week, 'dinner').click();
  await a.getByRole('dialog').getByRole('searchbox').fill(title);
  await a.getByRole('dialog').getByRole('button', { name: `Select ${title}` }).click();
  await a.getByRole('button', { name: 'Save plan' }).click();
  await expect(a.getByTestId('plan-message')).toContainText('Plan saved');
  await plan.approve().click();
  await expect(a.getByText('Approved', { exact: true }).first()).toBeVisible();
  await plan.generateList().click();
  await expect(a.getByRole('link', { name: 'Open shopping list' })).toBeVisible();
}

test('receipt confirm: the receipt price beats the generic estimate in this household\'s recipe cost; household B is unaffected', async ({ browser }) => {
  test.setTimeout(300_000);
  const a = await userWithHousehold(browser, 'rcui-a', 'Receipt UI home A', 'Ann');
  const b = await userWithHousehold(browser, 'rcui-b', 'Receipt UI home B', 'Bea');
  try {
    const urlA = await createRecipe(a.page, 'Lentil Dal A', 'red lentils', '500', 'g');
    const urlB = await createRecipe(b.page, 'Lentil Dal B', 'red lentils', '500', 'g');
    const before = await costOf(a.page, urlA);
    expect(before.sources.join(' ')).toMatch(/Generic UK estimate/);
    const beforeB = await costOf(b.page, urlB);
    expect(beforeB.total).toBe(before.total); // same generic estimate

    await planAndGenerate(a.page, 'Lentil Dal A', '2026-11-16');

    // Upload the (mock-parsed) receipt, confirm only the lentils.
    await a.page.goto('/receipts');
    await expect(a.page.getByRole('heading', { level: 1, name: 'Receipts' })).toBeVisible();
    await a.page.getByLabel('Receipt photo').setInputFiles(RECEIPT_IMAGE);
    await a.page.getByRole('button', { name: 'Scan receipt' }).click();
    await expect(a.page).toHaveURL(/\/receipts\/[^/]+\/review$/, { timeout: 90_000 });
    const receiptUrl = a.page.url();
    await expect(a.page.getByTestId('receipt-line')).toHaveCount(3);
    await expect(a.page.getByLabel('Match for RED LENTILS 500G').locator('option:checked')).toContainText('red lentil');
    await a.page.getByLabel('Confirm RED LENTILS 500G as bought').check();
    await a.page.getByRole('button', { name: 'Confirm 1 purchase' }).click();
    await expect(a.page.getByRole('status').filter({ hasText: '1 purchase(s) recorded' })).toBeVisible();

    // Persisted through the real RPCs: receipt (reconciled, 3 lines), the purchase event, the receipt price.
    const hidA = await householdIdOf(a.user);
    const ca = await userClient(a.user);
    const receipts = (await ca.rpc('list_receipts', { p_household_id: hidA })).data as Array<{ id: string; status: string; line_count: number }>;
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({ status: 'reconciled', line_count: 3 });
    const { data: events } = await ca.from('purchase_events').select('receipt_line_id, actual_price_pence').eq('household_id', hidA).is('voided_at', null);
    expect(events).toHaveLength(1);
    expect(events![0]!.receipt_line_id).not.toBeNull();
    const prices = (await ca.rpc('household_price_observations', { p_household_id: hidA })).data as Array<{ kind: string; price_pence: number; household_id: string | null }>;
    const mine = prices.filter((p) => p.household_id === hidA);
    expect(mine.map((p) => p.kind)).toEqual(['receipt']);

    // The review page reloads from the DB; the receipt survives a reload.
    await a.page.goto(receiptUrl);
    await expect(a.page.getByTestId('receipt-line').filter({ hasText: 'RED LENTILS 500G' })).toContainText('bought: red lentil');

    // Cost: receipt price now wins for A (price cache is refreshed on write); B keeps the generic estimate.
    const after = await costOf(a.page, urlA);
    expect(after.sources.join(' ')).toMatch(/receipt/i);
    expect(after.sources.join(' ')).not.toMatch(/Generic UK estimate/);
    expect(after.total).not.toBe(before.total);
    const afterB = await costOf(b.page, urlB);
    expect(afterB.total).toBe(before.total);
    expect(afterB.sources.join(' ')).toMatch(/Generic UK estimate/);

    // B cannot open A's receipt.
    const r = await b.page.goto(receiptUrl);
    expect(r?.status()).toBe(404); // not found, never another household's receipt
    await expect(b.page.getByTestId('receipt-line')).toHaveCount(0);
    const cb = await userClient(b.user);
    expect((await cb.rpc('list_receipts', { p_household_id: await householdIdOf(b.user) })).data).toEqual([]);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});

// ---------------------------------------------------------------------------------------------------------------------

interface Stub {
  server: Server;
  url: string;
  seen: IncomingHttpHeaders[];
}

/** A throwaway OpenAI-compatible endpoint on 127.0.0.1 (plain http to localhost is allowed for custom endpoints). */
async function startStub(): Promise<Stub> {
  const seen: IncomingHttpHeaders[] = [];
  const server = createServer((req, res) => {
    seen.push(req.headers);
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"ok":true}' } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, seen };
}

/** Records every response body a page receives, so "the browser never sees the key" is checked on the wire too. */
function recordBodies(page: Page): string[] {
  const bodies: string[] = [];
  page.on('response', (res) => {
    const type = res.headers()['content-type'] ?? '';
    if (/json|text|html|javascript|x-component/.test(type)) void res.text().then((t) => bodies.push(`${res.url()}\n${t}`)).catch(() => undefined);
  });
  return bodies;
}

async function browserSurface(page: Page, paths: string[]): Promise<string> {
  let all = '';
  for (const p of paths) {
    await page.goto(p);
    await page.waitForLoadState('networkidle');
    all += `\n--- ${p}\n${await page.content()}`;
  }
  all += `\n--- storage\n${await page.evaluate(() => JSON.stringify({ l: { ...localStorage }, s: { ...sessionStorage }, c: document.cookie }))}`;
  return all;
}

test('AI settings: owner saves an encrypted key; a member cannot write; no browser surface ever holds the key or the ciphertext', async ({ browser }) => {
  test.setTimeout(300_000);
  const stub = await startStub();
  const KEY = 'sk-lt1-live-test-0123456789abcdef';
  const owner = await userWithHousehold(browser, 'ai-o', 'AI home', 'Olive');
  const memberUser = await createConfirmedUser('ai-m');
  const memberCtx = await browser.newContext();
  const memberPage = await memberCtx.newPage();
  const ownerBodies = recordBodies(owner.page);
  const memberBodies = recordBodies(memberPage);
  try {
    await signIn(memberPage, memberUser);
    await memberPage.goto(await createInviteLink(owner.page));
    await memberPage.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(memberPage).toHaveURL(/\/household$/);
    const hid = await householdIdOf(owner.user);

    // ---- owner: choose OpenAI-compatible (our stub), paste the key, save ----
    const p = owner.page;
    await p.goto('/settings');
    await expect(p.getByRole('heading', { name: 'AI provider' })).toBeVisible();
    await p.getByLabel('Provider', { exact: true }).selectOption('openai');
    await p.getByLabel('Endpoint (base URL)').fill(stub.url);
    await p.getByLabel('API key').fill(KEY);
    await p.getByRole('button', { name: 'Save AI settings' }).click();
    await expect(p.getByTestId('ai-notice')).toContainText('AI provider settings saved');
    await expect(p.getByTestId('ai-key-saved')).toContainText('API key saved:');
    const hint = (await p.getByTestId('ai-key-saved').locator('code').innerText()).trim();
    expect(hint).not.toBe(KEY);
    expect(hint.length).toBeLessThan(KEY.length);
    await expect(p.getByLabel('API key')).toHaveCount(0); // the field closes: write-only

    // Stored encrypted: service-role view of the row.
    const row = (await adminClient().from('household_ai_settings').select('*').eq('household_id', hid).single()).data!;
    expect(row.provider).toBe('openai');
    const enc = (row.keys as { openai: { enc: string; hint: string } }).openai.enc;
    expect(enc).toMatch(/^v1\./);
    expect(JSON.stringify(row)).not.toContain(KEY);
    expect(row.config.openai.baseUrl).toBe(stub.url);

    // Test connection decrypts server-side and calls the stub with the key (never mock for this provider).
    await p.getByRole('button', { name: 'Test connection' }).click();
    await expect(p.getByTestId('ai-notice')).toContainText('Connection works');
    expect(stub.seen.length).toBeGreaterThanOrEqual(1);
    expect(stub.seen.at(-1)!.authorization).toBe(`Bearer ${KEY}`);

    // ---- member: sees the household's masked state, cannot change it ----
    const m = memberPage;
    await m.goto('/settings');
    await expect(m.getByRole('heading', { name: 'AI provider' })).toBeVisible();
    await expect(m.getByTestId('ai-key-saved')).toContainText(hint);
    await m.getByLabel('Model').first().fill('gpt-member-attempt');
    await m.getByRole('button', { name: 'Save AI settings' }).click();
    await expect(m.getByText(/Only the household owner can change the AI provider/)).toBeVisible();
    const cm = await userClient(memberUser);
    const direct = await cm.rpc('save_household_ai_settings', { p_household_id: hid, p_provider: 'mock', p_config: {}, p_keys: {} });
    expect(direct.error?.code).toBe('42501');
    const unchanged = (await adminClient().from('household_ai_settings').select('provider, config, keys').eq('household_id', hid).single()).data!;
    expect(unchanged.provider).toBe('openai');
    expect(unchanged.config.openai.model).not.toBe('gpt-member-attempt');
    expect((unchanged.keys as { openai: { enc: string } }).openai.enc).toBe(enc);
    // A plaintext key can never be stored, even by the owner calling the RPC directly.
    const co = await userClient(owner.user);
    const plain = await co.rpc('save_household_ai_settings', { p_household_id: hid, p_provider: 'openai', p_config: {}, p_keys: { openai: { enc: KEY, hint: 'x' } } });
    expect(plain.error?.code).toBe('22023');
    // The table has no grants for clients.
    expect((await co.from('household_ai_settings').select('*')).error).not.toBeNull();
    expect((await memberPage.request.get('/api/health')).ok()).toBe(true);

    // ---- nothing the browser ever received contains the key or the ciphertext ----
    const paths = ['/settings', '/household', '/recipes', '/plan', '/shopping', '/receipts', '/pantry', '/api/health'];
    const surfaces = [await browserSurface(owner.page, paths), await browserSurface(memberPage, paths), ...ownerBodies, ...memberBodies];
    for (const s of surfaces) {
      expect(s).not.toContain(KEY);
      expect(s).not.toContain(enc);
      expect(s).not.toMatch(/\bv1\.[A-Za-z0-9+/=]{10,}\.[A-Za-z0-9+/=]{10,}\.[A-Za-z0-9+/=]{4,}/); // any ciphertext shape
    }
    expect(ownerBodies.join('').length).toBeGreaterThan(1000); // the recorder really saw traffic

    // ---- owner removes the key: row falls back to mock, ciphertext gone ----
    await owner.page.goto('/settings');
    await owner.page.getByRole('button', { name: 'Remove key' }).click();
    await owner.page.getByRole('dialog').getByRole('button', { name: 'Remove key' }).click();
    await expect(owner.page.getByTestId('ai-notice')).toContainText('Key removed');
    const gone = (await adminClient().from('household_ai_settings').select('provider, keys').eq('household_id', hid).single()).data!;
    expect(gone.keys).toEqual({});
    expect(gone.provider).toBe('mock');
  } finally {
    await memberCtx.close();
    await owner.context.close();
    await new Promise((r) => stub.server.close(r));
  }
});

test('AI settings: a key saved by household A is not used by, or visible to, household B (mock stays mock; Test connection works on the mock)', async ({ browser }: { browser: Browser }) => {
  const stub = await startStub();
  const a = await userWithHousehold(browser, 'aiiso-a', 'AI iso A');
  const b = await userWithHousehold(browser, 'aiiso-b', 'AI iso B');
  try {
    await a.page.goto('/settings');
    await a.page.getByLabel('Provider', { exact: true }).selectOption('openai');
    await a.page.getByLabel('Endpoint (base URL)').fill(stub.url);
    await a.page.getByLabel('API key').fill('sk-lt1-household-a-only-9876543210');
    await a.page.getByRole('button', { name: 'Save AI settings' }).click();
    await expect(a.page.getByTestId('ai-notice')).toContainText('AI provider settings saved');
    const seenBefore = stub.seen.length;

    await b.page.goto('/settings');
    await expect(b.page.getByRole('heading', { name: 'AI provider' })).toBeVisible();
    await expect(b.page.getByLabel('Provider', { exact: true })).toHaveValue('mock');
    await expect(b.page.getByTestId('ai-key-saved')).toHaveCount(0);
    await b.page.getByRole('button', { name: 'Test connection' }).click(); // enabled: nothing unsaved
    await expect(b.page.getByTestId('ai-notice')).toContainText('Connection works');
    expect(stub.seen.length).toBe(seenBefore); // B's test never reached A's endpoint
    const cb = await userClient(b.user);
    expect((await cb.rpc('get_household_ai_settings', { p_household_id: await householdIdOf(a.user) })).data ?? null).toBeNull();
  } finally {
    await a.context.close();
    await b.context.close();
    await new Promise((r) => stub.server.close(r));
  }
});

// ---------------------------------------------------------------------------------------------------------------------

const BEANS = '5009000000015';

test('barcode confirm stores a product snapshot for this household only; the pantry shows the item; the other household sees neither', async ({ browser }) => {
  test.setTimeout(240_000);
  const a = await userWithHousehold(browser, 'bc-a', 'Barcode home A');
  const b = await userWithHousehold(browser, 'bc-b', 'Barcode home B');
  try {
    // The lookup API answers for a signed-in household (offline mock product provider) and rejects the unsigned.
    const api = await a.page.request.get(`/api/products/${BEANS}`);
    expect(api.status()).toBe(200);
    expect((await api.json()).product.source.publisher).toBe('Open Food Facts');
    const anon = await browser.newContext();
    expect((await anon.request.get(`/api/products/${BEANS}`)).status()).toBe(401);
    await anon.close();

    const p = a.page;
    await p.goto('/pantry/scan');
    const input = p.getByTestId('ean-input');
    await expect(async () => {
      await input.fill(BEANS);
      await expect(p.getByTestId('ean-lookup')).toBeEnabled({ timeout: 500 });
    }).toPass({ timeout: 15_000 });
    await p.getByTestId('ean-lookup').click();
    await expect(p.getByTestId('barcode-status')).toContainText('Found: Hearth & Field Baked Beans');

    // Nothing stored until the owner confirms.
    const hidA = await householdIdOf(a.user);
    const ca = await userClient(a.user);
    expect((await ca.rpc('household_product_snapshots', { p_household_id: hidA })).data).toEqual([]);

    await p.getByTestId('review-barcodes').click();
    await expect(p.getByTestId('match-badge')).toContainText('Matched: baked beans');
    await p.getByRole('button', { name: 'Add 1 item to pantry' }).click();
    await expect(p.getByTestId('scan-done')).toContainText('Added 1 item to your pantry');

    const snaps = (await ca.rpc('household_product_snapshots', { p_household_id: hidA })).data as Array<{ barcode: string; ingredient_id: string | null; snapshot: { barcode: string; name: string } }>;
    expect(snaps).toHaveLength(1);
    expect(snaps[0]!.barcode).toBe(BEANS);
    expect(snaps[0]!.ingredient_id).not.toBeNull();
    expect(snaps[0]!.snapshot.name).toContain('Baked Beans');
    expect(JSON.stringify(snaps[0])).not.toMatch(/data:image|base64/i); // image URL is a hotlink only (D185): no image bytes stored

    // The pantry (a real pantry_items row, source barcode scan) and the household's data stay A's.
    await p.goto('/pantry');
    await expect(p.getByRole('list', { name: 'Tinned and jarred' })).toContainText('baked beans');
    const { data: pantry } = await ca.from('pantry_items').select('display_name, household_id').eq('household_id', hidA);
    expect(pantry!.map((r) => r.display_name.toLowerCase()).join(' ')).toContain('baked beans');

    const hidB = await householdIdOf(b.user);
    const cb = await userClient(b.user);
    expect((await cb.rpc('household_product_snapshots', { p_household_id: hidB })).data).toEqual([]);
    expect((await cb.rpc('household_product_snapshots', { p_household_id: hidA })).data ?? null).toBeNull();
    await b.page.goto('/pantry');
    await expect(b.page.getByRole('main')).not.toContainText('baked beans');
    expect((await cb.from('pantry_items').select('id').eq('household_id', hidA)).data ?? []).toHaveLength(0);
  } finally {
    await a.context.close();
    await b.context.close();
  }
});
