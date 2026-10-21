import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KeyValueStore } from '@/data/offlineQueue';
import type { LastTick } from './widgetModel';

export const WIDGET_STATE_KEY = 'fr.widget.v1';

/** What the widget remembers between runs: which household the app last showed, and the last tick (for Undo). Nothing else. */
export interface WidgetPrefs {
  householdId: string | null;
  lastTick: LastTick | null;
}

const EMPTY: WidgetPrefs = { householdId: null, lastTick: null };

export class WidgetStateStore {
  constructor(private readonly kv: KeyValueStore = AsyncStorage) {}

  async load(): Promise<WidgetPrefs> {
    try {
      const raw = await this.kv.getItem(WIDGET_STATE_KEY);
      if (!raw) return EMPTY;
      const v = JSON.parse(raw) as Partial<WidgetPrefs>;
      const t = v.lastTick;
      return {
        householdId: typeof v.householdId === 'string' && v.householdId ? v.householdId : null,
        lastTick: t && typeof t.itemId === 'string' && typeof t.name === 'string' && typeof t.at === 'number' ? t : null,
      };
    } catch {
      return EMPTY;
    }
  }

  async save(p: WidgetPrefs): Promise<void> {
    try {
      if (!p.householdId) await this.kv.removeItem(WIDGET_STATE_KEY);
      else await this.kv.setItem(WIDGET_STATE_KEY, JSON.stringify(p));
    } catch {
      /* the widget just shows the sign-in prompt */
    }
  }

  /** Sign-out: nothing about the household or list stays behind for the widget. */
  async clear(): Promise<void> {
    try {
      await this.kv.removeItem(WIDGET_STATE_KEY);
    } catch {
      /* ignore */
    }
  }
}
