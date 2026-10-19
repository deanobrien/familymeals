// Helpers for the live-Supabase suite (D143). Everything here talks to the LOCAL stack only.
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface LiveUser {
  email: string;
  password: string;
}

const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} missing: run via playwright.live.config.ts (pnpm test:e2e:live)`);
  return v;
};

export const supabaseUrl = () => env('NEXT_PUBLIC_SUPABASE_URL');
const anonKey = () => env('NEXT_PUBLIC_SUPABASE_ANON_KEY');
const mailpitUrl = () => env('LOCAL_MAILPIT_URL');

/** Unique per test so parallel workers and reruns never collide (reserved .test TLD). */
export function liveUser(tag: string): LiveUser {
  const n = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  return { email: `${tag}.${n}@fr-live.test`, password: 'Live-Test-Passw0rd!' };
}

/** Service-role client for test SETUP only (fast user creation, assertions that need to see everything). */
export function adminClient(): SupabaseClient {
  return createClient(supabaseUrl(), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
}

/** A PostgREST client acting as `user` (anon key + the user's JWT), i.e. exactly what RLS sees for that user. */
export async function userClient(user: LiveUser): Promise<SupabaseClient> {
  const c = createClient(supabaseUrl(), anonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword(user);
  if (error) throw new Error(`sign-in as ${user.email} failed: ${error.message}`);
  return c;
}

/** Creates a confirmed user directly (setup shortcut; the sign-up spec covers the real email flow). */
export async function createConfirmedUser(tag: string): Promise<LiveUser & { id: string }> {
  const u = liveUser(tag);
  const { data, error } = await adminClient().auth.admin.createUser({ email: u.email, password: u.password, email_confirm: true });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  return { ...u, id: data.user.id };
}

interface MailpitSummary {
  ID: string;
}

/** Waits for the newest Mailpit message to `email` and returns its text + HTML. */
export async function latestEmail(email: string, timeoutMs = 30_000): Promise<{ text: string; html: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const res = await fetch(`${mailpitUrl()}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    if (res.ok) {
      const body = (await res.json()) as { messages?: MailpitSummary[] };
      const first = body.messages?.[0];
      if (first) {
        const msg = (await (await fetch(`${mailpitUrl()}/api/v1/message/${first.ID}`)).json()) as { Text?: string; HTML?: string };
        return { text: msg.Text ?? '', html: msg.HTML ?? '' };
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no email for ${email} within ${timeoutMs} ms`);
}

/** The Supabase verify link in a confirmation / recovery email. */
export function verifyLink(mail: { text: string; html: string }): string {
  const m = /(https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+)/.exec(mail.text) ?? /(https?:\/\/[^\s"'<>]+\/auth\/v1\/verify\?[^\s"'<>]+)/.exec(mail.html);
  if (!m) throw new Error('no /auth/v1/verify link in the email');
  return m[1]!.replace(/&amp;/g, '&');
}

/** Real UI sign-up + email confirmation through Mailpit; ends signed in on `expectPath`. */
export async function signUpAndConfirm(page: Page, user: LiveUser, next?: string): Promise<void> {
  await page.goto(next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const link = verifyLink(await latestEmail(user.email));
  await page.goto(link);
}

export async function signIn(page: Page, user: LiveUser): Promise<void> {
  await page.goto('/sign-in');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).not.toHaveURL(/\/sign-in/);
}

/** Onboarding form: creates a household and lands on /household. */
export async function createHouseholdUi(page: Page, name: string, displayName?: string): Promise<void> {
  await page.goto('/household/new');
  await page.getByLabel('Household name').fill(name);
  if (displayName) await page.getByLabel(/Your name in this household/).fill(displayName);
  await page.getByRole('button', { name: 'Create household' }).click();
  await expect(page).toHaveURL(/\/household(\?|$)/);
  await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();
}

/** A signed-in user with a household, created quickly (admin user + UI sign-in + onboarding). */
export async function userWithHousehold(
  browser: Browser,
  tag: string,
  householdName: string,
  displayName?: string,
): Promise<{ user: LiveUser & { id: string }; context: BrowserContext; page: Page }> {
  const user = await createConfirmedUser(tag);
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, user);
  await createHouseholdUi(page, householdName, displayName);
  return { user, context, page };
}

/** Owner creates an invite link in the UI and returns it. */
export async function createInviteLink(page: Page, opts: { email?: string; role?: 'member' | 'owner' } = {}): Promise<string> {
  await page.goto('/household');
  if (opts.email) await page.getByLabel(/^Email/).fill(opts.email);
  if (opts.role) await page.getByLabel('Role').selectOption(opts.role);
  await page.getByRole('button', { name: 'Create invite link' }).click();
  const link = page.getByLabel('Invite link');
  await expect(link).toHaveValue(/\/invite\/[0-9a-f]{64}$/);
  return link.inputValue();
}

/** The household id for a user's (single) active membership, read with the USER's own RLS-scoped client. */
export async function householdIdOf(user: LiveUser): Promise<string> {
  const c = await userClient(user);
  const { data, error } = await c.from('household_members').select('household_id').eq('status', 'active');
  if (error || !data?.[0]) throw new Error(`no membership for ${user.email}: ${error?.message}`);
  return data[0].household_id as string;
}
