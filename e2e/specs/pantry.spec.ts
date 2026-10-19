import { expect, test } from '@playwright/test';

// The pantry runs on a process-wide in-memory repository seeded at server start, so these tests are
// serial and each one touches different items.
test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
  await page.goto('/pantry');
  await expect(page.getByRole('heading', { level: 1, name: 'Pantry' })).toBeVisible();
});

test('stock is grouped by category with expiry badges', async ({ page }) => {
  await expect(page.getByRole('heading', { level: 3, name: 'Dairy and eggs' })).toBeVisible();
  const dairy = page.getByRole('list', { name: 'Dairy and eggs' });
  await expect(dairy).toContainText('milk');
  await expect(dairy).toContainText('Expired');
  await expect(dairy).toContainText('Expires tomorrow');
  await expect(page.getByRole('list', { name: 'Expiring items' })).toContainText('milk');
});

test('stale stock asks for confirmation and one tap confirms it', async ({ page }) => {
  const prompts = page.getByRole('list', { name: 'Stock to confirm' });
  await expect(prompts).toContainText('lemon');
  await page.getByRole('button', { name: 'Confirm lemon is still in stock' }).click();
  await expect(prompts).not.toContainText('lemon');
  await expect(page.getByRole('list', { name: 'Stock to confirm' })).toContainText('carrot');
});

test('add an item via ingredient search, correct it, then remove it', async ({ page }) => {
  await page.getByLabel('Ingredient', { exact: true }).fill('basmati');
  await page.getByRole('list', { name: 'Ingredient matches' }).getByRole('button', { name: /basmati rice/ }).click();
  await expect(page.getByText('Matched: basmati rice')).toBeVisible();
  await page.getByLabel('Quantity', { exact: true }).fill('750');
  await page.getByRole('button', { name: 'Add to pantry' }).click();
  const grains = page.getByRole('list', { name: 'Pasta, rice and grains' });
  await expect(grains).toContainText('basmati rice');
  await expect(grains).toContainText('750 g');

  await page.getByRole('button', { name: 'Correct basmati rice' }).first().click();
  const form = page.getByRole('form', { name: 'Correct basmati rice' });
  await form.getByLabel('Actual quantity').fill('2');
  await form.getByLabel('Unit').selectOption('kg');
  await form.getByRole('button', { name: 'Save correction' }).click();
  await expect(grains).toContainText('2 kg');

  await page.getByRole('button', { name: 'Remove basmati rice' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('list', { name: 'Pasta, rice and grains' })).not.toContainText('basmati rice');
});

test('rejects an invalid quantity', async ({ page }) => {
  await page.getByLabel('Ingredient', { exact: true }).fill('mystery');
  await page.getByLabel('Quantity', { exact: true }).fill('-2');
  await page.getByRole('button', { name: 'Add to pantry' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'more than zero' })).toBeVisible();
});

test('use what I have ranks recipes with explanations and links to the recipe', async ({ page }) => {
  const list = page.getByRole('list', { name: 'Recipe suggestions' });
  await expect(list.getByRole('link').first()).toHaveAttribute('href', /^\/recipes\/[0-9a-f-]{36}$/); // library ids (shared recipe store)
  await expect(list).toContainText('covered by pantry');
});

test('pending purchases can be accepted or ignored', async ({ page }) => {
  const pending = page.getByRole('list', { name: 'Pending purchases' });
  await expect(pending).toContainText('chicken breast');
  await expect(pending).not.toContainText('cheddar'); // voided purchase is never suggested
  await page.getByRole('button', { name: 'Add chicken breast to pantry' }).click();
  await expect(page.getByRole('list', { name: 'Meat and poultry' })).toContainText('chicken breast');
  await page.getByRole('button', { name: 'Ignore Mixed salad bag' }).click();
  await expect(page.getByRole('list', { name: 'Pending purchases' })).not.toContainText('Mixed salad bag');
});

test('leftovers helper suggests slots and links to the planner', async ({ page }) => {
  await expect(page.getByRole('list', { name: /Suggested slots for Slow Winter Beef Stew/ })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open meal planner' }).first()).toHaveAttribute('href', '/plan');
  await page.getByLabel('Meal', { exact: true }).fill('Chilli');
  await page.getByRole('button', { name: 'Suggest slots' }).click();
  await expect(page.getByRole('list', { name: 'Suggested slots for Chilli' })).toBeVisible();
});

test('settings persist post-purchase mode and staleness days', async ({ page }) => {
  const form = page.getByRole('form', { name: 'Pantry settings' });
  await form.getByLabel('After I buy something').selectOption('auto');
  await form.getByLabel(/Ask me to confirm stock after/).fill('30');
  await form.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('Settings saved')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('form', { name: 'Pantry settings' }).getByLabel('After I buy something')).toHaveValue('auto');
  await expect(page.getByRole('form', { name: 'Pantry settings' }).getByLabel(/Ask me to confirm stock after/)).toHaveValue('30');
});
