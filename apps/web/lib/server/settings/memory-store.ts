import type { HouseholdSettings, SettingsStore } from './types';

interface Entry {
  defaultServings: number;
  weeklyBudgetPence: number | null;
  exclusions: string[];
  consentActive: boolean;
}

const g = globalThis as { __frSettingsMemory?: Map<string, Entry> };
const map = (): Map<string, Entry> => (g.__frSettingsMemory ??= new Map());

const fresh = (): Entry => ({ defaultServings: 4, weeklyBudgetPence: null, exclusions: [], consentActive: false });
const view = (e: Entry): HouseholdSettings => ({
  defaultServings: e.defaultServings,
  weeklyBudgetPence: e.weeklyBudgetPence,
  exclusions: [...e.exclusions],
  consentActive: e.consentActive,
  withheldExclusions: e.consentActive ? 0 : e.exclusions.length,
});

/** Mock mode only: the household's saved settings, or null while nothing was ever saved (the planner then keeps its demo profile). */
export function peekMemorySettings(householdId: string): HouseholdSettings | null {
  const e = map().get(householdId);
  return e ? view(e) : null;
}

export function resetMemorySettings(): void {
  g.__frSettingsMemory = undefined;
}

/** In-memory demo store (mock auth mode): per household, lost on restart, cleared by the dev reset. */
export class MemorySettingsStore implements SettingsStore {
  private entry(householdId: string): Entry {
    let e = map().get(householdId);
    if (!e) map().set(householdId, (e = fresh()));
    return e;
  }
  async get(householdId: string): Promise<HouseholdSettings> {
    return view(map().get(householdId) ?? fresh());
  }
  async savePreferences(householdId: string, prefs: { defaultServings: number; weeklyBudgetPence: number | null }): Promise<void> {
    const e = this.entry(householdId);
    e.defaultServings = prefs.defaultServings;
    e.weeklyBudgetPence = prefs.weeklyBudgetPence;
  }
  async saveExclusions(householdId: string, _userId: string, tags: string[]): Promise<void> {
    const e = this.entry(householdId);
    e.exclusions = [...new Set(tags)];
    if (e.exclusions.length > 0) e.consentActive = true;
  }
  async withdrawConsent(householdId: string): Promise<void> {
    this.entry(householdId).consentActive = false;
  }
  async removeAllDietary(householdId: string): Promise<void> {
    const e = this.entry(householdId);
    e.exclusions = [];
    e.consentActive = false;
  }
}
