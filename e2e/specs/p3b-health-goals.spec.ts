// P3-B (D430-D439): optional per-person nutrition goals. Each test uses its own sandbox household (mock auth, `fr_household`
// cookie). Consent first (nothing stored or shown without it), NHS references with links and review dates, a gentle estimate
// in the planner week with a plain disclaimer, and withdrawal that deletes.
import { expect, test } from '@playwright/test';

test.describe.configure({ mode: 'serial' });
test.setTimeout(120_000);

const sandbox = (name: string) => `e2e-p3b-${name}-${Date.now().toString(36)}`;
const useHousehold = async (context: import('@playwright/test').BrowserContext, id: string) =>
  context.addCookies([{ name: 'fr_household', value: id, domain: 'localhost', path: '/' }]);

test.describe('health goals', () => {
  test('are off until the person consents; the goals appear with NHS references and links, save, and reload', async ({ page, context }) => {
    await useHousehold(context, sandbox('settings'));
    await page.goto('/settings');
    const section = page.getByTestId('goals-section');
    await expect(section.getByRole('heading', { name: 'Health goals (optional)' })).toBeVisible();
    await expect(section).toContainText('Only you can see');
    await expect(section).toContainText('never sent to our AI provider');
    // nothing to choose and nothing to save before consent
    await expect(page.getByTestId('goals-list')).toHaveCount(0);
    await expect(page.getByTestId('goals-save')).toBeDisabled();

    await page.getByTestId('goals-consent-box').check();
    await page.getByTestId('goals-adult-box').check();
    const list = page.getByTestId('goals-list');
    await expect(list).toBeVisible();
    await expect(list).toContainText('30 g of fibre a day');
    await expect(list).toContainText('page reviewed 2026-03-02');
    await expect(page.getByTestId('goal-source-more_fibre')).toHaveAttribute('href', /^https:\/\/www\.nhs\.uk\//);
    await expect(section).not.toContainText(/lose weight|weight loss|calorie goal/i);
    await expect(page.getByTestId('goal-nudge')).not.toBeChecked(); // planner nudge is off by default

    await page.getByTestId('goal-more_fibre').check();
    await page.getByTestId('goal-more_fruit_veg').check();
    await page.getByTestId('goals-save').click();
    await expect(page.getByText('Goals saved')).toBeVisible();

    await page.reload();
    await expect(page.getByTestId('goals-consent-on')).toBeVisible();
    await expect(page.getByTestId('goal-more_fibre')).toBeChecked();
    await expect(page.getByTestId('goal-more_fruit_veg')).toBeChecked();
    await expect(page.getByTestId('goal-less_salt')).not.toBeChecked();
    await expect(page.getByTestId('goals-disclaimer')).toContainText('not medical or dietary advice');
  });

  test('the planner shows my goals this week only after consent, as a gentle estimate; withdrawing deletes them', async ({ page, context }) => {
    await useHousehold(context, sandbox('planner'));
    const W = '2026-12-07';

    // no consent: nothing in the planner
    await page.goto(`/plan?week=${W}`);
    await page.getByRole('button', { name: /^Add meal to Dinner on Mon/ }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByRole('searchbox').fill('Family Fish Pie');
    await sheet.getByRole('button', { name: 'Select Family Fish Pie' }).click();
    await expect(page.getByTestId('week-variety')).toBeVisible();
    await expect(page.getByTestId('week-goals')).toHaveCount(0);

    // consent + goals in Settings
    await page.goto('/settings');
    await page.getByTestId('goals-consent-box').check();
    await page.getByTestId('goals-adult-box').check();
    await page.getByTestId('goal-more_fruit_veg').check();
    await page.getByTestId('goal-less_salt').check();
    await page.getByTestId('goals-save').click();
    await expect(page.getByText('Goals saved')).toBeVisible();

    // the plan was not saved, so plan the meal again and look at the panel
    await page.goto(`/plan?week=${W}`);
    await page.getByRole('button', { name: /^Add meal to Dinner on Mon/ }).click();
    await page.getByRole('dialog').getByRole('searchbox').fill('Family Fish Pie');
    await page.getByRole('dialog').getByRole('button', { name: 'Select Family Fish Pie' }).click();
    const panel = page.getByTestId('week-goals');
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { name: 'My goals this week' })).toBeVisible();
    await expect(panel).toContainText('Only you can see this');
    await expect(page.getByTestId('goal-progress-more_fruit_veg')).toBeVisible();
    await expect(page.getByTestId('goal-progress-less_salt')).toBeVisible();
    await expect(page.getByTestId('goal-progress-more_fibre')).toHaveCount(0); // only the goals I chose
    await expect(page.getByTestId('goal-headline-less_salt')).toContainText(/about|at least/);
    await expect(page.getByTestId('week-goals-disclaimer')).toContainText('not medical or dietary advice');
    await expect(panel).not.toContainText(/deficien|unhealthy|diagnos/i);

    // withdrawing deletes the goals: the panel is gone and Settings asks for consent again
    await page.goto('/settings');
    await page.getByTestId('goals-withdraw').click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete my goals' }).click();
    await expect(page.getByText('Consent withdrawn and your goals deleted')).toBeVisible();
    await expect(page.getByTestId('goals-list')).toHaveCount(0);
    await page.goto(`/plan?week=${W}`);
    await expect(page.getByTestId('week-goals')).toHaveCount(0);
  });
});
