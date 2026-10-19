import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

async function serious(page: import('@playwright/test').Page) {
  const r = await new AxeBuilder({ page }).analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes[0]?.target}`);
}

test('home dashboard shows plan, basket, shopping progress and quick-add links', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'Home' })).toBeVisible();
  await expect(page.getByText('3 of 7 meals planned')).toBeVisible();
  await expect(page.getByText('£11.00')).toBeVisible();
  await expect(page.getByText('Estimate, partial: 4 of 5 items priced')).toBeVisible();
  await expect(page.getByText('2 of 5 items')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Write a new recipe' })).toHaveAttribute(
    'href',
    '/recipes/new',
  );
  await expect(page.getByRole('link', { name: /Import from a link/ })).toHaveAttribute(
    'href',
    '/recipes/import',
  );
  expect(await serious(page)).toEqual([]);
});

test('settings: validation, consent required, export and delete flows', async ({ page }) => {
  await page.goto('/settings');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  expect(await serious(page)).toEqual([]);

  await page.getByLabel('Default servings').fill('0');
  await page.getByRole('button', { name: 'Save preferences' }).click();
  await expect(page.getByText('Servings must be between 1 and 24')).toBeVisible();

  await page.getByLabel('peanuts').check();
  await page.getByRole('button', { name: 'Save dietary information' }).click();
  await expect(page.getByText(/tick the box to agree/)).toBeVisible();
  await page.getByLabel('I agree to this use of my dietary information.').check();
  await page.getByRole('button', { name: 'Save dietary information' }).click();
  await expect(page.getByText('Dietary information saved')).toBeVisible();

  await page.getByRole('button', { name: 'Request data export' }).click();
  await expect(page.getByRole('button', { name: 'Export requested' })).toBeDisabled();

  await page.getByRole('button', { name: 'Delete household' }).first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('14 days');
  await dialog.getByRole('button', { name: 'Delete household' }).click();
  await expect(page.getByRole('button', { name: 'Deletion scheduled' })).toBeDisabled();
});

test('privacy notice renders and marks TBD items', async ({ page }) => {
  await page.goto('/privacy');
  await expect(page.getByRole('heading', { level: 1, name: 'Privacy notice' })).toBeVisible();
  await expect(page.getByText('[TBD: privacy email]').first()).toBeVisible();
});
