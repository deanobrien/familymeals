import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { enterHousehold, newHouseholdId } from '../support/helpers.js';

// PR1 minimum pantry stock (D280-D289), mock mode. Each test gets its own sandbox household, which is seeded with the
// demo pantry: tinned tomatoes 2 can, pasta 500 g, ...

test.beforeEach(async ({ context }) => {
  await enterHousehold(context, newHouseholdId('restock'));
});

async function setMinimum(page: Page, name: string, min: string) {
  await page.goto('/pantry');
  await expect(page.getByRole('heading', { level: 1, name: 'Pantry' })).toBeVisible();
  await page.getByRole('button', { name: `Set minimum for ${name}` }).click();
  const form = page.getByRole('form', { name: `Set minimum for ${name}` });
  await form.getByLabel('Minimum to keep').fill(min);
  await form.getByRole('button', { name: 'Save minimum' }).click();
  await expect(page.getByRole('button', { name: `Edit minimum for ${name}` })).toBeVisible();
}

test('minimum 6 with stock 2 suggests 4; banner adds them to the list with restock provenance; buying + pantry add clears it', async ({ page }) => {
  await setMinimum(page, 'tinned tomatoes', '6');
  const low = page.getByRole('list', { name: 'Below minimum' });
  await expect(low).toContainText('tinned tomatoes');
  await expect(low).toContainText('You have 2 cans; minimum 6 cans; 0 cans already on the list -> add 4 cans');

  await page.goto('/shopping');
  const banner = page.getByTestId('restock-banner');
  await expect(banner).toContainText('1 item below your minimum');
  await expect(banner).toContainText('Add 4 cans tinned tomatoes');
  await banner.getByRole('button', { name: 'Add to shopping list' }).click();
  const box = page.getByRole('checkbox', { name: /^tinned tomatoes/ });
  await expect(box).toBeVisible();
  await expect(page.getByText(/Restock: 2 cans left, minimum 6 cans/)).toBeVisible();
  await expect(page.getByText('4 can', { exact: false }).first()).toBeVisible();
  await expect(page.getByTestId('restock-banner')).toHaveCount(0);

  // covered by the list: the pantry panel no longer suggests it
  await page.goto('/pantry');
  await expect(page.getByText('Nothing is below its minimum.')).toBeVisible();

  // tick it off: not in the pantry yet, so the suggestion comes back until the stock is added
  await page.goto('/shopping');
  await expect(page.getByTestId('shopping-root')).toHaveAttribute('data-hydrated', 'true');
  await page.getByRole('checkbox', { name: /^tinned tomatoes/ }).click();
  await expect(page.getByTestId('purchase-row').filter({ hasText: 'tinned tomatoes' })).toBeVisible();
  await expect(page.getByText('All changes saved')).toBeVisible();
  await page.goto('/pantry');
  await expect(page.getByRole('list', { name: 'Below minimum' })).toContainText('tinned tomatoes');
  await page.getByLabel('Ingredient', { exact: true }).fill('tinned tomatoes');
  await page.getByRole('list', { name: 'Ingredient matches' }).getByRole('button', { name: /tinned tomatoes/ }).first().click();
  await page.getByLabel('Quantity', { exact: true }).fill('4');
  await page.getByLabel('Unit', { exact: true }).first().selectOption('can');
  await page.getByRole('button', { name: 'Add to pantry' }).click();
  await expect(page.getByText('Nothing is below its minimum.')).toBeVisible();
});

test('snooze hides a suggestion; the banner can be dismissed', async ({ page }) => {
  await setMinimum(page, 'tinned tomatoes', '6');
  await page.goto('/');
  const banner = page.getByTestId('restock-banner');
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Dismiss restock suggestions' }).click();
  await expect(banner).toHaveCount(0);
  await page.goto('/pantry');
  await page.getByRole('button', { name: 'Snooze tinned tomatoes for 7 days' }).click();
  await expect(page.getByText('Nothing is below its minimum.')).toBeVisible();
  await page.goto('/shopping');
  await expect(page.getByTestId('restock-banner')).toHaveCount(0);
});

test('auto-add mode puts the restock items on the shopping list without asking', async ({ page }) => {
  await setMinimum(page, 'tinned tomatoes', '6');
  // the box reflects the saved (server) setting, so click and wait for it rather than .check()
  await page.getByRole('checkbox', { name: 'Automatically add restock items to the shopping list' }).click();
  await expect(page.getByText('Restock items will be added', { exact: false })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Automatically add restock items to the shopping list' })).toBeChecked();
  await page.goto('/shopping');
  await expect(page.getByRole('checkbox', { name: /^tinned tomatoes/ })).toBeVisible();
  await expect(page.getByTestId('restock-banner')).toHaveCount(0);
});

for (const width of [375, 1280]) {
  test.describe(`a11y @ ${width}px`, () => {
    test.use({ viewport: { width, height: 900 } });

    test('pantry (with minimum + open editor) and shopping banner: axe clean, tap targets >= 44px', async ({ page }) => {
      await setMinimum(page, 'tinned tomatoes', '6');
      await page.getByRole('button', { name: 'Edit minimum for tinned tomatoes' }).click();
      for (const path of ['/pantry', '/shopping', '/']) {
        if (path !== '/pantry') await page.goto(path);
        else await page.getByRole('button', { name: 'Edit minimum for tinned tomatoes' }).count();
        await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        if (path !== '/pantry') await expect(page.getByTestId('restock-banner')).toBeVisible();
        const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        const bad = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
        expect(bad, JSON.stringify(bad.map((v) => ({ id: v.id, nodes: v.nodes.slice(0, 3).map((n) => n.target) })))).toEqual([]);
        if (width === 375) {
          const small = await page.evaluate(() =>
            [...document.querySelectorAll<HTMLElement>('[data-testid="restock-banner"] button, [data-testid="restock-banner"] a, form[aria-label^="Set minimum"] button, form[aria-label^="Set minimum"] input, form[aria-label^="Set minimum"] select, ul[aria-label="Below minimum"] button, ul[aria-label="Minimums"] button')]
              .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.height < 44 || r.width < 44); })
              .map((e) => `${e.tagName.toLowerCase()}:${(e.getAttribute('aria-label') ?? e.textContent ?? '').trim().slice(0, 30)}`));
          expect(small).toEqual([]);
        }
      }
    });
  });
}
