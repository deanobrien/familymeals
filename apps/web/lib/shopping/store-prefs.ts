// Per-device state for "shopping at a store" (AS1, D294-D296), kept in localStorage so it works offline once loaded:
//   * which store this member last chose on this device (null = group by category),
//   * the cached StoreBook (so the aisle order is available without the server),
//   * placement edits made while the server could not be reached (replayed later, last write wins per target),
//   * the "learn from my route" toggle.
// Every access is wrapped: storage can be missing or throw (private windows, blocked site data).
import type { PlacementTargetType, StoreBook } from './engine';
import { emptyStoreBook } from './engine';

export interface PendingPlacement {
  storeId: string;
  targetType: PlacementTargetType;
  targetKey: string;
  /** null clears the placement. */
  aisleId: string | null;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const browserStorage = (): StorageLike | null => {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
};

const k = (kind: string, householdId: string, userId = ''): string => `fr.shopping.${kind}:${householdId}${userId ? `:${userId}` : ''}`;

function read<T>(store: StorageLike | null, key: string, fallback: T): T {
  try {
    const raw = store?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(store: StorageLike | null, key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) store?.removeItem(key);
    else store?.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / blocked: the app still works, it just forgets */
  }
}

export function createStorePrefs(householdId: string, userId: string, storage: StorageLike | null = browserStorage()) {
  return {
    /** The remembered store id for this member on this device ('' / null = none). */
    getStoreId: (): string | null => read<string | null>(storage, k('store', householdId, userId), null) || null,
    setStoreId: (id: string | null): void => write(storage, k('store', householdId, userId), id || null),

    getBook: (): StoreBook | null => {
      const b = read<StoreBook | null>(storage, k('storebook', householdId), null);
      return b && Array.isArray(b.stores) && Array.isArray(b.aisles) && Array.isArray(b.placements) ? b : null;
    },
    setBook: (book: StoreBook): void => write(storage, k('storebook', householdId), book),

    getPending: (): PendingPlacement[] => {
      const p = read<PendingPlacement[]>(storage, k('pendingplacements', householdId), []);
      return Array.isArray(p) ? p : [];
    },
    setPending: (p: PendingPlacement[]): void => write(storage, k('pendingplacements', householdId), p.length ? p : null),

    getLearn: (): boolean => read<boolean>(storage, k('learnroute', householdId, userId), false) === true,
    setLearn: (on: boolean): void => write(storage, k('learnroute', householdId, userId), on ? true : null),

    /** "Detect my store automatically while this page is open" (P2-A, D396). Off by default, per member per device. */
    getAutoDetect: (): boolean => read<boolean>(storage, k('autodetect', householdId, userId), false) === true,
    setAutoDetect: (on: boolean): void => write(storage, k('autodetect', householdId, userId), on ? true : null),
  };
}
export type StorePrefs = ReturnType<typeof createStorePrefs>;

/** Replace the pending edit for the same target (last write wins), then append. */
export function queuePlacement(pending: readonly PendingPlacement[], p: PendingPlacement): PendingPlacement[] {
  return [...pending.filter((x) => !(x.storeId === p.storeId && x.targetType === p.targetType && x.targetKey === p.targetKey)), p];
}

/** Apply placement edits to a book (optimistic local view; also re-applied over a fresh server book). */
export function applyPlacements(book: StoreBook, edits: readonly PendingPlacement[]): StoreBook {
  let placements = [...book.placements];
  for (const e of edits) {
    placements = placements.filter((x) => !(x.storeId === e.storeId && x.targetType === e.targetType && x.targetKey === e.targetKey));
    if (e.aisleId && book.aisles.some((a) => a.id === e.aisleId && a.storeId === e.storeId)) {
      placements.push({ storeId: e.storeId, targetType: e.targetType, targetKey: e.targetKey, aisleId: e.aisleId });
    }
  }
  return { ...book, placements };
}

export { emptyStoreBook };
