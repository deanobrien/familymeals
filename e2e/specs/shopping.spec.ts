import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Shopping list UI (lane L17). Each test uses its own sandbox household (mock auth: cookie `fr_household=e2e-*`),
// so tests are isolated from each other and from household A, which the smoke spec expects to be empty.
// Lists are generated from a real APPROVED plan (seeded via the dev-only /api/dev/seed) over the recipe store:
// Sunday Tomato Pasta + Smoky Chickpea Stew + Slow Winter Beef Stew = 22 aggregated items.
// Sync is against the in-memory repository behind server actions.

let seq = 0;
const newHousehold = () => `e2e-${Date.now().toString(36)}-${++seq}-${Math.random().toString(36).slice(2, 6)}`;

async function open(context: BrowserContext, household: string, path = '/shopping'): Promise<Page> {
  await context.addCookies([{ name: 'fr_household', value: household, domain: 'localhost', path: '/' }]);
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.getByRole('heading', { level: 1, name: 'Shopping list' })).toBeVisible();
  await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
  return page;
}

const tickBox = (page: Page, name: string) => page.getByRole('checkbox', { name: new RegExp(`^${name}`) });

const PASTA = '00000000-0000-4000-8000-000000000001';
const BEEF_STEW = '00000000-0000-4000-8000-000000000003';
const CHICKPEA_STEW = '00000000-0000-4000-8000-000000000008';
const WEEK_PLAN = [
  { recipeId: PASTA, servings: 4 },
  { recipeId: CHICKPEA_STEW, servings: 4 },
  { recipeId: BEEF_STEW, servings: 6 },
];

/** Approve a plan for the page's (cookie) household through the dev-only seed endpoint. */
async function seedPlan(page: Page, entries = WEEK_PLAN): Promise<string> {
  const res = await page.context().request.post('/api/dev/seed', { data: { kind: 'approved-plan', entries } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { planId: string }).planId;
}

async function generate(page: Page) {
  const planId = await seedPlan(page);
  await page.goto(`/shopping?plan=${planId}`);
  await expect(tickBox(page, 'Onion')).toBeVisible();
  await expect(page).toHaveURL(/\/shopping$/);
  await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
}

test.describe('shopping list', () => {
  test('empty list offers to generate from the plan', async ({ context }) => {
    const page = await open(context, newHousehold());
    await expect(page.getByRole('heading', { name: 'Your list is empty' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Plan your week first' })).toBeVisible(); // no approved plan yet
    await seedPlan(page);
    await page.reload();
    await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
    await page.getByRole('button', { name: 'Generate from plan' }).click();
    await expect(tickBox(page, 'Onion')).toBeVisible();
  });

  test('generate from plan: grouped by aisle, estimate label, plan provenance', async ({ context }) => {
    const page = await open(context, newHousehold());
    await generate(page);
    for (const aisle of ['Fruit & veg', 'Tins & jars', 'Dry goods', 'Herbs & spices', 'Other']) {
      await expect(page.getByRole('heading', { name: aisle })).toBeVisible();
    }
    // Aisle order follows the walk round the shop.
    const headings = await page.locator('h3.fr-shopcat').allTextContents();
    expect(headings.indexOf('Fruit & veg')).toBeLessThan(headings.indexOf('Tins & jars'));
    await expect(page.getByTestId('basket-total')).toContainText('estimate');
    await expect(page.getByTestId('basket-total')).toContainText('£');
    await expect(page.getByTestId('progress')).toContainText('0 of 22 items done');

    // Onion come from two recipes (aggregated by @fr/engine/aggregate).
    await page.getByRole('button', { name: 'From plan: where Onion comes from' }).click();
    const pop = page.getByRole('dialog', { name: /where Onion comes from/ });
    await expect(pop).toContainText('Sunday Tomato Pasta');
    await expect(pop).toContainText('Slow Winter Beef Stew');
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
  });

  test('one-tap tick moves the item to purchased; undo toast restores it', async ({ context }) => {
    const page = await open(context, newHousehold());
    await generate(page);
    await tickBox(page, 'Pasta').click();
    await expect(tickBox(page, 'Pasta')).toHaveCount(0); // gone from the active view
    const toast = page.getByRole('status').filter({ hasText: 'Bought Pasta.' });
    await expect(toast).toBeVisible();
    await expect(page.getByTestId('purchase-row').filter({ hasText: 'Pasta' })).toBeVisible();
    await expect(page.getByTestId('progress')).toContainText('1 of 22 items done');

    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(tickBox(page, 'Pasta')).toBeVisible();
    await expect(page.getByTestId('purchase-row').filter({ hasText: 'Pasta' })).toHaveCount(0);
    await expect(page.getByTestId('progress')).toContainText('0 of 22 items done');
  });

  test('partial purchase leaves the remainder; hide/show completed', async ({ context }) => {
    const page = await open(context, newHousehold());
    await generate(page);
    await page.getByRole('button', { name: 'Bought some Potato' }).click();
    const sheet = page.getByRole('dialog', { name: 'Bought some Potato' });
    await sheet.getByLabel('Quantity bought').fill('200');
    await sheet.getByLabel(/Price paid/).fill('1.30');
    await sheet.getByRole('button', { name: 'Record purchase' }).click();
    const item = page.locator('[data-testid^="item-"][data-item-name="Potato"]');
    await expect(item).toContainText('300 g left');
    await expect(item).toContainText('200 g of 500 g bought');
    await expect(page.getByTestId('purchase-row').filter({ hasText: 'Potato' })).toContainText('£1.30');

    // Buy the rest, then toggle completed visibility.
    await tickBox(page, 'Potato').click();
    await expect(item).toHaveCount(0);
    await page.getByLabel('Show completed items').check();
    await expect(item).toHaveAttribute('data-status', 'complete');
    await page.getByLabel('Show completed items').uncheck();
    await expect(item).toHaveCount(0);
  });

  test('manual add, edit and remove', async ({ context }) => {
    const page = await open(context, newHousehold());
    await page.getByRole('button', { name: 'Add item' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add an item' });
    await sheet.getByLabel('Item name').fill('Bananas');
    await sheet.getByLabel('Quantity', { exact: true }).fill('6');
    await sheet.getByLabel('Category').selectOption('Fruit & veg');
    await sheet.getByLabel('Note').fill('not too green');
    await sheet.getByRole('button', { name: 'Add to list' }).click();
    const item = page.locator('[data-testid^="item-"][data-item-name="Bananas"]');
    await expect(item).toContainText('6');
    await expect(item).toContainText('not too green');
    await expect(item).toContainText('Added by hand');
    await expect(page.getByTestId('basket-total')).toContainText('£1.08'); // refdata generic estimate: 90p per 5 bananas

    await page.getByRole('button', { name: 'Edit Bananas' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit Bananas' });
    await edit.getByLabel('Item name').fill('Green bananas');
    await edit.getByLabel('Quantity', { exact: true }).fill('4');
    await edit.getByRole('button', { name: 'Save changes' }).click();
    const renamed = page.locator('[data-testid^="item-"][data-item-name="Green bananas"]');
    await expect(renamed).toContainText('4');

    await page.getByRole('button', { name: 'Edit Green bananas' }).click();
    await page.getByRole('dialog', { name: 'Edit Green bananas' }).getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Remove item' }).click();
    await expect(renamed).toHaveCount(0);
  });

  test('plan drops an item that was already bought: shown as bought, no longer needed', async ({ context }) => {
    const page = await open(context, newHousehold());
    await generate(page);
    await tickBox(page, 'Pasta').click();
    await expect(page.getByTestId('purchase-row').filter({ hasText: 'Pasta' })).toBeVisible();
    await expect(page.getByText('All changes saved')).toBeVisible();
    const smaller = await seedPlan(page, [{ recipeId: CHICKPEA_STEW, servings: 4 }]); // no pasta, no carrots
    await page.goto(`/shopping?plan=${smaller}`);
    await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
    await expect(page).toHaveURL(/\/shopping$/);
    const bought = page.getByTestId('purchase-row').filter({ hasText: 'Pasta' });
    await expect(bought).toContainText('Bought, no longer needed');
    await expect(tickBox(page, 'Carrot')).toHaveCount(0); // un-bought plan items are dropped
  });

  test('offline tick queues with a pending badge and replays on reconnect', async ({ context }) => {
    const page = await open(context, newHousehold());
    await generate(page);
    await context.setOffline(true);
    await tickBox(page, 'Garlic').click();
    await expect(tickBox(page, 'Garlic')).toHaveCount(0); // optimistic
    await page.getByLabel('Show completed items').check();
    await expect(page.getByTestId('pending-badge')).toBeVisible();
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'offline');
    await context.setOffline(false);
    await expect(page.getByTestId('pending-badge')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.getByTestId('sync-status')).toHaveAttribute('data-status', 'synced');
    // Survives a reload: the purchase is on the server.
    await page.reload();
    await expect(page.getByTestId('purchase-row').filter({ hasText: 'Garlic' })).toBeVisible();
  });

  test('two shoppers tick the same item at once: one purchase, one conflict', async ({ browser }) => {
    const household = newHousehold();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const a = await open(ctxA, household);
      await generate(a);
      const b = await open(ctxB, household);
      await expect(tickBox(b, 'Onion')).toBeVisible();

      await Promise.all([tickBox(a, 'Onion').click(), tickBox(b, 'Onion').click()]);

      const conflicts = (p: Page) => p.getByRole('alert').filter({ hasText: 'Another shopper already bought Onion' });
      await expect.poll(async () => (await conflicts(a).count()) + (await conflicts(b).count()), { timeout: 15_000 }).toBe(1);
      for (const p of [a, b]) {
        await expect(p.getByTestId('purchase-row').filter({ hasText: 'Onion' })).toHaveCount(1);
        await expect(p.getByTestId('sync-status')).toHaveText('All changes saved'); // confirmed by the server, not just optimistic
      }
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('offline shopper loses the race: conflict toast on reconnect, single purchase', async ({ browser }) => {
    const household = newHousehold();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const a = await open(ctxA, household);
      await generate(a);
      const b = await open(ctxB, household);
      await expect(tickBox(b, 'Carrot')).toBeVisible();

      await ctxB.setOffline(true);
      await tickBox(b, 'Carrot').click();
      await expect(b.getByTestId('sync-status')).toHaveAttribute('data-status', 'offline');

      await tickBox(a, 'Carrot').click();
      await expect(a.getByTestId('purchase-row').filter({ hasText: 'Carrot' })).toHaveCount(1);
      // The tick must be CONFIRMED by the server before B reconnects (the purchase row is optimistic and the pending badge
      // only decorates list rows, so neither proves it): otherwise B's replay can reach the server first and win (D164).
      await expect(a.getByTestId('sync-status')).toHaveText('All changes saved');

      await ctxB.setOffline(false);
      await expect(b.getByRole('alert').filter({ hasText: 'Another shopper already bought Carrot' })).toBeVisible({ timeout: 15_000 });
      await expect(b.getByTestId('purchase-row').filter({ hasText: 'Carrot' })).toHaveCount(1);
      await expect(a.getByRole('alert').filter({ hasText: 'already bought' })).toHaveCount(0);
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });

  test('polling picks up changes made on another device', async ({ browser }) => {
    const household = newHousehold();
    const ctxA = await browser.newContext();
    const ctxB = await browser.newContext();
    try {
      const a = await open(ctxA, household);
      await generate(a);
      const b = await open(ctxB, household);
      await tickBox(a, 'Red pepper').click();
      await expect(tickBox(b, 'Red pepper')).toHaveCount(0, { timeout: 15_000 });
      await expect(b.getByTestId('purchase-row').filter({ hasText: 'Red pepper' })).toBeVisible();
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
