// Live Supabase: recipes, import, planner and pantry through the real UI with DATA_BACKEND=supabase (D143).
// Each test signs up its own household, so tests are independent and parallel-safe.
import { expect, test, type Page } from '@playwright/test';
import { join } from 'node:path';
import { FIXTURES_DIR } from '../support/helpers.js';
import { MealPlanPage } from '../support/pages.js';
import { householdIdOf, userClient, userWithHousehold } from './support/live.js';

test.describe.configure({ mode: 'parallel' });

const recipeLinks = (page: Page) => page.getByRole('list', { name: 'Recipes', exact: true }).getByRole('link');
const img = (f: string) => join(FIXTURES_DIR, 'recipes', f);

async function createRecipe(page: Page, title: string, ingredient = 'pumpkin') {
  await page.goto('/recipes/new');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill(title);
  await page.getByRole('textbox', { name: 'Ingredient 1 name' }).fill(ingredient);
  await page.getByRole('spinbutton', { name: 'Ingredient 1 amount' }).fill('1');
  await page.getByRole('combobox', { name: 'Ingredient 1 unit' }).selectOption('kg');
  await page.getByRole('textbox', { name: 'Ingredient 1 preparation' }).fill('cubed');
  await page.getByRole('textbox', { name: 'Step 1', exact: true }).fill('Roast it.');
  await page.getByRole('button', { name: 'Create recipe' }).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
  return page.url().split('/').pop()!;
}

test('recipes: create, read back from Postgres, search, edit, duplicate warning, delete', async ({ browser }) => {
  const { context, page, user } = await userWithHousehold(browser, 'recipes', 'Recipe Home');
  try {
    const id = await createRecipe(page, 'Live Pumpkin Soup');
    await expect(page.getByTestId('ingredient-qty').first()).toHaveText('1 kg');
    await expect(page.getByTestId('cost-per-serving')).toContainText('per serving');

    // Really in Postgres, visible to the user through RLS.
    const c = await userClient(user);
    const { data: row } = await c.from('recipes').select('title, status').eq('id', id).single();
    expect(row?.title).toBe('Live Pumpkin Soup');
    const { data: lines } = await c.from('recipe_ingredients').select('display_name, unit, ingredient_id').eq('recipe_id', id);
    expect(lines).toEqual([expect.objectContaining({ display_name: 'pumpkin', unit: 'kg' })]);

    // Search: title and ingredient (FTS / trigram in list_recipes).
    await page.goto('/recipes');
    const search = page.getByRole('searchbox', { name: 'Search recipes' });
    await search.fill('pumpkin');
    await expect(recipeLinks(page)).toHaveCount(1);
    await search.fill('zzzz-nothing');
    await expect(page.getByRole('heading', { name: 'No recipes match' })).toBeVisible();

    // Edit.
    await page.goto(`/recipes/${id}`);
    await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Live Pumpkin Soup Deluxe');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Live Pumpkin Soup Deluxe' })).toBeVisible();
    const { data: versions } = await c.from('recipe_versions').select('id').eq('recipe_id', id);
    expect((versions ?? []).length).toBeGreaterThanOrEqual(2);

    // Duplicate detection (find_recipe_duplicates).
    await page.goto('/recipes/new');
    await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Live Pumpkin Soup Deluxe');
    await page.getByRole('textbox', { name: 'Ingredient 1 name' }).fill('pumpkin');
    await page.getByRole('spinbutton', { name: 'Ingredient 1 amount' }).fill('1');
    await page.getByRole('textbox', { name: 'Step 1', exact: true }).fill('Roast it.');
    await page.getByRole('button', { name: 'Create recipe' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'looks like a recipe you already have' })).toBeVisible();

    // Delete (archives: planned meals may reference it).
    await page.goto(`/recipes/${id}`);
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete recipe' }).click();
    await expect(page).toHaveURL(/\/recipes\?deleted=1/);
    await expect(recipeLinks(page)).toHaveCount(0);
    const { data: archived } = await c.from('recipes').select('status').eq('id', id).single();
    expect(archived?.status).toBe('archived');
  } finally {
    await context.close();
  }
});

test('photo import (mock AI) saves into the household in Postgres', async ({ browser }) => {
  const { context, page, user } = await userWithHousehold(browser, 'import', 'Import Home');
  try {
    await page.goto('/recipes/import');
    await page.getByTestId('photo-input').setInputFiles([img('03-beef-stew-two-page-p1.png'), img('03-beef-stew-two-page-p2.png')]);
    await page.getByRole('button', { name: 'Extract recipe' }).click();
    await expect(page.getByRole('heading', { name: 'Review recipe' })).toBeVisible();
    await page.getByLabel('Title', { exact: true }).fill('Live Imported Soup');
    await page.getByRole('button', { name: 'Save recipe' }).click();
    await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    await expect(page.getByRole('heading', { level: 1, name: 'Live Imported Soup' })).toBeVisible();
    const id = page.url().split('/').pop()!;
    const c = await userClient(user);
    const { data } = await c.from('recipes').select('household_id').eq('id', id).single();
    expect(data?.household_id).toBe(await householdIdOf(user));
    // Matched import lines keep their catalogue id in Postgres (reference ingredients seeded from refdata, D145).
    const { data: lines } = await c.from('recipe_ingredients').select('ingredient_id').eq('recipe_id', id).not('ingredient_id', 'is', null);
    expect((lines ?? []).length).toBeGreaterThan(0);
  } finally {
    await context.close();
  }
});

test('planner: plan a week, save, reopen, approve (meal_plans in Postgres)', async ({ browser }) => {
  const { context, page, user } = await userWithHousehold(browser, 'planner', 'Plan Home');
  try {
    await createRecipe(page, 'Live Plan Curry', 'chickpeas');
    const W = '2026-11-02';
    const plan = new MealPlanPage(page);
    await page.goto(`/plan?week=${W}`);
    await plan.addToSlot(W, 'dinner').click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('searchbox').fill('Live Plan Curry');
    await sheet.getByRole('button', { name: 'Select Live Plan Curry' }).click();
    await expect(plan.slot(W, 'dinner')).toContainText('Live Plan Curry');
    await page.getByRole('button', { name: 'Save plan' }).click();
    await expect(page.getByTestId('plan-message')).toContainText('Plan saved');

    await page.goto(`/plan?week=${W}`);
    await expect(plan.slot(W, 'dinner')).toContainText('Live Plan Curry');
    await plan.approve().click();
    await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();

    const c = await userClient(user);
    const { data: plans } = await c.from('meal_plans').select('id, status, start_date');
    expect(plans).toEqual([expect.objectContaining({ status: 'approved', start_date: W })]);
    const { data: meals } = await c.from('planned_meals').select('meal_date, meal_type').eq('meal_plan_id', plans![0]!.id);
    expect(meals).toEqual([expect.objectContaining({ meal_date: W, meal_type: 'dinner' })]);
  } finally {
    await context.close();
  }
});

test('pantry: add, correct, remove; settings persist (pantry_items / pantry_settings in Postgres)', async ({ browser }) => {
  const { context, page, user } = await userWithHousehold(browser, 'pantry', 'Pantry Home');
  try {
    await page.goto('/pantry');
    await expect(page.getByRole('heading', { level: 1, name: 'Pantry' })).toBeVisible();
    await page.getByLabel('Ingredient', { exact: true }).fill('basmati');
    await page.getByRole('list', { name: 'Ingredient matches' }).getByRole('button', { name: /basmati rice/ }).click();
    await page.getByLabel('Quantity', { exact: true }).fill('750');
    await page.getByRole('button', { name: 'Add to pantry' }).click();
    const grains = page.getByRole('list', { name: 'Pasta, rice and grains' });
    await expect(grains).toContainText('750 g');

    const c = await userClient(user);
    const { data: items } = await c.from('pantry_items').select('id, quantity_value, unit, ingredient_id');
    expect(items).toEqual([expect.objectContaining({ unit: 'g', ingredient_id: expect.any(String) })]);
    expect(Number(items![0]!.quantity_value)).toBe(750);

    await page.reload();
    await page.getByRole('button', { name: 'Correct basmati rice' }).first().click();
    const form = page.getByRole('form', { name: 'Correct basmati rice' });
    await form.getByLabel('Actual quantity').fill('2');
    await form.getByLabel('Unit').selectOption('kg');
    await form.getByRole('button', { name: 'Save correction' }).click();
    await expect(grains).toContainText('2 kg');

    await page.getByRole('button', { name: 'Remove basmati rice' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
    await expect(page.getByRole('list', { name: 'Pasta, rice and grains' })).toHaveCount(0);
    await expect.poll(async () => ((await c.from('pantry_items').select('id')).data ?? []).length).toBe(0);

    // A new real household sees no demo "recent purchases" (D146).
    await expect(page.getByRole('list', { name: 'Pending purchases' })).toHaveCount(0);

    // Settings: pantry_settings.purchase_mode is the source of truth; households.pantry_deduct_on_purchase mirrors it.
    const settings = page.getByRole('form', { name: 'Pantry settings' });
    await settings.getByLabel('After I buy something').selectOption('auto');
    await settings.getByLabel(/Ask me to confirm stock after/).fill('30');
    await settings.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Settings saved')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('form', { name: 'Pantry settings' }).getByLabel('After I buy something')).toHaveValue('auto');
    const hid = await householdIdOf(user);
    const { data: hh } = await c.from('households').select('pantry_deduct_on_purchase').eq('id', hid).single();
    expect(hh?.pantry_deduct_on_purchase).toBe(true);
  } finally {
    await context.close();
  }
});
