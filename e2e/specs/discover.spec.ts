// X1: recipe discovery (offline fixtures via RECIPE_SOURCE=mock, set by playwright.config.ts). No network.
import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
const SANDBOX = `e2e-discover-${Date.now().toString(36)}`;
test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: 'fr_household', value: SANDBOX, domain: 'localhost', path: '/' }]);
});
test.setTimeout(120_000);

test('discover: search, attribution, preview, save through the shared review screen into my library', async ({ page }) => {
  await page.goto('/recipes');
  await page.getByRole('link', { name: 'Discover' }).click();
  await expect(page).toHaveURL(/\/recipes\/discover$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Discover recipes' })).toBeVisible();
  await expect(page.getByTestId('discover-source')).toContainText('Sample recipes');

  await page.getByLabel('Search recipes').fill('salmon');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  const card = page.getByTestId('discover-card');
  await expect(card).toHaveCount(1);
  await expect(card).toContainText('Lemon Grilled Salmon');
  await expect(card.getByTestId('card-attribution')).toContainText('TheMealDB');
  await expect(card.getByRole('link', { name: 'TheMealDB' })).toHaveAttribute('href', 'https://www.themealdb.com/meal/90001');
  await expect(card.getByTestId('diet-badge')).toContainText('Fish');

  // detail preview
  await card.getByRole('button', { name: 'Preview Lemon Grilled Salmon' }).click();
  const preview = page.getByTestId('discover-preview');
  await expect(preview).toContainText('4 fillets Salmon');
  await expect(preview).toContainText('Heat the grill to high.');
  await expect(preview).toContainText('Check it yourself');
  await page.keyboard.press('Escape');

  // save -> the SAME review screen as a photo import, source + original kept, no AI
  await card.getByRole('button', { name: 'Save Lemon Grilled Salmon to my recipes' }).click();
  await expect(page).toHaveURL(/\/recipes\/discover\/review\?u=/);
  await expect(page.getByRole('heading', { name: 'Review recipe' })).toBeVisible();
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Lemon Grilled Salmon');
  await expect(page.getByTestId('review-source')).toContainText('TheMealDB');
  await expect(page.getByTestId('ingredient-row')).toHaveCount(5);
  await expect(page.getByTestId('review-provider')).toHaveCount(0);
  await expect(page.getByTestId('cover-picker')).toHaveCount(0);
  await page.getByLabel('Servings', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Save recipe' }).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { level: 1, name: 'Lemon Grilled Salmon' })).toBeVisible();
  await expect(page.getByText(/TheMealDB/).first()).toBeVisible();

  await page.goto('/recipes');
  await expect(page.getByText('Lemon Grilled Salmon').first()).toBeVisible();
});

test('discover never shows a recipe containing a household exclusion (peanut allergy), and says why', async ({ page }) => {
  await page.goto('/recipes/discover');
  await page.getByLabel('Search recipes').fill('noodles');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByTestId('discover-card')).toHaveCount(0);
  await expect(page.getByTestId('discover-withheld')).toContainText('1 recipe hidden');

  // filters: cuisine + category
  await page.getByLabel('Search recipes').fill('');
  await page.getByLabel('Cuisine').selectOption('Thai');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByTestId('discover-card')).toHaveCount(0);
  await page.getByLabel('Cuisine').selectOption('');
  await page.getByLabel('Category').selectOption('Seafood');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByTestId('discover-card')).toHaveCount(3);
  await page.getByLabel('Main ingredient').fill('prawn');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByTestId('discover-card')).toHaveCount(1);
  await expect(page.getByTestId('discover-card')).toContainText('Quick Prawn Stir Fry');
});

test('planner shortfall: "Find ideas" suggests safe recipes, saving goes to the library and never touches the plan', async ({ page }) => {
  const W = '2026-11-16';
  await page.goto(`/plan?week=${W}`);
  await page.getByRole('button', { name: 'Understand my request' }).click();
  await expect(page.getByTestId('constraint-chips')).toBeVisible();
  // ask for more fish meals than the library holds
  await page.getByLabel('Diet', { exact: true }).selectOption('fish');
  await page.getByLabel('Target type').selectOption('count');
  await page.getByLabel('Target amount').fill('5');
  await page.getByRole('button', { name: 'Set diet target' }).click();
  await page.getByRole('button', { name: 'Propose a plan' }).click();

  const proposal = page.getByTestId('proposal');
  await expect(proposal).toBeVisible();
  const ideas = proposal.getByTestId('gap-ideas');
  await expect(ideas).toBeVisible();
  const fishNeed = ideas.getByTestId('gap-idea-need').filter({ hasText: /fish/i }).first();
  await expect(fishNeed).toBeVisible();

  await fishNeed.getByRole('button', { name: 'Find ideas' }).click();
  const cards = fishNeed.getByTestId('discover-card');
  await expect(cards.first()).toBeVisible();
  await expect(cards.filter({ hasText: 'Lemon Grilled Salmon' })).toHaveCount(1);
  await expect(cards.filter({ hasText: 'Peanut' })).toHaveCount(0);
  for (const t of await cards.getByTestId('diet-badge').allInnerTexts()) expect(t).toMatch(/Fish/);

  // saving a suggestion goes through the review screen to the LIBRARY; the plan is untouched
  await cards.filter({ hasText: 'Cod and Pea Bake' }).getByRole('button', { name: /^Save/ }).click();
  await expect(page).toHaveURL(/\/recipes\/discover\/review\?u=/);
  await page.getByLabel('Servings', { exact: true }).fill('4');
  await page.getByRole('button', { name: 'Save recipe' }).click();
  await expect(page).toHaveURL(/\/recipes\/[0-9a-f-]{36}$/, { timeout: 30_000 });

  await page.goto(`/plan?week=${W}`);
  await expect(page.getByTestId('week-cost')).toContainText('No meals planned yet');
});

test('settings shows the recipe source status without a key', async ({ page }) => {
  await page.goto('/settings');
  const s = page.getByTestId('recipe-source-status');
  await expect(s).toContainText('Recipe discovery');
  await expect(s.getByTestId('recipe-source-key')).toContainText('Offline samples');
  await expect(s).toContainText('never shown');
});
