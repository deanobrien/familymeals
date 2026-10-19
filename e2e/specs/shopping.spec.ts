import { expect, test, type BrowserContext, type Page } from '@playwright/test';

// Shopping list UI (lane L17). Each test uses its own household (cookie `fr_household`), so tests are
// isolated from each other and from the default household that the smoke spec expects to be empty.
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

async function generate(page: Page) {
  await page.goto('/shopping?plan=demo-plan');
  await expect(tickBox(page, 'Onions')).toBeVisible();
  await expect(page).toHaveURL(/\/shopping$/);
  await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
}

test.describe('shopping list', () => {
  test('empty list offers to generate from the plan', async ({ context }) => {
    const page = await open(context, newHousehold());
    await expect(page.getByRole('heading', { name: 'Your list is empty' })).toBeVisible();
    await page.getByRole('button', { name: 'Generate from plan' }).click();
    await expect(tickBox(page, 'Onions')).toBeVisible();
  });

  test('generate from plan: grouped by aisle, estimate label, plan provenance', async ({ context }) => {
    const page = await open(context, newHousehold());
    await generate(page);
    for (const aisle of ['Fruit & veg', 'Meat & fish', 'Dairy & eggs', 'Tins & jars', 'Dry goods', 'Herbs & spices']) {
      await expect(page.getByRole('heading', { name: aisle })).toBeVisible();
    }
    // Aisle order follows the walk round the shop.
    const headings = await page.locator('h3.fr-shopcat').allTextContents();
    expect(headings.indexOf('Fruit & veg')).toBeLessThan(headings.indexOf('Meat & fish'));
    await expect(page.getByTestId('basket-total')).toContainText('estimate');
    await expect(page.getByTestId('basket-total')).toContainText('£');
    await expect(page.getByTestId('progress')).toContainText('0 of 11 items done');

    await page.getByRole('button', { name: 'From plan: where Onions comes from' }).click();
    const pop = page.getByRole('dialog', { name: /where Onions comes from/ });
    await expect(pop).toContainText('Chicken tikka masala');
    await expect(pop).toContainText('Spaghetti bolognese');
    await expect(pop).toContainText('Roasted tomato soup');
    await page.keyboard.press('Escape');
    await expect(pop).toBeHidden();
  });

  test('one-tap tick moves the item to purchased; undo toast restores it', async ({ context }) => {
    const page = await open(context, newHousehold());
    await generate(page);
    await tickBox(page, 'Spaghetti').click();
    await expect(tickBox(page, 'Spaghetti')).toHaveCount(0); // gone from the active view
    const toast = page.getByRole('status').filter({ hasText: 'Bought Spaghetti.' });
    await expect(toast).toBeVisible();
    await expect(page.getByTestId('purchase-row').filter({ hasText: 'Spaghetti' })).toBeVisible();
    await expect(page.getByTestId('progress')).toContainText('1 of 11 items done');

    await toast.getByRole('button', { name: 'Undo' }).click();
    await expect(tickBox(page, 'Spaghetti')).toBeVisible();
    await expect(page.getByTestId('purchase-row').filter({ hasText: 'Spaghetti' })).toHaveCount(0);
    await expect(page.getByTestId('progress')).toContainText('0 of 11 items done');
  });

  test('partial purchase leaves the remainder; hide/show completed', async ({ context }) => {
    const page = await open(context, newHousehold());
    await generate(page);
    await page.getByRole('button', { name: 'Bought some Chicken breast' }).click();
    const sheet = page.getByRole('dialog', { name: 'Bought some Chicken breast' });
    await sheet.getByLabel('Quantity bought').fill('200');
    await sheet.getByLabel(/Price paid/).fill('1.30');
    await sheet.getByRole('button', { name: 'Record purchase' }).click();
    const item = page.locator('[data-testid^="item-"][data-item-name="Chicken breast"]');
    await expect(item).toContainText('300 g left');
    await expect(item).toContainText('200 g of 500 g bought');
    await expect(page.getByTestId('purchase-row').filter({ hasText: 'Chicken breast' })).toContainText('£1.30');

    // Buy the rest, then toggle completed visibility.
    await tickBox(page, 'Chicken breast').click();
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
    await expect(page.getByTestId('basket-total')).toContainText('£0.72');

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
    await tickBox(page, 'Spaghetti').click();
    await expect(page.getByTestId('purchase-row').filter({ hasText: 'Spaghetti' })).toBeVisible();
    await expect(page.getByText('All changes saved')).toBeVisible();
    await page.goto('/shopping?plan=empty'); // the plan no longer needs anything
    await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
    await expect(page).toHaveURL(/\/shopping$/);
    const bought = page.getByTestId('purchase-row').filter({ hasText: 'Spaghetti' });
    await expect(bought).toContainText('Bought, no longer needed');
    await expect(tickBox(page, 'Onions')).toHaveCount(0); // un-bought plan items are dropped
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
      await expect(tickBox(b, 'Onions')).toBeVisible();

      await Promise.all([tickBox(a, 'Onions').click(), tickBox(b, 'Onions').click()]);

      const conflicts = (p: Page) => p.getByRole('alert').filter({ hasText: 'Another shopper already bought Onions' });
      await expect.poll(async () => (await conflicts(a).count()) + (await conflicts(b).count()), { timeout: 15_000 }).toBe(1);
      for (const p of [a, b]) {
        await expect(p.getByTestId('purchase-row').filter({ hasText: 'Onions' })).toHaveCount(1);
        await expect(p.getByTestId('pending-badge')).toHaveCount(0);
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
      await expect(tickBox(b, 'Beef mince')).toBeVisible();

      await ctxB.setOffline(true);
      await tickBox(b, 'Beef mince').click();
      await expect(b.getByTestId('sync-status')).toHaveAttribute('data-status', 'offline');

      await tickBox(a, 'Beef mince').click();
      await expect(a.getByTestId('purchase-row').filter({ hasText: 'Beef mince' })).toHaveCount(1);
      await expect(a.getByTestId('pending-badge')).toHaveCount(0);

      await ctxB.setOffline(false);
      await expect(b.getByRole('alert').filter({ hasText: 'Another shopper already bought Beef mince' })).toBeVisible({ timeout: 15_000 });
      await expect(b.getByTestId('purchase-row').filter({ hasText: 'Beef mince' })).toHaveCount(1);
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
      await tickBox(a, 'Basmati rice').click();
      await expect(tickBox(b, 'Basmati rice')).toHaveCount(0, { timeout: 15_000 });
      await expect(b.getByTestId('purchase-row').filter({ hasText: 'Basmati rice' })).toBeVisible();
    } finally {
      await ctxA.close();
      await ctxB.close();
    }
  });
});
