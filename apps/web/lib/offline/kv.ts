// A tiny async key-value store over IndexedDB for the offline PWA (P3-C, D446): the shopping queue and the last list snapshot.
// No library. Every method resolves (never throws) so a blocked or missing IndexedDB (private windows, odd embeds) degrades to
// "no offline copy" instead of breaking the page.

export interface KvStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
  /**
   * Atomic read-modify-write (one transaction): `fn` gets the current value and returns the new one, or null to delete it.
   * Two tabs saving the shopping queue never overwrite each other's commands (D446).
   */
  update<T = unknown>(key: string, fn: (current: T | undefined) => T | null): Promise<void>;
}

export const DB_NAME = 'fr-offline';
const STORE = 'kv';

const wrap = <T>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

/** IndexedDB-backed store, or null where IndexedDB does not exist. `factory` is the test seam (fake-indexeddb). */
export function idbKv(factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB, name = DB_NAME): KvStore | null {
  if (!factory) return null;
  let dbPromise: Promise<IDBDatabase> | null = null;
  const open = (): Promise<IDBDatabase> => {
    dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(name, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => { db.close(); dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('blocked'));
    });
    dbPromise.catch(() => { dbPromise = null; });
    return dbPromise;
  };
  const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await open();
    const t = db.transaction(STORE, mode);
    const done = new Promise<void>((resolve, reject) => {
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
    const r = await wrap(fn(t.objectStore(STORE)));
    if (mode === 'readwrite') await done;
    return r;
  };
  return {
    async get<T>(key: string) {
      try { return (await tx('readonly', (s) => s.get(key))) as T | undefined; } catch { return undefined; }
    },
    async set(key, value) {
      try { await tx('readwrite', (s) => s.put(value, key)); } catch { /* no offline copy */ }
    },
    async del(key) {
      try { await tx('readwrite', (s) => s.delete(key)); } catch { /* nothing to remove */ }
    },
    async update<T>(key: string, fn: (current: T | undefined) => T | null) {
      try {
        const db = await open();
        await new Promise<void>((resolve, reject) => {
          const t = db.transaction(STORE, 'readwrite');
          const store = t.objectStore(STORE);
          const get = store.get(key);
          get.onsuccess = () => {
            const next = fn(get.result as T | undefined);
            if (next === null) store.delete(key);
            else store.put(next, key);
          };
          t.oncomplete = () => resolve();
          t.onerror = () => reject(t.error);
          t.onabort = () => reject(t.error);
        });
      } catch { /* no offline copy */ }
    },
  };
}

export function memoryKv(): KvStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T,>(k: string) => data.get(k) as T | undefined,
    set: async (k, v) => { data.set(k, structuredClone(v)); },
    del: async (k) => { data.delete(k); },
    update: async <T,>(k: string, fn: (c: T | undefined) => T | null) => {
      const next = fn(data.get(k) as T | undefined);
      if (next === null) data.delete(k);
      else data.set(k, structuredClone(next));
    },
  };
}

/** Delete the whole database (sign-out). Resolves either way. */
export function deleteOfflineDb(factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB, name = DB_NAME): Promise<void> {
  if (!factory) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const r = factory.deleteDatabase(name);
      r.onsuccess = () => resolve();
      r.onerror = () => resolve();
      r.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}
