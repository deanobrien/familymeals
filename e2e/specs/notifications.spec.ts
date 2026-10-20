import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { enterHousehold, newHouseholdId } from '../support/helpers.js';

// P1-C notifications (D380-D389), mock mode: in-app centre (bell + unread count), notification settings, test notification,
// household activity feed. Push itself needs VAPID keys and a real browser permission prompt, so it is not exercised here
// (the senders are unit-tested with fakes).

test.beforeEach(async ({ context }) => {
  await enterHousehold(context, newHouseholdId('notify'));
});

test('test notification appears in the centre with an unread count; opening the centre and marking read clears it', async ({ page }) => {
  await page.goto('/settings/notifications');
  await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
  // permission is never asked on page load: only from the button (D389)
  await expect(page.getByTestId('push-status')).not.toHaveText(/Checking/);

  await page.getByTestId('send-test').click();
  await expect(page.getByTestId('test-result')).toContainText('Added to your notification centre');
  await expect(page.getByTestId('notification-unread')).toHaveText('1');
  await expect(page.getByTestId('notification-bell')).toHaveAttribute('aria-label', 'Notifications, 1 unread');

  // rate limited: a second one straight away is refused politely
  await page.getByTestId('send-test').click();
  await expect(page.getByTestId('test-result')).toContainText('Wait half a minute');

  await page.getByTestId('notification-bell').click();
  await expect(page).toHaveURL(/\/notifications$/);
  const item = page.getByTestId('notification-item');
  await expect(item).toHaveCount(1);
  await expect(item).toContainText('Test notification');
  await expect(item).toHaveAttribute('data-read', 'false');
  await expect(page.getByTestId('activity-feed')).toContainText('ticked off potatoes');

  const axe = await new AxeBuilder({ page }).include('main').analyze();
  expect(axe.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);

  await page.getByTestId('mark-all-read').click();
  await expect(item).toHaveAttribute('data-read', 'true');
  await expect(page.getByTestId('notification-unread')).toHaveCount(0);
});

test('per-type toggles and quiet hours persist; push implies in-app', async ({ page }) => {
  await page.goto('/settings/notifications');
  const push = page.getByTestId('type-recipe_added-push');
  const inApp = page.getByTestId('type-recipe_added-inapp');
  await expect(inApp).not.toBeChecked();
  await expect(push).toBeDisabled();
  await inApp.check();
  await push.check();
  await page.getByTestId('type-expiry-push').uncheck();
  await page.getByTestId('quiet-start').fill('22:15');
  await page.getByTestId('save-notification-settings').click();
  await expect(page.getByText('Notification settings saved.')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('type-recipe_added-inapp')).toBeChecked();
  await expect(page.getByTestId('type-recipe_added-push')).toBeChecked();
  await expect(page.getByTestId('type-expiry-push')).not.toBeChecked();
  await expect(page.getByTestId('type-expiry-inapp')).toBeChecked();
  await expect(page.getByTestId('quiet-start')).toHaveValue('22:15');

  // turning in-app off switches push off too
  await page.getByTestId('type-recipe_added-inapp').uncheck();
  await expect(page.getByTestId('type-recipe_added-push')).not.toBeChecked();
});

test('Home shows the household activity feed and Settings links to notification settings', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('activity-feed')).toContainText('Bob Smith');
  await page.goto('/settings');
  await page.getByTestId('settings-notifications-link').getByRole('link', { name: 'Notification settings' }).click();
  await expect(page).toHaveURL(/\/settings\/notifications$/);
});
