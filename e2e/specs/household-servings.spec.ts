// A recipe that serves 2 opens scaled to the household default (4); a manual per-recipe override persists.
import { expect, test } from '@playwright/test';

test('recipe serving 2 opens at the household 4 and remembers a manual override', async ({ page }) => {
  const title = `E2E Servings Two ${Date.now().toString(36)}`;
  await page.goto('/recipes/new');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await page.getByLabel('Servings', { exact: true }).fill('2');
  await page.getByRole('textbox', { name: 'Ingredient 1 name' }).fill('flour');
  await page.getByRole('spinbutton', { name: 'Ingredient 1 amount' }).fill('200');
  await page.getByRole('combobox', { name: 'Ingredient 1 unit' }).selectOption('g');
  await page.getByRole('textbox', { name: 'Step 1', exact: true }).fill('Mix.');
  await page.getByRole('button', { name: 'Create recipe' }).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);

  const qty = page.getByTestId('ingredient-qty').first();
  await expect(qty).toHaveText('400 g');
  await expect(page.getByTestId('servings-note')).toHaveText('Recipe serves 2 · showing for 4 (your household)');

  await page.getByRole('button', { name: 'Original (2)' }).click();
  await expect(qty).toHaveText('200 g');
  await page.getByRole('button', { name: 'Reset to household (4)' }).click();
  await expect(qty).toHaveText('400 g');

  await page.getByRole('button', { name: 'Increase servings' }).click();
  await page.getByRole('button', { name: 'Increase servings' }).click(); // 6
  await expect(qty).toHaveText('600 g');
  await page.reload();
  await expect(qty).toHaveText('600 g');
  await expect(page.getByTestId('servings-note')).toContainText('showing for 6');

  await page.getByRole('button', { name: 'Reset to household (4)' }).click();
  await page.reload();
  await expect(qty).toHaveText('400 g');

  await page.getByRole('button', { name: /^Delete/ }).click();
  await page.getByRole('button', { name: 'Delete recipe' }).click();
  await expect(page).toHaveURL(/\/recipes/);
});
