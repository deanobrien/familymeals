import { redirect } from 'next/navigation';
import { Button, Input } from '@fr/ui';
import { resolveAuthMode } from '../../../lib/supabase/env';
import { messageFor } from '../../../lib/server/auth/errors';
import { getAuthState } from '../../../lib/server/auth/household-context';
import { createHouseholdAction } from '../actions';

export const metadata = { title: 'Create your household' };

/** Onboarding after sign-up (also reachable later to create an additional household). */
export default async function NewHouseholdPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  if (resolveAuthMode() === 'mock') redirect('/household');
  const state = await getAuthState();
  if (!state) redirect('/sign-in?next=%2Fhousehold%2Fnew');
  const err = messageFor(typeof sp.error === 'string' ? sp.error : undefined);
  const first = state.memberships.length === 0;
  return (
    <main style={{ maxWidth: 480, display: 'grid', gap: '1rem' }}>
      <h1>{first ? 'Set up your household' : 'Create another household'}</h1>
      <p>A household is the shared space for your recipes, meal plans and shopping lists. You can invite family members afterwards.</p>
      {err && <p role="alert">{err}</p>}
      <form action={createHouseholdAction} style={{ display: 'grid', gap: '0.75rem' }}>
        <Input label="Household name" name="name" required maxLength={120} placeholder="The Smiths" />
        <Input label="Your name in this household (optional)" name="displayName" maxLength={80} autoComplete="nickname" />
        <Input label="Default servings" name="defaultServings" type="number" min={1} max={50} defaultValue={4} required />
        <Input label="Weekly food budget in pounds (optional)" name="weeklyBudgetPounds" type="number" min={0} step="0.01" inputMode="decimal" />
        <Button type="submit">Create household</Button>
      </form>
    </main>
  );
}
