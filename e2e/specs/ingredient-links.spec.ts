// IL1: ingredient links for recipes created in the form (D220-D229). In-memory mode, mock auth.
// Every test creates its own uniquely titled recipe, so the seeded library tests stay order independent.
import { expect, test, type Page } from '@playwright/test';
import { enterHousehold, newHouseholdId, openRecipeEditor } from '../support/helpers';

test.describe.configure({ mode: 'serial' });

// Own sandbox household (D160): recipes created here must not land in household A's library, whose browse/search specs
// assume the seeded recipes fit on the first page of 12 (extra household-A recipes pushed "Sunday Tomato Pasta" off it, FL1).
const household = newHouseholdId('links');
test.beforeEach(async ({ context }) => {
  await enterHousehold(context, household);
});

const uid = Date.now().toString(36);

async function startRecipe(page: Page, title: string) {
  await page.goto('/recipes/new');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Step 1', exact: true }).fill('Mix it.');
}
async function fillIngredient(page: Page, n: number, name: string, amount: string, unit: string) {
  await page.getByRole('textbox', { name: `Ingredient ${n} name` }).fill(name);
  await page.getByRole('textbox', { name: `Ingredient ${n} name` }).blur();
  await page.getByRole('spinbutton', { name: `Ingredient ${n} amount` }).fill(amount);
  await page.getByRole('combobox', { name: `Ingredient ${n} unit` }).selectOption(unit);
}
const link = (page: Page, n: number) => page.getByTestId(`ing-link-${n}`);

test('a hand-typed ingredient is matched on save, so cost and nutrition are computed from it', async ({ page }) => {
  await startRecipe(page, `E2E Links Flour ${uid}`);
  await fillIngredient(page, 1, 'plain flour', '200', 'g');
  await expect(link(page, 1)).toContainText('Matched to: plain flour'); // live preview
  await page.getByRole('button', { name: 'Create recipe' }).click();

  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('cost-per-serving')).toContainText('per serving');
  await expect(page.getByTestId('cost-per-serving')).not.toContainText('At least');
  await expect(page.getByTestId('nutrition-coverage')).toContainText('Based on 100% of ingredients');
  await expect(page.getByTestId('unlinked-notice')).toHaveCount(0);

  // the saved link is shown again when editing
  await openRecipeEditor(page);
  await expect(link(page, 1)).toContainText('Matched to: plain flour');
});

test('an unclear name offers candidates and a chosen one is saved and kept on edit', async ({ page }) => {
  await startRecipe(page, `E2E Links Coriander ${uid}`);
  await fillIngredient(page, 1, 'coriander', '1', 'bunch');
  await expect(link(page, 1)).toContainText('Pick a match');
  await link(page, 1).click();
  await page.getByTestId('ing-link-option').filter({ hasText: 'fresh coriander' }).click();
  await expect(link(page, 1)).toContainText('Matched to: fresh coriander');
  await page.getByRole('button', { name: 'Create recipe' }).click();

  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('unlinked-notice')).toHaveCount(0);
  await openRecipeEditor(page);
  await expect(link(page, 1)).toContainText('Matched to: fresh coriander');

  // saving again without touching the line preserves the manual choice
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('unlinked-notice')).toHaveCount(0);
});

test('search finds a catalogue ingredient for an unknown name', async ({ page }) => {
  await startRecipe(page, `E2E Links Search ${uid}`);
  await fillIngredient(page, 1, 'my secret spice', '1', 'tsp');
  await expect(link(page, 1)).toContainText('Not matched');
  await link(page, 1).click();
  await page.getByTestId('ing-link-search').fill('cumin');
  await page.getByTestId('ing-link-result').first().click();
  await expect(link(page, 1)).toContainText('Matched to:');
  await page.getByRole('button', { name: 'Create recipe' }).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId('unlinked-notice')).toHaveCount(0);
});

test('"not in list" is kept, and Re-match ingredients links the line afterwards', async ({ page }) => {
  await startRecipe(page, `E2E Links None ${uid}`);
  await fillIngredient(page, 1, 'plain flour', '100', 'g');
  await link(page, 1).click();
  await page.getByTestId('ing-link-none').click();
  await expect(link(page, 1)).toContainText('Not in the ingredient list');
  await page.getByRole('button', { name: 'Create recipe' }).click();

  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
  const notice = page.getByTestId('unlinked-notice');
  await expect(notice).toContainText('1 of 1 ingredients is not linked');

  await page.getByTestId('rematch-recipe').click();
  await expect(notice).toHaveCount(0);
  await expect(page.getByTestId('nutrition-coverage')).toContainText('Based on 100% of ingredients');
});

test('Re-match all recipes runs from the library', async ({ page }) => {
  await page.goto('/recipes');
  await page.getByTestId('rematch-all').click();
  await expect(page.getByText(/Linked \d+ ingredients?/)).toBeVisible();
});
