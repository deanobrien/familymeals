import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSupabaseMealPlanRepository,
  createSupabasePantryRepository,
  createSupabasePlanRecipeSource,
  createSupabaseRecipeRepository,
  devServiceContextEnabled,
  getDataContext,
  hasSessionSupabase,
  readSupabaseConfig,
  setDataContextProvider,
  useSupabaseBackend,
  type DataContext,
} from './backend';
import { createFakeSupabase } from './test-support/fake-client';

const H = 'aa000000-0000-4000-8000-0000000000aa';
const U = 'a0000000-0000-4000-8000-000000000001';
const SESSION = { DATA_BACKEND: 'supabase', NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.test', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key' };
const SERVICE = { SUPABASE_URL: 'https://x.supabase.test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const DEV = { DATA_BACKEND: 'supabase', SUPABASE_DATA_CONTEXT: 'service', SUPABASE_DEFAULT_HOUSEHOLD_ID: H, ...SERVICE };

afterEach(() => {
  setDataContextProvider(undefined);
  vi.doUnmock('./session-context');
});

describe('backend selection (DATA_BACKEND + Supabase env)', () => {
  it('uses Supabase when DATA_BACKEND=supabase AND the app session env is present', () => {
    expect(hasSessionSupabase(SESSION)).toBe(true);
    expect(useSupabaseBackend(SESSION)).toBe(true);
  });
  it('falls back to in-memory otherwise', () => {
    expect(useSupabaseBackend({})).toBe(false);
    expect(useSupabaseBackend({ ...SESSION, DATA_BACKEND: undefined })).toBe(false); // env without the switch
    expect(useSupabaseBackend({ ...SESSION, DATA_BACKEND: 'memory' })).toBe(false);
    expect(useSupabaseBackend({ DATA_BACKEND: 'supabase', NEXT_PUBLIC_SUPABASE_URL: SESSION.NEXT_PUBLIC_SUPABASE_URL })).toBe(false); // no anon key
    expect(useSupabaseBackend({ DATA_BACKEND: 'supabase', ...SERVICE })).toBe(false); // service key alone is not a data context
  });
  it('a registered provider counts as configured', () => {
    setDataContextProvider(() => ({}) as DataContext);
    expect(useSupabaseBackend({ DATA_BACKEND: 'supabase' })).toBe(true);
    expect(useSupabaseBackend({})).toBe(false);
  });
  it('the dev service fallback needs an explicit opt-in, a household, a service key, and never runs in production', () => {
    expect(devServiceContextEnabled(DEV)).toBe(true);
    expect(useSupabaseBackend(DEV)).toBe(true);
    expect(devServiceContextEnabled({ ...DEV, SUPABASE_DATA_CONTEXT: undefined })).toBe(false); // household id alone does nothing
    expect(devServiceContextEnabled({ ...DEV, SUPABASE_DEFAULT_HOUSEHOLD_ID: undefined })).toBe(false);
    expect(devServiceContextEnabled({ ...DEV, SUPABASE_SERVICE_ROLE_KEY: undefined })).toBe(false);
    expect(devServiceContextEnabled({ ...DEV, NODE_ENV: 'production' })).toBe(false);
  });
  it('reads the dev-fallback service config', () => {
    expect(readSupabaseConfig(SERVICE)).toEqual({ url: 'https://x.supabase.test', key: 'service-key' });
    expect(readSupabaseConfig({})).toBeNull();
  });
});

describe('data context (D100)', () => {
  it('is the signed-in session by default: its user-scoped client, household and member (no service role)', async () => {
    const ctx: DataContext = { client: createFakeSupabase().client, householdId: H, userId: U };
    vi.doMock('./session-context', () => ({ sessionDataContext: async () => ctx }));
    expect(await getDataContext(SESSION)).toBe(ctx);
    // a household id in the env is ignored when it is not the explicit dev fallback
    expect(await getDataContext({ ...SESSION, SUPABASE_DEFAULT_HOUSEHOLD_ID: 'ignored', ...SERVICE })).toBe(ctx);
  });
  it('the documented dev fallback builds one service client for the configured household', async () => {
    const a = await getDataContext({ ...DEV, SUPABASE_DEFAULT_USER_ID: U });
    const b = await getDataContext(DEV);
    expect(a).toMatchObject({ householdId: H, userId: U });
    expect(b.userId).toBeNull();
    expect(b.client).toBe(a.client);
  });
  it('is refused when nothing is configured', async () => {
    await expect(getDataContext({})).rejects.toThrow(/not configured/);
    await expect(getDataContext({ ...DEV, NODE_ENV: 'production' })).rejects.toThrow(/not configured/);
  });
  it('a registered provider wins over everything', async () => {
    const ctx = { client: createFakeSupabase().client, householdId: H, userId: U };
    setDataContextProvider(() => ctx);
    expect(await getDataContext({})).toBe(ctx);
    expect(await getDataContext(DEV)).toBe(ctx);
  });
});

describe('lazy repositories resolve the context on every call', () => {
  it('route each call through the provider (per-request clients and households)', async () => {
    const seen: string[] = [];
    const resolve = async (): Promise<DataContext> => {
      const { client } = createFakeSupabase((c) => {
        seen.push(`${c.name}`);
        return { data: c.name === 'list_recipes' ? { total: 0, items: [] } : c.name === 'select_meal_plans' ? [] : null };
      });
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
  it('builds the summariser for the CONTEXT household, so each request is costed with its own household prices', async () => {
    const asked: string[] = [];
    const { client } = createFakeSupabase(() => ({ data: { total: 0, items: [] } }));
    const recipes = createSupabaseRecipeRepository(
      async () => ({ client, householdId: H, userId: U }),
      (householdId) => {
        asked.push(householdId);
        return { summarise: () => ({ cost: { totalPence: 1, kind: 'generic_estimate' as const }, nutritionPerServing: [] }) };
      },
    );
    await recipes.list({ q: '', tags: [], sort: 'name', page: 1, pageSize: 12 });
    expect(asked).toEqual([H]);
  });
});
