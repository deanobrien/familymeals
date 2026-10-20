import { describe, expect, it } from 'vitest';
import { effectiveNodeEnv, isE2eProductionBuild } from './e2e-mode';
import { productionConfigProblems } from './server/config/production';
import { devToolsAllowed } from './server/dev/reset';
import { resolveAuthMode } from './supabase/env';

describe('e2e production-build mode', () => {
  const e2e = { NODE_ENV: 'production', E2E_PRODUCTION_BUILD: '1' };

  it('turns the production guards off only for NODE_ENV=production + flag + no Supabase + not DATA_BACKEND=supabase', () => {
    expect(isE2eProductionBuild(e2e)).toBe(true);
    expect(effectiveNodeEnv(e2e)).toBe('e2e-production-build');
    expect(productionConfigProblems(e2e)).toEqual([]);
    expect(devToolsAllowed(e2e)).toBe(true);
    expect(resolveAuthMode({ ...e2e })).toBe('mock');
  });

  it('is inert without the flag (real production stays locked down)', () => {
    const prod = { NODE_ENV: 'production' };
    expect(isE2eProductionBuild(prod)).toBe(false);
    expect(effectiveNodeEnv(prod)).toBe('production');
    expect(devToolsAllowed(prod)).toBe(false);
    expect(resolveAuthMode(prod)).toBe('unconfigured');
    expect(productionConfigProblems(prod).length).toBeGreaterThan(0);
  });

  it('is inert on a real deployment even if the flag is set by mistake', () => {
    const real = { ...e2e, NEXT_PUBLIC_SUPABASE_URL: 'https://x.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: 'k', DATA_BACKEND: 'supabase' };
    expect(isE2eProductionBuild(real)).toBe(false);
    expect(devToolsAllowed(real)).toBe(false);
    expect(productionConfigProblems(real).length).toBeGreaterThan(0);
    expect(isE2eProductionBuild({ ...e2e, DATA_BACKEND: 'supabase' })).toBe(false);
  });

  it('does nothing outside production', () => {
    expect(effectiveNodeEnv({ NODE_ENV: 'development', E2E_PRODUCTION_BUILD: '1' })).toBe('development');
  });
});
