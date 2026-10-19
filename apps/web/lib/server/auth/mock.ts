import type { SupabaseClient } from '@supabase/supabase-js';
import type { HouseholdSummary } from './memberships';

/**
 * Local mock auth: only for dev/CI without a Supabase stack. Refuses outright in production, in addition to
 * resolveAuthMode() never returning 'mock' there (defence in depth, mirrors the @fr/ai mock guard).
 */
export const MOCK_USER_ID = '00000000-0000-4000-8000-00000000f001';
export const MOCK_HOUSEHOLD_ID = '00000000-0000-4000-8000-00000000f002';

export class MockAuthForbiddenError extends Error {
  constructor() {
    super('Mock auth is not allowed when NODE_ENV=production');
    this.name = 'MockAuthForbiddenError';
  }
}

export function assertMockAllowed(nodeEnv: string | undefined = process.env.NODE_ENV): void {
  if (nodeEnv === 'production') throw new MockAuthForbiddenError();
}

export function getMockIdentity(nodeEnv: string | undefined = process.env.NODE_ENV): {
  user: { id: string; email: string | null };
  household: HouseholdSummary;
} {
  assertMockAllowed(nodeEnv);
  return {
    user: { id: MOCK_USER_ID, email: null },
    household: {
      id: MOCK_HOUSEHOLD_ID,
      name: 'Mock household',
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
