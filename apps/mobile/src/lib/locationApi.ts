/**
 * Client + defensive parsers for store locations and voice add (apps/web `/api/stores/locations`, `/api/stores/geocode`,
 * `/api/shopping/voice/parse`, `/api/shopping/scan/confirm`; P2-A, D390-D395). The server owns validation, the postcode
 * lookup and the parsing; the phone sends only the location the member SAVES for a store, never a live position.
 * Types are app-side copies of the contract in apps/web/lib/stores/locations.ts (never imported from the web app).
 */
import type { StoreFence } from '@fr/engine/shopping';
import { isValidPoint } from '@fr/engine/shopping';
import type { ServerApi } from './serverApi';

export interface StoreLocation {
  storeId: string;
  lat: number;
  lng: number;
  radiusM: number;
  source: 'device' | 'postcode';
  postcode: string | null;
}
export interface LocStore { id: string; name: string; chain: string | null }
export interface LocationsView { stores: LocStore[]; locations: StoreLocation[] }
export interface Geocoded { postcode: string; lat: number; lng: number; area: string | null; attribution: string }

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : d);

export function parseLocations(v: unknown): LocationsView {
  const o = isObj(v) ? v : {};
  const stores = arr(o.stores).filter(isObj).filter((s) => s.id && s.name).map((s) => ({ id: str(s.id), name: str(s.name), chain: typeof s.chain === 'string' ? s.chain : null }));
  const locations = arr(o.locations).filter(isObj).flatMap((l): StoreLocation[] => {
    const lat = Number(l.lat);
    const lng = Number(l.lng);
    if (!l.storeId || !isValidPoint({ lat, lng })) return [];
    return [{ storeId: str(l.storeId), lat, lng, radiusM: Number(l.radiusM) || 150, source: l.source === 'postcode' ? 'postcode' : 'device', postcode: typeof l.postcode === 'string' ? l.postcode : null }];
  });
  return { stores, locations };
}

export async function getLocations(api: ServerApi, householdId: string): Promise<LocationsView> {
  return parseLocations(await api.get('/api/stores/locations', { householdId }));
}

export type LocationChange =
  | { storeId: string; action: 'clear' }
  | { storeId: string; action: 'set'; lat: number; lng: number; radiusM?: number; source: 'device' }
  | { storeId: string; action: 'set'; lat: number; lng: number; radiusM?: number; source: 'postcode'; postcode: string };

export async function changeLocation(api: ServerApi, householdId: string, change: LocationChange): Promise<LocationsView> {
  return parseLocations(await api.post('/api/stores/locations', { householdId, ...change }));
}

export async function geocode(api: ServerApi, householdId: string, postcode: string): Promise<Geocoded> {
  const r = await api.get<unknown>('/api/stores/geocode', { householdId, postcode });
  const o = isObj(r) ? r : {};
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  if (!isValidPoint({ lat, lng })) throw new Error('The postcode lookup returned something unexpected.');
  return { postcode: str(o.postcode, postcode), lat, lng, area: typeof o.area === 'string' ? o.area : null, attribution: str(o.attribution) };
}

/** Stores with a saved location, as the on-device detection wants them. */
export function fencesOf(view: LocationsView): StoreFence[] {
  const byId = new Map(view.stores.map((s) => [s.id, s]));
  return view.locations.filter((l) => byId.has(l.storeId)).map((l) => ({ storeId: l.storeId, name: byId.get(l.storeId)!.name, lat: l.lat, lng: l.lng, radiusM: l.radiusM }));
}

/* ---------------------------------------------------------------- voice add */

export const VOICE_UNITS = ['item', 'g', 'kg', 'ml', 'l', 'tsp', 'tbsp', 'pint', 'can', 'pack', 'bunch', 'clove', 'slice', 'sprig', 'stick'] as const;
const UNIT_LABEL: Record<string, string> = { item: '', g: 'g', kg: 'kg', ml: 'ml', l: 'l', tsp: 'tsp', tbsp: 'tbsp', pint: 'pint', can: 'tin', pack: 'pack', bunch: 'bunch', clove: 'clove', slice: 'slice', sprig: 'sprig', stick: 'stick' };

export interface VoiceRow { key: string; text: string; name: string; ingredientId?: string; value?: number; unit?: string; notes?: string; aisle: string }

export function parseVoiceRows(v: unknown): VoiceRow[] {
  const rows = isObj(v) ? arr(v.rows) : [];
  return rows.filter(isObj).flatMap((r): VoiceRow[] => {
    const name = str(r.name).trim();
    const key = str(r.key);
    if (!name || !key) return [];
    const value = typeof r.value === 'number' && Number.isFinite(r.value) && r.value > 0 ? r.value : undefined;
    const unit = typeof r.unit === 'string' && (VOICE_UNITS as readonly string[]).includes(r.unit) ? r.unit : undefined;
    return [{
      key, text: str(r.text, name), name, aisle: str(r.aisle, 'Other'),
      ...(typeof r.ingredientId === 'string' ? { ingredientId: r.ingredientId } : {}),
      ...(value !== undefined && unit ? { value, unit } : {}),
      ...(typeof r.notes === 'string' && r.notes ? { notes: r.notes } : {}),
    }];
  });
}

export async function parseTranscript(api: ServerApi, householdId: string, transcript: string): Promise<VoiceRow[]> {
  return parseVoiceRows(await api.post('/api/shopping/voice/parse', { householdId, transcript }));
}

export const newBatchId = (): string => `voice-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`.slice(0, 64);

export async function addVoiceRows(api: ServerApi, householdId: string, rows: readonly VoiceRow[], batchId: string): Promise<{ message: string; added: number; merged: number }> {
  const commit = rows.map((r) => ({
    key: r.key, name: r.name, aisle: r.aisle,
    ...(r.ingredientId ? { ingredientId: r.ingredientId } : {}),
    ...(r.value !== undefined && r.unit ? { value: r.value, unit: r.unit } : {}),
    ...(r.notes ? { notes: r.notes } : {}),
  }));
  const r = await api.post<unknown>('/api/shopping/scan/confirm', { householdId, rows: commit, destination: { kind: 'current' }, batchId });
  const o = isObj(r) ? r : {};
  return { message: str(o.message), added: Number(o.added) || 0, merged: Number(o.merged) || 0 };
}

export function chipLabel(r: VoiceRow): string {
  if (r.value === undefined || !r.unit) return r.name;
  return `${r.value}${UNIT_LABEL[r.unit] ? ` ${UNIT_LABEL[r.unit]}` : ''} ${r.name}`.replace(/\s+/g, ' ').trim();
}
