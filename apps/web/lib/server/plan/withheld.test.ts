import { afterEach, describe, expect, it } from 'vitest';
import { getPlanServicesFor, loadPlanServices, resetPlanServices } from './services';

// The consent notice reads PlanServices.withheldExclusions (D129). In Supabase mode loadPlanServices refreshes it from
// planner_household_profile (covered by the PGlite contract tests); in mock mode the dev seed sets it per household.
describe('withheld exclusion count', () => {
  afterEach(() => resetPlanServices());

  it('defaults to nothing withheld', async () => {
    expect((await loadPlanServices('h-withheld-a')).withheldExclusions ?? 0).toBe(0);
  });

  it('is kept per household and survives loadPlanServices in mock mode', async () => {
    getPlanServicesFor('h-withheld-a').withheldExclusions = 3;
    expect((await loadPlanServices('h-withheld-a')).withheldExclusions).toBe(3);
    expect((await loadPlanServices('h-withheld-b')).withheldExclusions ?? 0).toBe(0);
  });

  it('is cleared by the e2e reset', async () => {
    getPlanServicesFor('h-withheld-a').withheldExclusions = 3;
    resetPlanServices();
    expect((await loadPlanServices('h-withheld-a')).withheldExclusions ?? 0).toBe(0);
  });
});
