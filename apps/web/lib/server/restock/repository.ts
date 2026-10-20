// Persistence boundary for minimum-stock par levels + restock settings (PR1, D280-D289).
import type { ParLevel, Uuid } from '../../pantry/engine';
import { DEFAULT_RESTOCK_SETTINGS, type RestockSettings } from '../../restock/types';

export interface RestockRepository {
  listPars(householdId: Uuid): Promise<ParLevel[]>;
  /** Insert or replace by id. */
  savePar(householdId: Uuid, par: ParLevel): Promise<void>;
  deletePar(householdId: Uuid, id: Uuid): Promise<void>;
  getSettings(householdId: Uuid): Promise<RestockSettings>;
  saveSettings(householdId: Uuid, settings: RestockSettings): Promise<void>;
}

/** In-memory implementation (mock mode, tests). Process-local. */
export class InMemoryRestockRepository implements RestockRepository {
  private pars = new Map<Uuid, ParLevel[]>();
  private settings = new Map<Uuid, RestockSettings>();

  async listPars(householdId: Uuid): Promise<ParLevel[]> {
    return structuredClone(this.pars.get(householdId) ?? []);
  }
  async savePar(householdId: Uuid, par: ParLevel): Promise<void> {
    const list = (this.pars.get(householdId) ?? []).filter((p) => p.id !== par.id);
    this.pars.set(householdId, [...list, structuredClone(par)]);
  }
  async deletePar(householdId: Uuid, id: Uuid): Promise<void> {
    this.pars.set(householdId, (this.pars.get(householdId) ?? []).filter((p) => p.id !== id));
  }
  async getSettings(householdId: Uuid): Promise<RestockSettings> {
    return { ...(this.settings.get(householdId) ?? DEFAULT_RESTOCK_SETTINGS) };
  }
  async saveSettings(householdId: Uuid, settings: RestockSettings): Promise<void> {
    this.settings.set(householdId, { ...settings });
  }
}
