// Live Supabase shopping (S2 repository + Realtime) through the real UI: plan -> approve -> list -> two members.
import { expect, test, type Page } from '@playwright/test';
import { MealPlanPage } from '../support/pages.js';
import { createConfirmedUser, createInviteLink, householdIdOf, signIn, userClient, userWithHousehold } from './support/live.js';

const tickBox = (page: Page, name: string) => page.getByRole('checkbox', { name: new RegExp(`^${name}`, 'i') });

async function openShopping(page: Page) {
  await page.goto('/shopping');
  await expect(page.getByRole('heading', { level: 1, name: 'Shopping list' })).toBeVisible();
  await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
}

test('two members: a tick appears on the other screen without reload; a simultaneous tick gives one purchase', async ({ browser }) => {
  const owner = await userWithHousehold(browser, 'shop-a', 'Shop Home', 'Ann');
  const member = await createConfirmedUser('shop-b');
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  try {
    // Recipe with two lines, planned and approved, list generated.
    const a = owner.page;
    await a.goto('/recipes/new');
    await a.getByRole('textbox', { name: 'Title', exact: true }).fill('Live Onion Soup');
    await a.getByRole('textbox', { name: 'Ingredient 1 name' }).fill('onion');
    await a.getByRole('spinbutton', { name: 'Ingredient 1 amount' }).fill('3');
    await a.getByRole('combobox', { name: 'Ingredient 1 unit' }).selectOption('item');
    await a.getByRole('button', { name: 'Add ingredient' }).click();
    await a.getByRole('textbox', { name: 'Ingredient 2 name' }).fill('carrot');
    await a.getByRole('spinbutton', { name: 'Ingredient 2 amount' }).fill('2');
    await a.getByRole('combobox', { name: 'Ingredient 2 unit' }).selectOption('item');
    await a.getByRole('textbox', { name: 'Step 1', exact: true }).fill('Simmer.');
    await a.getByRole('button', { name: 'Create recipe' }).click();
    await expect(a).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);

    const W = '2026-11-09';
    const plan = new MealPlanPage(a);
    await a.goto(`/plan?week=${W}`);
    await plan.addToSlot(W, 'dinner').click();
    await a.getByRole('dialog').getByRole('searchbox').fill('Live Onion Soup');
    await a.getByRole('dialog').getByRole('button', { name: 'Select Live Onion Soup' }).click();
    await a.getByRole('button', { name: 'Save plan' }).click();
    await expect(a.getByTestId('plan-message')).toContainText('Plan saved');
    await plan.approve().click();
    await expect(a.getByText('Approved', { exact: true }).first()).toBeVisible();
    await plan.generateList().click();
    await expect(a.getByRole('link', { name: 'Open shopping list' })).toBeVisible();

    const link = await createInviteLink(a);
    await signIn(b, member);
    await b.goto(link);
    await b.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(b).toHaveURL(/\/household$/);

    await openShopping(a);
    await openShopping(b);
    await expect(tickBox(a, 'Onion')).toBeVisible();
    await expect(tickBox(b, 'Onion')).toBeVisible();

    // Realtime: A ticks carrot, B's list updates with no reload.
    await tickBox(a, 'Carrot').click();
    await expect(tickBox(a, 'Carrot')).toHaveCount(0);
    await expect(tickBox(b, 'Carrot')).toHaveCount(0, { timeout: 10_000 });
    await expect(b.getByTestId('purchase-row').filter({ hasText: /carrot/i })).toHaveCount(1);

    // Both tick onion at once: one purchase in Postgres, one conflict shown.
    await Promise.all([tickBox(a, 'Onion').click(), tickBox(b, 'Onion').click()]);
    const conflicts = (p: Page) => p.getByRole('alert').filter({ hasText: /already bought Onion/i });
    await expect.poll(async () => (await conflicts(a).count()) + (await conflicts(b).count()), { timeout: 15_000 }).toBe(1);
    const c = await userClient(owner.user);
    const hid = await householdIdOf(owner.user);
    const { data: events } = await c.from('purchase_events').select('id, voided_at').eq('household_id', hid).is('voided_at', null);
    expect(events).toHaveLength(2); // carrot + onion, never two onions
    for (const p of [a, b]) await expect(p.getByTestId('purchase-row').filter({ hasText: /onion/i })).toHaveCount(1);
  } finally {
    await ctxB.close();
    await owner.context.close();
  }
});
