// Recipe library (lane L12) against the dev server's in-memory repository, seeded from e2e/fixtures/recipes.
// Mutating tests use unique titles and clean up, so the seeded browse/search tests stay order independent.
import { expect, test, type Page } from '@playwright/test';
import { openRecipeEditor } from '../support/helpers';

test.describe.configure({ mode: 'serial' });

const recipeLinks = (page: Page) => page.getByRole('list', { name: 'Recipes', exact: true }).getByRole('link');

test.describe('browse and search', () => {
  test('shows seeded recipes in a grid and switches to list view via the URL', async ({ page }) => {
    await page.goto('/recipes');
    await expect(page.getByRole('heading', { level: 1, name: 'Recipes' })).toBeVisible();
    await expect(recipeLinks(page).filter({ hasText: 'Sunday Tomato Pasta' })).toBeVisible();
    await expect(recipeLinks(page).filter({ hasText: 'Family Fish Pie' })).toBeVisible();

    await page.getByRole('button', { name: 'List view' }).click();
    await expect(page).toHaveURL(/view=list/);
    await expect(page.getByRole('button', { name: 'List view' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: 'Grid view' }).click();
    await expect(page).not.toHaveURL(/view=/);
  });

  test('searches titles, ingredients and tags with URL-driven state', async ({ page }) => {
    await page.goto('/recipes');
    const search = page.getByRole('searchbox', { name: 'Search recipes' });

    await search.fill('spaghetti'); // ingredient
    await expect(page).toHaveURL(/q=spaghetti/);
    await expect(recipeLinks(page)).toHaveCount(1);
    await expect(recipeLinks(page).first()).toHaveText('Sunday Tomato Pasta');

    await search.fill('comfort'); // tag
    await expect(recipeLinks(page)).toHaveCount(2);

    await search.fill('zzzz-no-such-recipe');
    await expect(page.getByRole('heading', { name: 'No recipes match' })).toBeVisible();
    await page.getByRole('link', { name: 'Clear all filters' }).click();
    await expect(page).toHaveURL(/\/recipes$/);
    await expect(recipeLinks(page).first()).toBeVisible();
  });

  test('restores filters from a shared URL and applies filter, collection and sort', async ({ page }) => {
    await page.goto('/recipes?cuisine=Indian');
    await expect(recipeLinks(page)).toHaveCount(1);
    await expect(recipeLinks(page).first()).toHaveText('Quick Veg Curry');

    await page.goto('/recipes');
    await page.getByRole('list', { name: 'Collections' }).getByRole('button', { name: 'Favourites', exact: true }).click();
    await expect(page).toHaveURL(/collection=favourites/);
    await expect(recipeLinks(page)).toHaveCount(2);

    await page.getByRole('button', { name: 'All recipes', exact: true }).click();
    await page.getByText('Filters', { exact: false }).first().click();
    await page.getByRole('combobox', { name: 'Diet' }).selectOption('fish');
    await expect(page).toHaveURL(/diet=fish/);
    await expect(recipeLinks(page)).toHaveCount(1);

    await page.goto('/recipes?sort=cost');
    await expect(page.getByRole('combobox', { name: 'Sort by' })).toHaveValue('cost');
    // Cost is computed (engine + generic UK prices): per serving Overnight Berry Porridge ~15p < Sunday Tomato Pasta
    // 68p < Smoky Chickpea Stew 82p. Recipes with unknown cost sort last (not asserted: the shared store may also hold
    // uncosted recipes saved by the import spec).
    await expect(recipeLinks(page).first()).toBeVisible();
    const titles = await recipeLinks(page).allTextContents();
    const at = (s: string) => titles.findIndex((t) => t.includes(s));
    expect(at('Overnight Berry Porridge')).toBeGreaterThan(-1);
    expect(at('Sunday Tomato Pasta')).toBeGreaterThan(at('Overnight Berry Porridge'));
    expect(at('Smoky Chickpea Stew')).toBeGreaterThan(at('Sunday Tomato Pasta'));
  });

  test('favourites can be toggled from a card', async ({ page }) => {
    await page.goto('/recipes?q=porridge');
    const add = page.getByRole('button', { name: /Add Overnight Berry Porridge to favourites/ });
    await add.click();
    await expect(page.getByRole('button', { name: /Remove Overnight Berry Porridge from favourites/ })).toBeVisible();
    await page.getByRole('button', { name: /Remove Overnight Berry Porridge from favourites/ }).click();
    await expect(page.getByRole('button', { name: /Add Overnight Berry Porridge to favourites/ })).toBeVisible();
  });
});

test.describe('recipe detail', () => {
  test('shows ingredients, steps, cost and nutrition, and scales servings', async ({ page }) => {
    await page.goto('/recipes?q=tomato');
    await recipeLinks(page).filter({ hasText: 'Sunday Tomato Pasta' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sunday Tomato Pasta' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Method' })).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: 'Soften the onion in oil for 8 minutes.' })).toBeVisible();

    const qty = page.getByTestId('ingredient-qty');
    await expect(qty.first()).toHaveText('400 g');
    await expect(page.getByTestId('cost-per-serving')).toContainText('£0.68 per serving');
    await expect(page.getByTestId('cost-total')).toContainText('£2.73 for 4 servings');
    await expect(page.getByTestId('cost-total').getByText('estimate')).toBeVisible();
    await expect(page.getByTestId('cost-source')).toContainText('Generic UK estimate');

    await page.getByRole('button', { name: 'Increase servings' }).click();
    await page.getByRole('button', { name: 'Increase servings' }).click(); // 4 -> 6
    await expect(page.getByRole('status').filter({ hasText: 'scaled for 6 servings' })).toBeVisible();
    await expect(qty.first()).toHaveText('600 g');
    await expect(page.getByTestId('cost-total')).toContainText('£4.10 for 6 servings');
    await expect(page.getByTestId('cost-per-serving')).toContainText('£0.68 per serving');
    await page.getByRole('button', { name: "Reset to household (4)" }).click();
    await expect(qty.first()).toHaveText('400 g');

    // Nutrition is computed from CoFID: attribution shown, and values that depend on ingredients without data are Unknown.
    const table = page.getByRole('table', { name: 'Nutrition per serving' });
    await expect(table.getByRole('row', { name: /Energy/ })).toContainText('kcal');
    await expect(page.getByTestId('nutrition-attribution')).toContainText('Estimated from UK CoFID data');
    await expect(page.getByRole('link', { name: 'Add to plan' })).toHaveAttribute('href', /\/plan\?add=/);
  });

  test('fully matched recipe shows known nutrition with estimate labels; per-recipe basis follows servings', async ({ page }) => {
    await page.goto('/recipes?q=lemon');
    await recipeLinks(page).filter({ hasText: 'Lemon Drizzle Loaf' }).click();
    const serving = page.getByRole('table', { name: 'Nutrition per serving' });
    const energy = serving.getByRole('row', { name: /Energy/ });
    await expect(energy).toContainText('kcal');
    await expect(energy).not.toContainText('Unknown');
    await expect(page.getByTestId('nutrition-coverage')).toContainText('100%');
    const before = await energy.textContent();
    await page.getByRole('button', { name: 'Increase servings' }).click();
    // ingredients scale with servings, so per-serving values do not change
    await expect(serving.getByRole('row', { name: /Energy/ })).toHaveText(before ?? '');
    await page.getByRole('tab', { name: 'Per recipe' }).click();
    await expect(page.getByRole('table', { name: /Nutrition per recipe \(5 servings\)/ })).toBeVisible();
  });

  test('unpriced ingredients are listed, cost is a lower bound, unknown nutrition is never zero, approximate amounts do not scale', async ({ page }) => {
    await page.goto('/recipes?q=flapjacks');
    await recipeLinks(page).first().click();
    await expect(page.getByTestId('cost-per-serving')).toContainText('At least');
    await expect(page.getByTestId('uncosted-lines')).toContainText('flaked sea salt');
    await expect(page.getByTestId('cost-coverage')).toContainText('priced');
    await expect(page.getByTestId('nutrition-missing')).toBeAttached();
    const table = page.getByRole('table', { name: 'Nutrition per serving' });
    await expect(table.getByRole('row', { name: /Protein/ })).toContainText('Unknown');
    await expect(table.getByRole('row', { name: /Protein/ })).not.toContainText(/\b0 g/);

    const before = await page.getByTestId('ingredient-qty').allTextContents();
    await page.getByRole('button', { name: 'Increase servings' }).click();
    const after = await page.getByTestId('ingredient-qty').allTextContents();
    const unchanged = before.filter((t, i) => t === after[i]);
    expect(unchanged.length).toBeGreaterThan(0); // pinch / to taste lines stay the same
    expect(unchanged.length).toBeLessThan(before.length); // exact lines did scale
  });

  test('unknown recipe id shows a not-found state', async ({ page }) => {
    await page.goto('/recipes/00000000-0000-4000-8000-00000000dead');
    await expect(page.getByRole('heading', { name: 'Recipe not found' })).toBeVisible();
  });
});

test.describe('create, edit, duplicate and delete', () => {
  const TITLE = `E2E Pumpkin Soup ${Date.now().toString(36)}`;
  const EDITED = `${TITLE} Deluxe`;

  async function fillMinimal(page: Page, title: string) {
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
    await page.getByRole('textbox', { name: 'Ingredient 1 name' }).fill('pumpkin');
    await page.getByRole('spinbutton', { name: 'Ingredient 1 amount' }).fill('1');
    await page.getByRole('combobox', { name: 'Ingredient 1 unit' }).selectOption('kg');
    await page.getByRole('textbox', { name: 'Ingredient 1 preparation' }).fill('cubed');
    await page.getByRole('textbox', { name: 'Step 1', exact: true }).fill('Roast the pumpkin.');
  }

  test('validates required fields', async ({ page }) => {
    await page.goto('/recipes/new');
    await page.getByRole('button', { name: 'Create recipe' }).click();
    await expect(page.getByText('Title is required')).toBeVisible();
    await expect(page.getByText('Enter a quantity')).toBeVisible();
    await expect(page).toHaveURL(/\/recipes\/new$/);
  });

  test('creates a recipe that appears in the library, then edits it preserving original text', async ({ page }) => {
    await page.goto('/recipes/new');
    await fillMinimal(page, TITLE);
    await page.getByRole('textbox', { name: 'Original recipe text' }).fill('1kg pumpkin, cubed. Roast it.');
    await page.getByRole('button', { name: 'Add ingredient' }).click();
    await page.getByRole('textbox', { name: 'Ingredient 2 name' }).fill('salt');
    await page.getByRole('combobox', { name: 'Ingredient 2 quantity type' }).selectOption('to_taste');
    await page.getByRole('button', { name: 'Add step' }).click();
    await page.getByRole('textbox', { name: 'Step 2', exact: true }).fill('Blend and season.');
    await page.getByRole('button', { name: 'Move step 2 up' }).click(); // reorder
    await page.getByRole('button', { name: 'Create recipe' }).click();

    await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: TITLE })).toBeVisible();
    await expect(page.getByTestId('ingredient-qty').first()).toHaveText('1 kg');
    // pumpkin is priced in refdata (R2), so the cost is a real (estimated) figure, never 0
    await expect(page.getByTestId('cost-per-serving')).toContainText('per serving');
    const steps = page.getByRole('list').filter({ hasText: 'Roast the pumpkin.' }).getByRole('listitem');
    await expect(steps.first()).toHaveText('Blend and season.');

    // Edit
    await openRecipeEditor(page);
    const original = page.getByRole('textbox', { name: 'Original recipe text' });
    await expect(original).toHaveValue('1kg pumpkin, cubed. Roast it.');
    await expect(original).toHaveJSProperty('readOnly', true);
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill(EDITED);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { level: 1, name: EDITED })).toBeVisible();

    await page.goto(`/recipes?q=${encodeURIComponent(TITLE)}`);
    await expect(recipeLinks(page)).toHaveCount(1);
  });

  test('warns about duplicates and allows saving anyway', async ({ page }) => {
    await page.goto('/recipes/new');
    await fillMinimal(page, EDITED);
    await page.getByRole('button', { name: 'Create recipe' }).click();
    const warning = page.getByRole('alert').filter({ hasText: 'looks like a recipe you already have' });
    await expect(warning).toBeVisible();
    await expect(warning.getByRole('link', { name: EDITED })).toBeVisible();
    await expect(page).toHaveURL(/\/recipes\/new$/);
    await warning.getByRole('button', { name: 'Save anyway' }).click();
    await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
    await expect(page.getByRole('heading', { level: 1, name: EDITED })).toBeVisible();
  });

  test('duplicates a recipe and deletes the copies after confirmation', async ({ page }) => {
    await page.goto(`/recipes?q=${encodeURIComponent(TITLE)}`);
    await expect(recipeLinks(page)).toHaveCount(2);
    await recipeLinks(page).first().click();
    await page.getByRole('button', { name: 'Duplicate' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /\(copy\)$/ })).toBeVisible();
    await expect(page.getByText('Recipe duplicated')).toBeVisible();

    // Cancel keeps the recipe
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('cannot be undone');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('heading', { level: 1, name: /\(copy\)$/ })).toBeVisible();

    // Confirm deletes
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete recipe' }).click();
    await expect(page).toHaveURL(/\/recipes\?deleted=1/);
    await expect(page.getByText('Recipe deleted.')).toBeVisible();

    // Clean up the remaining E2E recipes
    for (let i = 0; i < 3; i++) {
      await page.goto(`/recipes?q=${encodeURIComponent(TITLE)}`);
      if ((await recipeLinks(page).count()) === 0) break;
      await recipeLinks(page).first().click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Delete recipe' }).click();
      await expect(page).toHaveURL(/deleted=1/);
    }
    await page.goto(`/recipes?q=${encodeURIComponent(TITLE)}`);
    await expect(page.getByRole('heading', { name: 'No recipes match' })).toBeVisible();
  });
});
