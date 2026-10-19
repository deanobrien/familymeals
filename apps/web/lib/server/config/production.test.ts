import { describe, expect, it } from 'vitest';
import { assertProductionConfig, productionConfigProblems } from './production';
import { isPublicPath } from '../auth/routes';

const good = {
  NODE_ENV: 'production',
  NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon',
  DATA_BACKEND: 'supabase',
  APP_SECRET: 'a-secret-of-16-chars-or-more',
  ALLOW_LOCAL_FILE_STORE: 'true',
};

describe('production config', () => {
  it('is silent outside production', () => {
    expect(productionConfigProblems({ NODE_ENV: 'development' })).toEqual([]);
    expect(productionConfigProblems({})).toEqual([]);
  });
  it('accepts a complete production env', () => {
    expect(productionConfigProblems(good)).toEqual([]);
    expect(() => assertProductionConfig(good)).not.toThrow();
  });
  it('refuses mock auth, in-memory backend, weak/missing secret, mock AI, local stores', () => {
    expect(productionConfigProblems({ ...good, NEXT_PUBLIC_SUPABASE_URL: '' })[0]).toMatch(/SUPABASE/);
    expect(productionConfigProblems({ ...good, DATA_BACKEND: undefined })[0]).toMatch(/DATA_BACKEND/);
    expect(productionConfigProblems({ ...good, APP_SECRET: undefined })[0]).toMatch(/APP_SECRET is required/);
    expect(productionConfigProblems({ ...good, APP_SECRET: 'short' })[0]).toMatch(/16/);
    expect(productionConfigProblems({ ...good, AI_PROVIDER: 'mock' })[0]).toMatch(/mock AI/);
    expect(productionConfigProblems({ ...good, ALLOW_LOCAL_FILE_STORE: undefined })[0]).toMatch(/ALLOW_LOCAL_FILE_STORE/);
    expect(() => assertProductionConfig({ NODE_ENV: 'production' })).toThrow(/Invalid production configuration/);
  });
});

describe('health route is public', () => {
  it('bypasses auth', () => {
    expect(isPublicPath('/api/health')).toBe(true);
    expect(isPublicPath('/api/extract')).toBe(false);
  });
});
