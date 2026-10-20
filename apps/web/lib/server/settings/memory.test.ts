import { afterEach, describe, expect, it } from 'vitest';
import { parseDisplayPrefs, serializeDisplayPrefs } from '../../../app/settings/display-prefs';
import { getPlanServicesFor, loadPlanServices, resetPlanServices } from '../plan/services';
import { resetMemorySettings } from './memory-store';
import { loadSettings, removeAllDietary, saveDietary, savePreferences, withdrawConsent, type SettingsCaller } from './service';

const caller = (householdId = 'h-mem'): SettingsCaller => ({ householdId, userId: 'u1', client: null, readOnly: false });
const prefs = { currency: 'GBP', locale: 'en-GB', units: 'metric', defaultServings: '5', weeklyBudget: '' };

describe('settings in mock mode (in-memory store)', () => {
  afterEach(() => {
    resetMemorySettings();
    resetPlanServices();
  });

  it('persists preferences per household and starts from defaults', async () => {
    expect(await loadSettings(caller())).toMatchObject({ ok: true, settings: { defaultServings: 4, weeklyBudgetPence: null, exclusions: [], consentActive: false } });
    await savePreferences(caller(), { ...prefs, weeklyBudget: '70' });
    expect(await loadSettings(caller())).toMatchObject({ settings: { defaultServings: 5, weeklyBudgetPence: 7000 } });
    expect(await loadSettings(caller('h-other'))).toMatchObject({ settings: { defaultServings: 4 } });
  });

  it('consent gate, withdrawal and remove-all drive the planner profile and the withheld count', async () => {
    expect((await loadPlanServices('h-mem')).household.hardExclusions).toEqual([{ ingredientName: 'peanuts', kind: 'allergy' }]); // demo profile until saved
    expect(await saveDietary(caller(), { tags: ['fish'], consent: false })).toMatchObject({ ok: false, error: 'invalid_input' });
    await saveDietary(caller(), { tags: ['fish', 'milk'], consent: true });
    let svc = await loadPlanServices('h-mem');
    expect(svc.household.hardExclusions.map((e) => e.ingredientName)).toEqual(['fish', 'milk']);
    expect(svc.withheldExclusions).toBe(0);

    expect(await withdrawConsent(caller())).toMatchObject({ settings: { exclusions: ['fish', 'milk'], consentActive: false, withheldExclusions: 2 } });
    svc = await loadPlanServices('h-mem');
    expect(svc.household.hardExclusions).toEqual([]);
    expect(svc.withheldExclusions).toBe(2);

    await removeAllDietary(caller());
    svc = await loadPlanServices('h-mem');
    expect(svc.household.hardExclusions).toEqual([]);
    expect(svc.withheldExclusions).toBe(0);
  });

  it('saved servings reach the planner profile; the e2e seed override is untouched until something is saved', async () => {
    getPlanServicesFor('h-mem').withheldExclusions = 3;
    expect((await loadPlanServices('h-mem')).withheldExclusions).toBe(3);
    await savePreferences(caller(), prefs);
    expect((await loadPlanServices('h-mem')).household.defaultServings).toBe(5);
  });

  it('read-only households refuse writes', async () => {
    expect(await savePreferences({ ...caller(), readOnly: true }, prefs)).toEqual({ ok: false, error: 'read_only' });
  });
});

describe('display preferences cookie', () => {
  it('round-trips and falls back to defaults for anything unexpected', () => {
    expect(parseDisplayPrefs(serializeDisplayPrefs({ units: 'imperial', locale: 'en-IE' }))).toEqual({ units: 'imperial', locale: 'en-IE' });
    expect(parseDisplayPrefs('cups|fr-FR')).toEqual({ units: 'metric', locale: 'en-GB' });
    expect(parseDisplayPrefs(undefined)).toEqual({ units: 'metric', locale: 'en-GB' });
  });
});
