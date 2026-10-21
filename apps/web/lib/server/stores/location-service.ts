// The store-location operations behind /api/stores/locations (P2-A, D390-D392), shared by the web UI and the Android app.
// Pure of HTTP: takes the repositories, returns a result. The route does auth, the read-only refusal and the envelope.
import { LocationInput, type StoreLocation } from '../../stores/locations';
import { Id } from '../../stores/schema';
import type { Store } from '../../shopping/engine';
import type { StoreLocationRepository } from './locations';
import { StoreBookError, type StoreBookRepository } from './repository';

export interface LocationsView {
  stores: Store[];
  locations: StoreLocation[];
}

export type LocationResult = ({ ok: true } & LocationsView) | { ok: false; status: number; code: string; message: string };

export async function viewLocations(book: StoreBookRepository, locs: StoreLocationRepository, householdId: string): Promise<LocationsView> {
  const [b, locations] = await Promise.all([book.book(householdId), locs.list(householdId)]);
  const ids = new Set(b.stores.map((s) => s.id));
  return { stores: b.stores, locations: locations.filter((l) => ids.has(l.storeId)) };
}

/** `{ storeId, action: 'set' | 'clear', lat, lng, radiusM?, source, postcode? }` */
export async function applyLocationChange(
  book: StoreBookRepository,
  locs: StoreLocationRepository,
  householdId: string,
  body: Record<string, unknown>,
): Promise<LocationResult> {
  const id = Id.safeParse(body.storeId);
  if (!id.success) return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'Unknown store.' };
  try {
    if (body.action === 'clear') {
      await locs.clear(householdId, id.data);
    } else if (body.action === 'set') {
      const v = LocationInput.safeParse(body);
      if (!v.success) return { ok: false, status: 400, code: 'BAD_REQUEST', message: v.error.issues[0]?.message ?? 'Check the location.' };
      await locs.set(householdId, id.data, v.data);
    } else {
      return { ok: false, status: 400, code: 'BAD_REQUEST', message: 'Say whether to set or clear the location.' };
    }
  } catch (e) {
    if (e instanceof StoreBookError || (e instanceof Error && e.name === 'StoreBookError')) {
      return { ok: false, status: 404, code: 'NOT_FOUND', message: 'That store was not found.' };
    }
    throw e;
  }
  return { ok: true, ...(await viewLocations(book, locs, householdId)) };
}
