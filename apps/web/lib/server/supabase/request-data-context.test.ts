import { describe, expect, it, vi } from 'vitest';
import type { DataContext } from './backend';

// A cookie lookup would redirect to /sign-in; a Bearer caller must never reach it.
vi.mock('../auth/household-context', () => ({
  requireHouseholdContext: async () => {
    throw new Error('NEXT_REDIRECT (cookie session consulted)');
  },
}));

const { runWithDataContext, scopedDataContext } = await import('./request-data-context');
const { sessionDataContext } = await import('./session-context');

const ctx = (id: string): DataContext => ({ client: {} as DataContext['client'], householdId: id, userId: `user-${id}` });

describe('runWithDataContext (Bearer callers, D213)', () => {
  it('makes sessionDataContext return the verified context without touching the cookie session', async () => {
    const a = ctx('hh-a');
    await expect(runWithDataContext(a, () => sessionDataContext())).resolves.toBe(a);
  });

  it('reaches code that awaits several levels down', async () => {
    const a = ctx('hh-a');
    const deep = async () => {
      await Promise.resolve();
      await new Promise((r) => setTimeout(r, 1));
      return (await sessionDataContext()).householdId;
    };
    await expect(runWithDataContext(a, deep)).resolves.toBe('hh-a');
  });

  it('keeps concurrent requests apart', async () => {
    const run = (id: string, ms: number) =>
      runWithDataContext(ctx(id), async () => {
        await new Promise((r) => setTimeout(r, ms));
        return (await sessionDataContext()).householdId;
      });
    await expect(Promise.all([run('hh-a', 15), run('hh-b', 1), run('hh-c', 8)])).resolves.toEqual(['hh-a', 'hh-b', 'hh-c']);
  });

  it('leaves nothing behind after the call and falls back to the cookie session for null contexts', async () => {
    await runWithDataContext(ctx('hh-a'), async () => undefined);
    expect(scopedDataContext()).toBeUndefined();
    await expect(sessionDataContext()).rejects.toThrow('cookie session consulted');
    await expect(runWithDataContext(null, () => sessionDataContext())).rejects.toThrow('cookie session consulted');
  });
});
