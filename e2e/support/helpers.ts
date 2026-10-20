// Shared E2E helpers. Mock-auth mode (no Supabase env) is what every runnable spec uses: the "signed-in" user is
// Alice and the household is selected by the dev-only `fr_household=e2e-*` sandbox cookie (empty, isolated).
// Selectors are role/label/data-testid based; never CSS classes.
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export interface TestUser { email: string; password: string; displayName: string; }

/** Unique per-run user so parallel workers never collide. Uses the reserved .test TLD. */
export function newUser(tag: string): TestUser {
  const n = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { email: `${tag}.${n}@fr-test.test`, password: 'Test-Only-Passw0rd!', displayName: `QA ${tag}` };
}

let seq = 0;
/** A fresh sandbox household id (matches the app's `^e2e-[\w-]{1,60}$` mock-auth pattern). */
export function newHouseholdId(tag = 'e2e'): string {
  return `e2e-${tag}-${Date.now().toString(36)}-${++seq}-${Math.random().toString(36).slice(2, 6)}`.slice(0, 64);
}

/** Select a sandbox household for a browser context (mock auth only). */
export async function enterHousehold(context: BrowserContext, householdId: string): Promise<void> {
  await context.addCookies([{ name: 'fr_household', value: householdId, domain: 'localhost', path: '/' }]);
}

/** A fully isolated second browser session (own cookies/storage), optionally in the same sandbox household. */
export async function secondSession(browser: Browser, householdId?: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  if (householdId) await enterHousehold(context, householdId);
  const page = await context.newPage();
  return { context, page };
}

/**
 * From a recipe detail page, open the editor. A click on "Edit" immediately after the save redirect can be swallowed
 * while the detail page is still settling (seen in dev and prod builds, FL1), so retry the click until the editor shows.
 */
export async function openRecipeEditor(page: Page): Promise<void> {
  await expect(async () => {
    if (!/\/edit$/.test(page.url())) await page.getByRole('link', { name: 'Edit', exact: true }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Edit recipe' })).toBeVisible({ timeout: 10_000 });
  }).toPass({ timeout: 60_000 });
}

export interface PlanEntry { recipeId: string; servings: number; }

/** Seed library recipe ids (packages/refdata seeds, also used by the shopping spec). */
export const SEED = {
  pasta: '00000000-0000-4000-8000-000000000001',
  beefStew: '00000000-0000-4000-8000-000000000003',
  curry: '00000000-0000-4000-8000-000000000005',
  chickpeaStew: '00000000-0000-4000-8000-000000000008',
} as const;

/** Approve a plan for the context's (cookie) household through the dev-only seed endpoint; returns the plan id. */
export async function seedApprovedPlan(context: BrowserContext, entries?: PlanEntry[]): Promise<string> {
  const res = await context.request.post('/api/dev/seed', { data: { kind: 'approved-plan', ...(entries ? { entries } : {}) } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { planId: string }).planId;
}

/** Add one item to the household's shopping list through the dev-only seed endpoint. */
export async function seedShoppingItem(context: BrowserContext, name: string, value?: number, unit?: string): Promise<string> {
  const res = await context.request.post('/api/dev/seed', { data: { kind: 'shopping-item', name, ...(value !== undefined ? { value } : {}), ...(unit ? { unit } : {}) } });
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { itemId: string }).itemId;
}

/**
 * Live-Supabase-only flows. These need a real auth server (sign-up emails, invitations, memberships); in mock
 * auth mode the sign-up/household pages are intentionally disabled. Specs that need them are marked
 * `test.fixme(true, 'needs live Supabase')` and never call these.
 */
export async function signUp(_page: Page, _user: TestUser): Promise<void> {
  throw new Error('signUp needs a live Supabase stack (mock auth mode has no sign-up)');
}
export async function createHousehold(_page: Page, name: string): Promise<string> {
  throw new Error(`createHousehold(${name}) needs a live Supabase stack`);
}
export async function acceptInvite(_page: Page, _inviteUrl: string, _user: TestUser): Promise<void> {
  throw new Error('acceptInvite needs a live Supabase stack');
}

export const FIXTURES_DIR = new URL('../fixtures/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
