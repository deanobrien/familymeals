// Shared E2E helpers (stubs). Drop into C:\TFS\FamilyRecipes\e2e\ and implement against the real UI.
// Real implementations must use data-testid / role selectors only; never CSS classes.
import type { Browser, BrowserContext, Page } from '@playwright/test';

export interface TestUser { email: string; password: string; displayName: string; }

/** Unique per-run user so parallel workers never collide. Uses the reserved .test TLD. */
export function newUser(tag: string): TestUser {
  const n = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { email: `${tag}.${n}@fr-test.test`, password: 'Test-Only-Passw0rd!', displayName: `QA ${tag}` };
}

/** Create an account via the UI and land signed-in. TODO(L11): implement against /sign-up. */
export async function signUp(page: Page, user: TestUser): Promise<void> {
  void page; void user;
  throw new Error('signUp not implemented yet (L11 auth)');
}

/** Create a household as the signed-in user; returns the household name. TODO(L11). */
export async function createHousehold(page: Page, name: string): Promise<string> {
  void page;
  throw new Error(`createHousehold(${name}) not implemented yet (L11 household)`);
}

/** Join an existing household via invite link (second member). TODO(L20 invitations). */
export async function acceptInvite(page: Page, inviteUrl: string, user: TestUser): Promise<void> {
  void page; void inviteUrl; void user;
  throw new Error('acceptInvite not implemented yet (L20)');
}

/** A fully isolated second browser session (own cookies/storage) for sync + RLS tests. */
export async function secondSession(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
}

/**
 * Route all AI calls to deterministic mocks keyed by fixture name. The app must run with
 * AI_PROVIDER=mock; this additionally lets a test choose which canned response is returned.
 * TODO(L4/L13): agree header/endpoint, e.g. POST /api/test/ai-fixture {kind,name}.
 */
export async function useMockAi(page: Page, kind: 'recipe' | 'receipt', fixtureName: string): Promise<void> {
  void page; void kind; void fixtureName;
  throw new Error('useMockAi not implemented yet (L4 mock provider)');
}

export const FIXTURES_DIR = new URL('../fixtures/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
