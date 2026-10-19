import { afterEach, describe, expect, it } from 'vitest';
import {
  createSupabaseMealPlanRepository,
  createSupabasePantryRepository,
  createSupabasePlanRecipeSource,
  createSupabaseRecipeRepository,
  getDataContext,
  readSupabaseConfig,
  setDataContextProvider,
  useSupabaseBackend,
  type DataContext,
} from './backend';
import { createFakeSupabase } from './test-support/fake-client';

const H = 'aa000000-0000-4000-8000-0000000000aa';
const U = 'a0000000-0000-4000-8000-000000000001';
const FULL = { DATA_BACKEND: 'supabase', SUPABASE_URL: 'https://x.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };

afterEach(() => setDataContextProvider(undefined));

describe('backend selection (DATA_BACKEND + Supabase env)', () => {
  it('uses Supabase only when DATA_BACKEND=supabase AND the env is present', () => {
    expect(useSupabaseBackend(FULL)).toBe(true);
    expect(useSupabaseBackend({ ...FULL, SUPABASE_URL: undefined, NEXT_PUBLIC_SUPABASE_URL: 'https://y.supabase.test' })).toBe(true);
  });
  it('falls back to in-memory otherwise', () => {
    expect(useSupabaseBackend({})).toBe(false);
    expect(useSupabaseBackend({ SUPABASE_URL: FULL.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: 'k' })).toBe(false); // env without the switch
    expect(useSupabaseBackend({ ...FULL, DATA_BACKEND: 'memory' })).toBe(false);
    expect(useSupabaseBackend({ DATA_BACKEND: 'supabase', SUPABASE_URL: FULL.SUPABASE_URL })).toBe(false); // no key
    expect(useSupabaseBackend({ DATA_BACKEND: 'supabase', SUPABASE_SERVICE_ROLE_KEY: 'k' })).toBe(false); // no url
  });
  it('a registered auth-lane provider counts as configured', () => {
    setDataContextProvider(() => ({}) as DataContext);
    expect(useSupabaseBackend({ DATA_BACKEND: 'supabase' })).toBe(true);
    expect(useSupabaseBackend({})).toBe(false);
  });
  it('reads the interim service config', () => {
    expect(readSupabaseConfig(FULL)).toEqual({ url: 'https://x.supabase.test', key: 'service-key' });
    expect(readSupabaseConfig({})).toBeNull();
  });
});

describe('data context', () => {
  it('interim provider needs a household; builds a service client once', async () => {
    await expect(getDataContext(FULL)).rejects.toThrow(/SUPABASE_DEFAULT_HOUSEHOLD_ID/);
    const a = await getDataContext({ ...FULL, SUPABASE_DEFAULT_HOUSEHOLD_ID: H, SUPABASE_DEFAULT_USER_ID: U });
    const b = await getDataContext({ ...FULL, SUPABASE_DEFAULT_HOUSEHOLD_ID: H });
    expect(a).toMatchObject({ householdId: H, userId: U });
    expect(b.userId).toBeNull();
    expect(b.client).toBe(a.client);
    await expect(getDataContext({})).rejects.toThrow(/not configured/);
  });
  it('a registered provider wins', async () => {
    const ctx = { client: createFakeSupabase().client, householdId: H, userId: U };
    setDataContextProvider(() => ctx);
    expect(await getDataContext({})).toBe(ctx);
  });
});

describe('lazy repositories resolve the context on every call', () => {
  it('route each call through the provider (per-request clients and households)', async () => {
    const seen: string[] = [];
    const resolve = async (): Promise<DataContext> => {
      const { client, calls } = createFakeSupabase((c) => {
        seen.push(`${c.name}`);
        return { data: c.name === 'list_recipes' ? { total: 0, items: [] } : c.name === 'select_meal_plans' ? [] : null };
      });
      void calls;
      return { client, householdId: H, userId: U };
    };
    const recipes = createSupabaseRecipeRepository(resolve);
    expect((await recipes.list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 12 })).total).toBe(0);
    expect(await createSupabaseMealPlanRepository(resolve).list(H)).toEqual([]);
    expect(await createSupabasePlanRecipeSource(resolve).list(H)).toEqual([]);
    expect(await createSupabasePantryRepository(resolve).getSettings(H)).toEqual({ purchaseMode: 'suggest', staleAfterDays: 14 });
    expect(seen).toEqual(['list_recipes', 'select_meal_plans', 'list_recipes', 'pantry_settings']);
  });
  it('is not mistaken for a thenable and rejects unknown methods', async () => {
    const recipes = createSupabaseRecipeRepository(async () => ({ client: createFakeSupabase().client, householdId: H, userId: U }));
    expect((recipes as unknown as { then?: unknown }).then).toBeUndefined();
    await expect((recipes as unknown as { nope: () => Promise<void> }).nope()).rejects.toThrow(/Unknown repository method/);
  });
});
