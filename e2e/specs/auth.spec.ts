import { expect, test } from '@playwright/test';

/**
 * Auth + household (lane L11).
 * Two server configurations are distinguished by E2E_AUTH_CONFIGURED:
 *  - unset (default): dev server WITHOUT Supabase env -> local mock auth mode (banner, pages open).
 *  - set: dev server with a dummy NEXT_PUBLIC_SUPABASE_URL/ANON_KEY pointing at nothing -> middleware gates routes
 *    (the auth server is unreachable, which fails closed to "signed out"). No live Supabase is needed.
 * Flows that need a live Supabase stack are test.fixme.
 */
const configured = !!process.env.E2E_AUTH_CONFIGURED;

test.describe('mock auth mode (no Supabase env)', () => {
  test.skip(configured, 'server has Supabase env');

  test('sign-in page shows the dev mock banner and the form', async ({ page }) => {
    await page.goto('/sign-in');
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.getByTestId('auth-mode-banner')).toContainText('Local mock auth');
    await expect(page.getByLabel('Email')).toBeVisible();
  });

  test('protected pages stay open as the mock user and household management is disabled', async ({ page }) => {
    await page.goto('/household');
    await expect(page.getByRole('heading', { level: 1, name: 'Household' })).toBeVisible();
    await expect(page.getByText('Local mock auth')).toBeVisible();
  });

  test('every page carries the demo banner; auth pages hide the app navigation', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('mock-auth-banner')).toContainText('Alice Smith');
    await expect(page.getByRole('navigation', { name: 'Main', exact: true })).toBeVisible();
    await page.goto('/sign-in');
    await expect(page.getByTestId('mock-auth-banner')).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main', exact: true })).toHaveCount(0);
  });

  test('submitting sign-in in mock mode reports it is unavailable', async ({ page }) => {
    await page.goto('/sign-in');
    await page.getByLabel('Email').fill('someone@example.test');
    await page.getByLabel('Password').fill('correct horse battery');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByTestId('auth-error')).toContainText('unavailable in local mock mode');
  });
});

test.describe('route protection (Supabase env present, no session)', () => {
  test.skip(!configured, 'set E2E_AUTH_CONFIGURED with dummy NEXT_PUBLIC_SUPABASE_* to run');

  test('protected route redirects to sign-in with a next param', async ({ page }) => {
    await page.goto('/recipes');
    await expect(page).toHaveURL(/\/sign-in\?next=%2Frecipes$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.getByTestId('auth-mode-banner')).toHaveCount(0);
  });

  test('public routes do not redirect', async ({ page }) => {
    for (const path of ['/sign-up', '/forgot-password', '/reset-password']) {
      await page.goto(path);
      await expect(page).toHaveURL(new RegExp(`${path}$`));
    }
    await page.goto(`/invite/${'a'.repeat(64)}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Join a household' })).toBeVisible();
  });

  test('invite sign-up link keeps the pending invite as next', async ({ page }) => {
    const token = 'b'.repeat(64);
    await page.goto(`/invite/${token}`);
    await expect(page.getByRole('link', { name: 'create an account' })).toHaveAttribute(
      'href',
      `/sign-up?next=${encodeURIComponent(`/invite/${token}`)}`,
    );
    await page.getByRole('link', { name: 'create an account' }).click();
    await expect(page.locator('input[name="next"]')).toHaveValue(`/invite/${token}`);
  });

  test('malformed invite token shows the invalid state', async ({ page }) => {
    await page.goto('/invite/not-a-token');
    await expect(page.getByTestId('invite-invalid')).toBeVisible();
  });

  test('API routes answer 401 JSON, not a redirect', async ({ request }) => {
    const res = await request.get('/api/anything', { maxRedirects: 0 });
    expect(res.status()).toBe(401);
  });

  test('auth callback ignores an off-site next param', async ({ request }) => {
    const res = await request.get('/auth/callback?code=bad&next=https://evil.test', { maxRedirects: 0 });
    expect([302, 303, 307, 308]).toContain(res.status());
    expect(res.headers()['location'] ?? '').not.toContain('evil.test');
  });
});

test.describe('live Supabase flows', () => {
  test.fixme('sign up -> confirm -> onboarding creates a household', async () => {});
  test.fixme('sign in with wrong password shows a generic error', async () => {});
  test.fixme('owner invites by link; invitee signs up and accepts; sees shared household', async () => {});
  test.fixme('used, expired and revoked invites show the same invalid state', async () => {});
  test.fixme('owner removes a member; removed member is redirected and sees no data', async () => {});
  test.fixme('transfer ownership then former owner can leave', async () => {});
  test.fixme('household pending deletion shows the read-only banner and hides write controls', async () => {});
  test.fixme('household switcher changes the active household and persists across reload', async () => {});
});
