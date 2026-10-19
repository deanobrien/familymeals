// Live Supabase: auth + household lifecycle through the real UI (was test.fixme in specs/auth.spec.ts).
import { expect, test, type Page } from '@playwright/test';
import {
  adminClient,
  createConfirmedUser,
  createHouseholdUi,
  createInviteLink,
  householdIdOf,
  latestEmail,
  liveUser,
  signIn,
  signUpAndConfirm,
  userClient,
  userWithHousehold,
  verifyLink,
} from './support/live.js';

test.describe.configure({ mode: 'parallel' });

const INVALID = 'This invitation is invalid, expired or has already been used.';
const members = (page: Page) => page.getByRole('region', { name: 'Members' }).getByRole('listitem');

/** A signed-in user opens a link that must not work: accepting shows the generic invalid message. */
async function expectInviteRejected(page: Page, link: string): Promise<void> {
  await page.goto(link);
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page.getByTestId('invite-error')).toHaveText(INVALID);
}

async function acceptInvite(page: Page, link: string): Promise<void> {
  await page.goto(link);
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page).toHaveURL(/\/household$/);
}

test('sign up -> confirm by email -> onboarding creates a household', async ({ page }) => {
  const user = liveUser('signup');
  await signUpAndConfirm(page, user);
  await expect(page).toHaveURL(/\/household\/new$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Set up your household' })).toBeVisible();
  await createHouseholdUi(page, 'Live Signup Home', 'Sam');
  await expect(members(page)).toHaveCount(1);
  await expect(members(page).first()).toContainText('Sam');
  await expect(members(page).first()).toContainText('owner');
  await page.goto('/');
  await expect(page).not.toHaveURL(/sign-in/);
});

test('unconfirmed account cannot sign in; wrong password shows a generic error', async ({ page }) => {
  const user = liveUser('unconfirmed');
  await page.goto('/sign-up');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/sign-in\?error=/);
  await expect(page.getByTestId('auth-error')).toBeVisible();

  const confirmed = await createConfirmedUser('wrongpw');
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(confirmed.email);
  await page.getByLabel('Password').fill('not-the-password-123');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByTestId('auth-error')).toBeVisible();
  expect(await page.getByTestId('auth-error').textContent()).not.toContain(confirmed.email);
});

test('owner invites by link; invitee signs up via the link and accepts; both see the shared household', async ({ browser }) => {
  const owner = await userWithHousehold(browser, 'owner', 'Shared Home', 'Alex');
  const link = await createInviteLink(owner.page);
  const ctx = await browser.newContext();
  const invitee = await ctx.newPage();
  try {
    const user = liveUser('invitee');
    await invitee.goto(link);
    await expect(invitee.getByRole('heading', { level: 1, name: 'Join a household' })).toBeVisible();
    await invitee.getByRole('link', { name: 'create an account' }).click();
    await invitee.getByLabel('Email').fill(user.email);
    await invitee.getByLabel('Password').fill(user.password);
    await invitee.getByRole('button', { name: 'Create account' }).click();
    await expect(invitee.getByRole('heading', { name: 'Check your email' })).toBeVisible();
    // The emailed confirmation link brings the invitee back to the pending invite.
    await invitee.goto(verifyLink(await latestEmail(user.email)));
    await expect(invitee).toHaveURL(/\/invite\/[0-9a-f]{64}$/);
    await invitee.getByRole('button', { name: 'Accept invitation' }).click();
    await expect(invitee).toHaveURL(/\/household$/);
    await expect(invitee.getByRole('heading', { level: 2, name: 'Shared Home' })).toBeVisible();
    await expect(members(invitee).filter({ hasText: 'Alex' })).toHaveCount(1);

    await owner.page.goto('/household');
    await expect(members(owner.page)).toHaveCount(2);

    // Single use: a third person gets the generic invalid message.
    const third = await createConfirmedUser('third');
    const c3 = await browser.newContext();
    const p3 = await c3.newPage();
    await signIn(p3, third);
    await expectInviteRejected(p3, link);
    await c3.close();
  } finally {
    await ctx.close();
    await owner.context.close();
  }
});

test('email-locked invite works only for that address; revoked and wrong-account links show the same invalid state', async ({ browser }) => {
  const owner = await userWithHousehold(browser, 'revoker', 'Revoke Home');
  const outsider = await createConfirmedUser('outsider');
  const intended = await createConfirmedUser('intended');
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  const ctx2 = await browser.newContext();
  const p2 = await ctx2.newPage();
  try {
    const locked = await createInviteLink(owner.page, { email: intended.email.toUpperCase() });
    const revoked = await createInviteLink(owner.page);
    await owner.page.goto('/household');
    await owner.page
      .getByRole('region', { name: 'Pending invitations' })
      .getByRole('listitem')
      .filter({ hasText: 'Anyone with the link' })
      .getByRole('button', { name: 'Revoke' })
      .click();
    await expect(owner.page.getByText('Invitation revoked.')).toBeVisible();

    await signIn(p, outsider);
    // A wrong account holding an email-locked link gets the same message as a revoked link (D144).
    for (const link of [locked, revoked]) await expectInviteRejected(p, link);
    const { data } = await (await userClient(outsider)).from('household_members').select('id');
    expect(data ?? []).toHaveLength(0);

    // The intended address can still use it (the failed attempts did not burn it).
    await signIn(p2, intended);
    await acceptInvite(p2, locked);
    await expect(p2.getByRole('heading', { level: 2, name: 'Revoke Home' })).toBeVisible();
  } finally {
    await ctx.close();
    await ctx2.close();
    await owner.context.close();
  }
});

test('owner removes a member; removed member loses access immediately', async ({ browser }) => {
  const owner = await userWithHousehold(browser, 'remover', 'Remove Home', 'Owner');
  const member = await createConfirmedUser('removed');
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    const link = await createInviteLink(owner.page);
    await signIn(p, member);
    await acceptInvite(p, link);
    await expect(p.getByRole('heading', { level: 2, name: 'Remove Home' })).toBeVisible();
    const hid = await householdIdOf(member);

    await owner.page.goto('/household');
    await members(owner.page).filter({ hasNotText: '(you)' }).getByRole('button', { name: 'Remove' }).click();
    await expect(owner.page.getByText('Member removed.')).toBeVisible();

    await p.goto('/household');
    await expect(p).toHaveURL(/\/household\/new$/);
    const c = await userClient(member);
    const { data: rows } = await c.from('households').select('id').eq('id', hid);
    expect(rows ?? []).toHaveLength(0);
  } finally {
    await ctx.close();
    await owner.context.close();
  }
});

test('transfer ownership, then the former owner can leave', async ({ browser }) => {
  const owner = await userWithHousehold(browser, 'transfer', 'Transfer Home', 'First');
  const member = await createConfirmedUser('heir');
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  try {
    const link = await createInviteLink(owner.page);
    await signIn(p, member);
    await acceptInvite(p, link);

    await owner.page.goto('/household');
    await owner.page.getByRole('button', { name: 'Make owner and step down' }).click();
    await expect(owner.page.getByText('Ownership transferred. You are now a member.')).toBeVisible();
    await expect(owner.page.getByRole('button', { name: 'Create invite link' })).toHaveCount(0);

    await p.goto('/household');
    await expect(p.getByRole('button', { name: 'Create invite link' })).toBeVisible();

    await owner.page.getByRole('button', { name: 'Leave Transfer Home' }).click();
    await expect(owner.page).toHaveURL(/\/household\/new/);
    await p.reload();
    await expect(members(p)).toHaveCount(1);
  } finally {
    await ctx.close();
    await owner.context.close();
  }
});

test('household pending deletion is read-only: banner, no write controls, DB refuses writes, owner can cancel', async ({ browser }) => {
  const owner = await userWithHousehold(browser, 'deleter', 'Deleting Home');
  try {
    const c = await userClient(owner.user);
    const hid = await householdIdOf(owner.user);
    const { error: okErr } = await c.from('recipes').insert({ household_id: hid, title: 'Before deletion' });
    expect(okErr).toBeNull();
    const { error: reqErr } = await c.rpc('request_household_deletion', { p_household_id: hid });
    expect(reqErr).toBeNull();

    await owner.page.goto('/household');
    await expect(owner.page.getByTestId('read-only-banner')).toBeVisible();
    await expect(owner.page.getByRole('button', { name: 'Create invite link' })).toHaveCount(0);

    // The database itself refuses writes during the grace period.
    const { error: writeErr } = await c.from('recipes').insert({ household_id: hid, title: 'Should fail' });
    expect(writeErr?.code).toBe('42501'); // RLS: write policies require is_household_writable()
    const { data: still } = await c.from('households').select('id').eq('id', hid);
    expect(still ?? []).toHaveLength(1);

    await owner.page.getByRole('button', { name: 'Cancel deletion' }).click();
    await expect(owner.page.getByText('Household deletion cancelled.')).toBeVisible();
    await expect(owner.page.getByTestId('read-only-banner')).toHaveCount(0);
  } finally {
    await owner.context.close();
  }
});

test('household switcher changes the active household and persists across reload', async ({ browser }) => {
  const owner = await userWithHousehold(browser, 'switcher', 'First Home');
  try {
    await createHouseholdUi(owner.page, 'Second Home');
    await owner.page.getByLabel('Switch household').selectOption({ label: 'First Home' });
    await owner.page.getByRole('button', { name: 'Switch' }).click();
    await expect(owner.page.getByRole('heading', { level: 2, name: 'First Home' })).toBeVisible();
    await owner.page.reload();
    await expect(owner.page.getByRole('heading', { level: 2, name: 'First Home' })).toBeVisible();
    const { data } = await adminClient().from('household_members').select('id').eq('user_id', owner.user.id);
    expect(data ?? []).toHaveLength(2);
  } finally {
    await owner.context.close();
  }
});
