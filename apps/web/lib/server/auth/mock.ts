import { effectiveNodeEnv } from '../../e2e-mode';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HouseholdSummary } from './memberships';

/**
 * Local mock auth: only for dev/CI without a Supabase stack. Refuses outright in production, in addition to
 * resolveAuthMode() never returning 'mock' there (defence in depth, mirrors the @fr/ai mock guard).
 */
/** Seeded demo identity = household A of the QA fixtures (e2e/fixtures/households/household-a.json). */
export const MOCK_USER_ID = 'a1a1a102-0000-4000-8000-000000000001';
export const MOCK_USER_NAME = 'Alice Smith';
export const MOCK_HOUSEHOLD_ID = 'a1a1a101-0000-4000-8000-000000000001';
export const MOCK_HOUSEHOLD_NAME = 'The Smiths (A)';

/**
 * Mock mode only: an `fr_household` cookie of the form `e2e-<id>` selects an isolated, empty sandbox household
 * so parallel Playwright tests do not share state. Anything else falls back to household A.
 */
export const MOCK_SANDBOX_PATTERN = /^e2e-[\w-]{1,60}$/;

export class MockAuthForbiddenError extends Error {
  constructor() {
    super('Mock auth is not allowed when NODE_ENV=production');
    this.name = 'MockAuthForbiddenError';
  }
}

export function assertMockAllowed(nodeEnv: string | undefined = effectiveNodeEnv()): void {
  if (nodeEnv === 'production') throw new MockAuthForbiddenError();
}

export function getMockIdentity(nodeEnv: string | undefined = effectiveNodeEnv(), sandboxId?: string): {
  user: { id: string; email: string | null };
  household: HouseholdSummary;
} {
  assertMockAllowed(nodeEnv);
  const sandbox = sandboxId !== undefined && MOCK_SANDBOX_PATTERN.test(sandboxId) ? sandboxId : undefined;
  return {
    user: { id: MOCK_USER_ID, email: null },
    household: {
      id: sandbox ?? MOCK_HOUSEHOLD_ID,
      name: sandbox ? `Sandbox ${sandbox}` : MOCK_HOUSEHOLD_NAME,
      status: 'active',
      role: 'owner',
      defaultServings: 4,
      weeklyBudgetPence: null,
      joinedAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

/** A client that throws on any use, so mock mode can never silently talk to a database. */
export function createUnavailableClient(): SupabaseClient {
  const boom = () => {
    throw new Error('Supabase is unavailable in local mock auth mode');
  };
  return new Proxy({}, { get: () => boom }) as unknown as SupabaseClient;
}
