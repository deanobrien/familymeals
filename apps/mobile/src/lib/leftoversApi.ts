// Client for the leftovers / freezer JSON API (apps/web /api/leftovers, P2-C D416-D419) plus the defensive parsers for the busy
// flags and leftover views the planner page carries. Unknown parts are dropped, malformed ones fall back to safe defaults.
import { MEAL_TYPES, type BatchView, type BusyApplied, type BusyDay, type LeftoverSuggestion, type LeftoversView, type MealType } from './plan/types';
import type { ServerApi } from './serverApi';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');
const objs = (v: unknown): Obj[] => arr(v).filter(isObj);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseBusyDays(v: unknown): BusyDay[] {
  return objs(v)
    .filter((d) => DATE.test(str(d.date)))
    .map((d) => ({
      date: str(d.date), sources: strs(d.sources), minutesAvailable: num(d.minutesAvailable) ?? null, skip: d.skip === true,
      label: str(d.label, d.skip === true ? 'Dinner skipped' : 'Busy'),
    }));
}

export function parseBusyApplied(v: unknown): BusyApplied[] {
  return objs(v)
    .filter((d) => DATE.test(str(d.date)))
    .map((d) => ({ date: str(d.date), skip: d.skip === true, minutesAvailable: num(d.minutesAvailable) ?? null, sources: strs(d.sources) }));
}

function parseBatch(b: Obj): BatchView | null {
  const made = num(b.portionsMade);
  const left = num(b.portionsLeft);
  if (typeof b.id !== 'string' || typeof b.title !== 'string' || made === undefined || left === undefined || !DATE.test(str(b.useBy))) return null;
  const status = b.status === 'past_use_by' || b.status === 'use_soon' ? b.status : 'ok';
  return {
    id: b.id, title: b.title, storedIn: b.storedIn === 'freezer' ? 'freezer' : 'fridge', portionsMade: made, portionsLeft: left,
    portionsPlanned: num(b.portionsPlanned) ?? 0, portionsFree: num(b.portionsFree) ?? left, cookedOn: str(b.cookedOn), useBy: str(b.useBy), status,
    useByLabel: str(b.useByLabel, `Use by ${str(b.useBy)}`),
  };
}

export function parseLeftoversView(v: unknown): LeftoversView {
  const o = isObj(v) ? v : {};
  const suggestions: LeftoverSuggestion[] = objs(o.suggestions).flatMap((s) => {
    const mt = MEAL_TYPES.find((m) => m === s.mealType) as MealType | undefined;
    const portions = num(s.portions);
    if (typeof s.batchId !== 'string' || !mt || portions === undefined || !DATE.test(str(s.date))) return [];
    return [{ batchId: s.batchId, title: str(s.title), storedIn: s.storedIn === 'freezer' ? ('freezer' as const) : ('fridge' as const), portions, date: str(s.date), mealType: mt, label: str(s.label, str(s.title)), reason: str(s.reason) }];
  });
  const titles: Record<string, string> = {};
  if (isObj(o.titles)) for (const [k, t] of Object.entries(o.titles)) if (typeof t === 'string') titles[k] = t;
  return { batches: objs(o.batches).map(parseBatch).filter((b): b is BatchView => !!b), suggestions, titles };
}

export interface LeftoversClient {
  list(week?: string, today?: string): Promise<LeftoversView>;
  add(input: { title: string; portions: number; storedIn: 'fridge' | 'freezer'; today?: string }): Promise<void>;
  /** A client key makes a retried tap one event. */
  eat(batchId: string, portions: number, key?: string): Promise<number>;
  discard(batchId: string, portions: number, key?: string): Promise<number>;
  freeze(batchId: string, today?: string): Promise<void>;
  remove(batchId: string): Promise<void>;
}

const left = (body: unknown): number => Math.max(0, Math.floor(num(isObj(body) ? body.portionsLeft : undefined) ?? 0));

export function createLeftoversClient(api: ServerApi, householdId: string): LeftoversClient {
  return {
    list: async (week, today) => {
      const body = await api.get<unknown>('/api/leftovers', { householdId, ...(week ? { week } : {}), ...(today ? { today } : {}) });
      return parseLeftoversView(isObj(body) ? body.leftovers : null);
    },
    add: async (input) => {
      await api.post('/api/leftovers', { householdId, action: 'add', ...input });
    },
    eat: async (batchId, portions, key) => left(await api.post('/api/leftovers', { householdId, action: 'eat', batchId, portions, ...(key ? { key } : {}) })),
    discard: async (batchId, portions, key) => left(await api.post('/api/leftovers', { householdId, action: 'discard', batchId, portions, ...(key ? { key } : {}) })),
    freeze: async (batchId, today) => {
      await api.post('/api/leftovers', { householdId, action: 'freeze', batchId, ...(today ? { today } : {}) });
    },
    remove: async (batchId) => {
      await api.post('/api/leftovers', { householdId, action: 'remove', batchId });
    },
  };
}

/** The phone's own date (YYYY-MM-DD): a late-evening cook is dated by the cook's clock. */
export function localToday(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
