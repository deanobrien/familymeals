import { describe, expect, it, vi } from 'vitest';
import { fakeStorage } from './fake-storage';
import { runWithDataContext, scopedDataContext } from '../supabase/request-data-context';
import type { DataContext } from '../supabase/backend';

vi.mock('../supabase/backend', () => ({ useSupabaseBackend: () => true }));
vi.mock('../supabase/session-context', () => ({ sessionDataContext: async () => { throw new Error('cookie session must not be used'); } }));

const HH = 'aa000000-0000-4000-8000-0000000000aa';
const ID = '11111111-2222-4333-8444-555555555555';

describe('bearer caller + ImageStore (M3 x ST1)', () => {
  it('imageStoreFor uses the caller-verified (bearer) client and household, inside the request data context', async () => {
    const { imageStoreFor } = await import('./index');
    const bearer = fakeStorage();
    const ctx = { client: bearer, householdId: HH, userId: 'u1' } as unknown as DataContext;
    const path = await runWithDataContext(ctx, async () => {
      expect(scopedDataContext()).toBe(ctx);
      return imageStoreFor({ dataContext: ctx }).put('cover', ID, 'cover.jpg', new Uint8Array([1, 2, 3]));
    });
    expect(path).toBe(`${HH}/cover/${ID}/cover.jpg`);
    expect(bearer.calls.some((c) => c.op === 'upload' && c.args[0] === path)).toBe(true);
    expect([...bearer.objects.keys()].every((k) => k.includes(`/${HH}/`))).toBe(true);
  });
});
