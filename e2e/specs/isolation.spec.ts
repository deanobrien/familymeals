// Household isolation (UI level) in mock-auth mode: two sandbox households (`fr_household=e2e-*` cookies) must never
// see each other's shopping list, plan, receipts or pantry. DB-level RLS lives in packages/db (PGlite) and is the
// primary control; cross-household checks that need real memberships are `fixme(true, 'needs live Supabase')`.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { SEED, enterHousehold, newHouseholdId, seedApprovedPlan } from '../support/helpers.js';
import { ShoppingListPage } from '../support/pages.js';

const RECEIPT_IMAGE = fileURLToPath(new URL('../fixtures/receipts/r1-weekly-shop.png', import.meta.url));

async function household(browser: import('@playwright/test').Browser, tag: string): Promise<{ id: string; context: BrowserContext; page: Page }> {
  const id = newHouseholdId(`iso-${tag}`);
  const context = await browser.newContext();
  await enterHousehold(context, id);
  return { id, context, page: await context.newPage() };
}

async function generated(h: { context: BrowserContext; page: Page }) {
  const planId = await seedApprovedPlan(h.context, [{ recipeId: SEED.pasta, servings: 4 }]);
  await h.page.goto(`/shopping?plan=${planId}`);
  const list = new ShoppingListPage(h.page);
  await expect(list.tick('Onion')).toBeVisible({ timeout: 60_000 });
  await h.page.waitForFunction(() => document.querySelector('[data-testid="shopping-root"]')?.getAttribute('data-hydrated') === 'true');
  return { planId, list };
}

test.describe('Household isolation', () => {
  test('B does not see A shopping list items, purchases or plan-generated lists', async ({ browser }) => {
    const a = await household(browser, 'a');
    const b = await household(browser, 'b');
    try {
      const { list } = await generated(a);
      await list.tick('Onion').click();
      await expect(list.purchase('Onion')).toHaveCount(1);
      await a.page.getByRole('button', { name: 'Add item' }).click();
      const sheet = a.page.getByRole('dialog', { name: 'Add an item' });
      await sheet.getByLabel('Item name').fill('A-only bin bags');
      await sheet.getByRole('button', { name: 'Add to list' }).click();
      await expect(list.item('A-only bin bags')).toBeVisible();

      const theirs = new ShoppingListPage(b.page);
      await theirs.gotoHydrated();
      await expect(b.page.getByRole('heading', { name: 'Your list is empty' })).toBeVisible();
      await expect(theirs.item('A-only bin bags')).toHaveCount(0);
      await expect(theirs.purchase('Onion')).toHaveCount(0);
      await expect(theirs.tick('Onion')).toHaveCount(0);
    } finally { await a.context.close(); await b.context.close(); }
  });

  test('B using A plan id cannot generate or read A list (no existence leak)', async ({ browser }) => {
    const a = await household(browser, 'a');
    const b = await household(browser, 'b');
    try {
      const { planId } = await generated(a);
      await b.page.goto(`/shopping?plan=${planId}`);
      const theirs = new ShoppingListPage(b.page);
      await theirs.root().waitFor();
      await expect(theirs.tick('Onion')).toHaveCount(0);
      await expect(theirs.item('Pasta')).toHaveCount(0);
      await expect(b.page.getByRole('heading', { name: 'Your list is empty' })).toBeVisible();
      // the plan itself is scoped too: B's planner for A's week is empty
      await b.page.goto('/plan?week=2026-11-02');
      await expect(b.page.getByTestId('week-cost')).toContainText('No meals planned yet');
    } finally { await a.context.close(); await b.context.close(); }
  });

  test('unknown recipe ids and non-existent REST endpoints answer 404 (no data endpoint to craft a cross-household call)', async ({ browser }) => {
    const b = await household(browser, 'b');
    try {
      await b.page.goto('/recipes/a1a1a103-0000-4000-8000-000000000001');
      await expect(b.page.getByRole('heading', { name: 'Recipe not found' })).toBeVisible(); // streamed not-found page (dev answers 200)
      // shopping writes only exist as same-origin server actions bound to the cookie household; there is no id-addressed REST route
      const r = await b.page.request.post('/api/shopping/purchase', { data: { shoppingListItemId: 'a1a1a108-0000-4000-8000-000000000001' } });
      expect(r.status()).toBe(404);
    } finally { await b.context.close(); }
  });

  test('a purchase by A does not reach B through polling', async ({ browser }) => {
    const a = await household(browser, 'a');
    const b = await household(browser, 'b');
    try {
      const { list: mine } = await generated(a);
      const { list: theirs } = await generated(b); // same recipe, separate list
      await mine.tick('Onion').click();
      await expect(mine.purchase('Onion')).toHaveCount(1);
      // give B's poller several cycles to (wrongly) pick it up
      await b.page.waitForTimeout(8_000);
      await expect(theirs.tick('Onion')).toBeVisible();
      await expect(theirs.purchase('Onion')).toHaveCount(0);
      await expect(theirs.progress()).toContainText(/^0 of \d+ items done/);
    } finally { await a.context.close(); await b.context.close(); }
  });

  test('receipts are household-scoped: B does not see A uploaded receipt', async ({ browser }) => {
    const a = await household(browser, 'a');
    const b = await household(browser, 'b');
    try {
      await a.page.goto('/receipts');
      await a.page.getByLabel('Receipt photo').setInputFiles(RECEIPT_IMAGE);
      await a.page.getByRole('button', { name: 'Scan receipt' }).click();
      await expect(a.page).toHaveURL(/\/receipts\/([^/]+)\/review$/, { timeout: 60_000 });
      const receiptPath = new URL(a.page.url()).pathname;
      await a.page.goto('/receipts');
      const rows = (p: Page) => p.getByRole('list', { name: 'Past receipts' }).getByTestId('receipt-row');
      const aCount = await rows(a.page).count();

      await b.page.goto('/receipts');
      await expect(b.page.getByRole('heading', { level: 1, name: 'Receipts' })).toBeVisible();
      await expect(rows(b.page)).toHaveCount(aCount - 1);
      // and A's review URL is not readable from B
      const res = await b.page.goto(receiptPath);
      expect(res?.status()).toBe(404);
    } finally { await a.context.close(); await b.context.close(); }
  });

  test('pantry stock is household-scoped: an item added by A is not in B', async ({ browser }) => {
    const a = await household(browser, 'a');
    const b = await household(browser, 'b');
    try {
      await a.page.goto('/pantry');
      await a.page.getByLabel('Ingredient', { exact: true }).fill('basmati');
      await a.page.getByRole('list', { name: 'Ingredient matches' }).getByRole('button', { name: /basmati rice/ }).click();
      await a.page.getByLabel('Quantity', { exact: true }).fill('750');
      await a.page.getByRole('button', { name: 'Add to pantry' }).click();
      await expect(a.page.getByRole('list', { name: 'Pasta, rice and grains' })).toContainText('basmati rice');

      await b.page.goto('/pantry');
      await expect(b.page.getByRole('heading', { level: 1, name: 'Pantry' })).toBeVisible();
      await expect(b.page.getByRole('list', { name: 'Pasta, rice and grains' })).not.toContainText('basmati rice');
    } finally { await a.context.close(); await b.context.close(); }
  });

  test('B cannot see A recipes in library or search', async ({ browser }) => {
    const a = await household(browser, 'a');
    const b = await household(browser, 'b');
    try {
      await a.page.goto('/recipes/' + SEED.pasta);
      await a.page.getByRole('button', { name: 'Duplicate' }).click();
      await expect(a.page.getByRole('heading', { level: 1, name: /\(copy\)$/ })).toBeVisible();
      const copyPath = new URL(a.page.url()).pathname;
      const copies = (p: Page) => p.getByRole('list', { name: 'Recipes', exact: true }).getByRole('link').filter({ hasText: '(copy)' });
      await a.page.goto('/recipes?q=copy');
      await expect(copies(a.page)).toHaveCount(1);

      await b.page.goto('/recipes?q=copy');
      await expect(b.page.getByRole('heading', { level: 1, name: 'Recipes' })).toBeVisible();
      await expect(copies(b.page)).toHaveCount(0);
      await b.page.goto(copyPath); // not-found renders inside a streamed (200) shell, so assert on content
      await expect(b.page.getByRole('heading', { level: 1, name: /\(copy\)$/ })).toHaveCount(0);
      await expect(b.page.getByRole('button', { name: 'Duplicate' })).toHaveCount(0);
      // B still has its own copy of the seed library
      await b.page.goto('/recipes/' + SEED.pasta);
      await expect(b.page.getByRole('heading', { level: 1, name: 'Sunday Tomato Pasta' })).toBeVisible();
    } finally { await a.context.close(); await b.context.close(); }
  });

  test('B realtime channel receives no A events', async () => {
    test.fixme(true, 'needs live Supabase (no Realtime channel in mock mode; polling isolation is covered above)');
  });

  test('removed member loses access immediately (session + realtime)', async () => {
    test.fixme(true, 'needs live Supabase');
  });

  test('expired / revoked invite link cannot be used', async () => {
    test.fixme(true, 'needs live Supabase (partly covered by auth.spec route-protection tests)');
  });
});
