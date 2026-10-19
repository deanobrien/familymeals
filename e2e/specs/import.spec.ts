// L13: recipe photo import workflow (mock AI provider; deterministic "Nana's Lentil Soup" extraction).
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { FIXTURES_DIR } from '../support/helpers.js';

const img = (f: string) => join(FIXTURES_DIR, 'recipes', f);

test.describe('recipe photo import', () => {
  test('upload two pages, reorder, extract, correct, save', async ({ page }) => {
    await page.goto('/recipes/import');
    await expect(page.getByRole('heading', { level: 1, name: /import a recipe/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Extract recipe' })).toBeDisabled();

    await page.getByTestId('photo-input').setInputFiles([img('03-beef-stew-two-page-p1.png'), img('03-beef-stew-two-page-p2.png')]);
    const items = page.getByTestId('page-item');
    await expect(items).toHaveCount(2);
    await expect(items.nth(0)).toContainText('p1.png');
    await expect(items.nth(0).getByRole('img')).toHaveAttribute('alt', 'Preview of page 1');

    await page.getByRole('button', { name: 'Move page 2 earlier' }).click();
    await expect(items.nth(0)).toContainText('p2.png');
    await page.getByRole('button', { name: 'Move page 2 earlier' }).click();
    await expect(items.nth(0)).toContainText('p1.png');

    await page.getByRole('button', { name: 'Extract recipe' }).click();

    // Review screen
    await expect(page.getByRole('heading', { name: 'Review recipe' })).toBeVisible();
    const title = page.getByLabel('Title', { exact: true });
    await expect(title).toHaveValue("Nana's Lentil Soup");
    await expect(page.getByText('Suggested by AI')).toBeVisible();
    await expect(page.getByTestId('ingredient-row')).toHaveCount(6);
    await expect(page.getByLabel('Ingredient 1 name: OK')).toBeVisible();
    await expect(page.getByTestId('step-row')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Save recipe' })).toBeEnabled();

    // inline corrections
    await page.getByLabel('Servings', { exact: true }).fill('6');
    await page.getByLabel('Ingredient 1 name', { exact: true }).fill('split red lentils');
    await page.getByLabel('Ingredient 1 amount').fill('250');
    await page.getByLabel('Ingredient 6 quantity type').selectOption('unparsed');

    // an unparsed non-optional line blocks saving...
    await page.getByRole('checkbox', { name: 'Optional' }).nth(5).uncheck();
    await expect(page.getByTestId('issues')).toContainText('no usable quantity');
    await expect(page.getByRole('button', { name: 'Save recipe' })).toBeDisabled();
    // ...until the user marks it optional again
    await page.getByRole('checkbox', { name: 'Optional' }).nth(5).check();
    await expect(page.getByRole('button', { name: 'Save recipe' })).toBeEnabled();

    // clearing the title also blocks
    await title.fill('');
    await expect(page.getByRole('button', { name: 'Save recipe' })).toBeDisabled();
    await title.fill('Nana soup (corrected)');
    await page.getByRole('textbox', { name: 'Step 3' }).fill('Blend and season well.');

    await page.getByRole('button', { name: 'Save recipe' }).click();
    await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
    // shared recipe store: the imported recipe is a real library recipe
    await expect(page.getByRole('heading', { level: 1, name: 'Nana soup (corrected)' })).toBeVisible();
    await expect(page.getByText('split red lentils')).toBeVisible();
  });

  test('an unreadable image shows a clear error and nothing is extracted', async ({ page }) => {
    await page.goto('/recipes/import');
    await page.getByTestId('photo-input').setInputFiles({ name: 'broken.png', mimeType: 'image/png', buffer: Buffer.from('this is not an image at all') });
    await page.getByRole('button', { name: 'Extract recipe' }).click();
    await expect(page.getByTestId('import-error')).toContainText(/image type is not supported/i);
    await expect(page.getByRole('heading', { name: 'Review recipe' })).toHaveCount(0);
  });

  test('a user-supplied title wins and a second import warns about the duplicate', async ({ page }) => {
    const run = async (title: string) => {
      await page.goto('/recipes/import');
      await page.getByTestId('photo-input').setInputFiles(img('01-tomato-pasta.png'));
      await page.getByLabel('Recipe name (optional)').fill(title);
      await page.getByRole('button', { name: 'Extract recipe' }).click();
      await expect(page.getByRole('heading', { name: 'Review recipe' })).toBeVisible();
    };
    await run('Lentil soup dup test');
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Lentil soup dup test');
    await page.getByRole('button', { name: 'Save recipe' }).click();
    await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);

    await run('Lentil soup dup test');
    await expect(page.getByTestId('duplicate-warning')).toContainText('Lentil soup dup test');
  });
});
