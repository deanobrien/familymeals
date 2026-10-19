import { expect, test } from '@playwright/test';
import { MealPlanPage } from '../support/pages.js';

// Plans live in the dev server's in-memory store, so each test uses its own week. The spec runs in a sandbox
// household (mock auth, `fr_household=e2e-*`): generating a list from an approved plan writes that household's
// shopping list, and household A's list must stay empty for the smoke spec.
test.describe.configure({ mode: 'serial' });
const SANDBOX = `e2e-plan-${Date.now().toString(36)}`;
test.beforeEach(async ({ context }) => {
  await context.addCookies([{ name: 'fr_household', value: SANDBOX, domain: 'localhost', path: '/' }]);
});
test.setTimeout(90_000);

async function pick(page: import('@playwright/test').Page, title: string) {
  const sheet = page.getByRole('dialog');
  await sheet.getByRole('searchbox').fill(title);
  await sheet.getByRole('button', { name: `Select ${title}` }).click();
}

test('manual planning: add, servings, move, eating out, cost honesty, save, reopen, approve, shopping', async ({ page }) => {
  const W = '2026-11-02';
  const [MON, TUE, WED] = ['2026-11-02', '2026-11-03', '2026-11-04'];
  const plan = new MealPlanPage(page);
  await page.goto(`/plan?week=${W}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Meal planner' })).toBeVisible();
  await expect(page.getByTestId('week-cost')).toContainText('No meals planned yet');

  // add via search sheet
  await plan.addToSlot(MON, 'dinner').click();
  await pick(page, 'Family Fish Pie');
  await expect(plan.slot(MON, 'dinner')).toContainText('Family Fish Pie');
  await expect(plan.slot(MON, 'dinner')).toContainText('estimate');

  // an uncosted recipe keeps the week honest
  await plan.addToSlot(TUE, 'dinner').click();
  await pick(page, 'Gran’s Fiddly Flapjacks & Soup'); // the library seed's uncosted recipe
  await expect(plan.slot(TUE, 'dinner')).toContainText('Uncosted');
  await expect(page.getByTestId('week-cost')).toContainText('uncosted');
  await expect(page.getByTestId('week-cost')).toContainText('estimate');

  // change servings (default 4 -> 5)
  await plan.slot(MON, 'dinner').getByRole('button', { name: /^Edit/ }).click();
  await page.getByRole('button', { name: 'Increase servings' }).click();
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(plan.slot(MON, 'dinner')).toContainText('5 servings');

  // move Monday's meal to Wednesday via the menu (mobile-friendly path)
  await plan.slot(MON, 'dinner').getByRole('button', { name: /^Edit/ }).click();
  await page.getByLabel('Move or duplicate to').selectOption({ label: 'Wed 4 Nov, Dinner' });
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await expect(plan.slot(WED, 'dinner')).toContainText('Family Fish Pie');
  await expect(plan.slot(MON, 'dinner')).not.toContainText('Family Fish Pie');

  // mark Tuesday as eating out
  await plan.slot(TUE, 'dinner').getByRole('button', { name: /^Edit/ }).click();
  await page.getByRole('button', { name: 'Mark eating out' }).click();
  await expect(plan.slot(TUE, 'dinner')).toContainText('Eating out');

  // drag Wednesday onto Monday (desktop)
  await plan.slot(WED, 'dinner').dragTo(plan.slot(MON, 'dinner'));
  await expect(plan.slot(MON, 'dinner')).toContainText('Family Fish Pie');

  // not saved yet, then save and reopen
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByTestId('plan-message')).toContainText('Plan saved');
  await page.goto(`/plan?week=${W}`);
  await expect(plan.slot(MON, 'dinner')).toContainText('Family Fish Pie');
  await expect(plan.slot(TUE, 'dinner')).toContainText('Eating out');

  // approve; shopping is only generated on the explicit button
  await expect(page.getByRole('button', { name: /generate shopping list/i })).toHaveCount(0);
  await plan.approve().click();
  await expect(page.getByTestId('plan-message')).toContainText('No shopping list has been created yet');
  await expect(page.getByText('Approved', { exact: true }).first()).toBeVisible();
  await plan.generateList().click();
  await expect(page.getByRole('link', { name: 'Open shopping list' })).toHaveAttribute('href', /\/shopping\?plan=/);
});

test('reuse previous week copies a saved plan onto the next week as a draft', async ({ page }) => {
  const plan = new MealPlanPage(page);
  await page.goto('/plan?week=2026-11-16');
  await plan.addToSlot('2026-11-16', 'dinner').click();
  await pick(page, 'Sunday Tomato Pasta');
  await page.getByRole('button', { name: 'Save plan' }).click();
  await expect(page.getByTestId('plan-message')).toContainText('Plan saved');

  await page.goto('/plan?week=2026-11-23');
  await page.getByRole('button', { name: 'Reuse previous week' }).click();
  await expect(plan.slot('2026-11-23', 'dinner')).toContainText('Sunday Tomato Pasta');
  await expect(page.getByText('Unsaved changes')).toBeVisible();
});

test('prompt flow: propose, review, accept into the unsaved grid, approve, then explicit shopping', async ({ page }) => {
  const W = '2026-11-09';
  const plan = new MealPlanPage(page);
  await page.goto(`/plan?week=${W}`);

  await expect(page.getByLabel('Describe the week you want')).toHaveValue(/Plan seven dinners/);
  await page.getByRole('button', { name: 'Propose a plan' }).click();

  const proposal = page.getByTestId('proposal');
  await expect(proposal).toBeVisible();
  await expect(proposal.getByTestId('proposal-slot')).toHaveCount(7);
  await expect(proposal.getByTestId('reimposed')).toContainText('peanuts');
  await expect(proposal.getByText('Constraint check')).toBeVisible();
  await expect(proposal).toContainText(/estimate|Uncosted/);

  // proposing saves nothing and fills nothing
  await expect(plan.slot(W, 'dinner')).not.toContainText(/pie|stew|curry|pasta|flapjack/i);

  await proposal.getByRole('button', { name: 'Accept into grid' }).click();
  await expect(plan.slot(W, 'dinner').getByRole('button', { name: /^Edit/ })).toBeVisible();
  await expect(page.getByText('Unsaved changes')).toBeVisible();
  await expect(page.getByRole('button', { name: /generate shopping list/i })).toHaveCount(0);

  await plan.approve().click();
  await expect(page.getByTestId('plan-message')).toContainText('No shopping list has been created yet');
  await expect(page.getByRole('link', { name: 'Open shopping list' })).toHaveCount(0);

  await plan.generateList().click();
  await expect(page.getByRole('link', { name: 'Open shopping list' })).toBeVisible();
});

test('diet proportions explain rounding for seven days', async ({ page }) => {
  await page.goto('/plan?week=2026-11-30');
  await page.getByText('Diet proportions').click();
  await page.getByLabel('Vegetarian %').fill('50');
  await page.getByLabel('Meat %').fill('50');
  await expect(page.getByTestId('proportion-explanation')).toContainText('cannot be cooked');
  await page.getByRole('button', { name: 'Add to prompt' }).click();
  await expect(page.getByLabel('Describe the week you want')).toHaveValue(/50% meat, 50% vegetarian/);
});
