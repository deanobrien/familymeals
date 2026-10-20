'use client';

// "Shopping at <store>" state for the shopping page (AS1, D294-D296): the household's StoreBook, the store this member
// picked on this device, quick placement (optimistic, replayed when offline) and "learn from my route" (suggest only).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ItemView, PlacementTargetType, Store, StoreAisle, StoreBook, StoreSection } from '../../lib/shopping/engine';
import { normaliseItemKey, orderForStore, resolveAisle, sortedAisles, suggestRouteOrder } from '../../lib/shopping/engine';
import { applyPlacements, createStorePrefs, queuePlacement, type PendingPlacement, type StorePrefs } from '../../lib/shopping/store-prefs';
import { AISLES } from '../../lib/shopping/types';
import { addAisleAction, loadStoreBook, reorderAislesAction, setPlacementAction } from './store-actions';

export type PlaceScope = 'ingredient' | 'item' | 'category';

export interface PlaceTarget { type: PlacementTargetType; key: string }

/** The placement key for an item at the chosen scope (ingredient falls back to the item name when there is no ingredient link). */
export function targetFor(view: ItemView, scope: PlaceScope): PlaceTarget {
  const it = view.item;
  if (scope === 'category') return { type: 'category', key: it.category };
  if (scope === 'ingredient' && it.ingredientId) return { type: 'ingredient', key: it.ingredientId };
  return { type: 'item', key: normaliseItemKey(it.displayName) };
}

export interface StoreMode {
  book: StoreBook;
  /** The selected store, or null = group by category (the default). */
  store: Store | null;
  ready: boolean;
  select: (storeId: string | null) => void;
  sections: (views: ItemView[]) => Array<StoreSection<ItemView>>;
  aisleOf: (view: ItemView) => StoreAisle | null;
  aislesOfStore: StoreAisle[];
  place: (view: ItemView, aisleId: string | null, scope: PlaceScope) => Promise<void>;
  addAisle: (label: string) => Promise<string | null>;
  learn: boolean;
  setLearn: (on: boolean) => void;
  recordTick: (view: ItemView) => void;
  /** Aisle ids in the order the shopper walked them, when that differs from the saved order (needs confirmation). */
  suggestion: { order: string[]; labels: string[] } | null;
  applySuggestion: () => Promise<void>;
  dismissSuggestion: () => void;
  pendingCount: number;
}

export function useStoreMode(opts: {
  initialBook: StoreBook;
  householdId: string;
  userId: string;
  notify: (message: string, tone?: 'info' | 'error') => void;
  /** Test seam. */
  prefs?: StorePrefs;
}): StoreMode {
  const { initialBook, householdId, userId, notify } = opts;
  const prefs = useMemo(() => opts.prefs ?? createStorePrefs(householdId, userId), [opts.prefs, householdId, userId]);
  const [book, setBookState] = useState<StoreBook>(initialBook);
  const bookRef = useRef(book);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [learn, setLearnState] = useState(false);
  const [ticks, setTicks] = useState<string[]>([]);
  const [suggestion, setSuggestion] = useState<StoreMode['suggestion']>(null);
  const [pendingCount, setPendingCount] = useState(0);

  const setBook = useCallback((b: StoreBook) => {
    bookRef.current = b;
    setBookState(b);
    prefs.setBook(b);
  }, [prefs]);

  /** A fresh server book, with edits that have not reached the server yet laid over it. */
  const adopt = useCallback((fresh: StoreBook) => {
    const pending = prefs.getPending();
    setPendingCount(pending.length);
    setBook(pending.length ? applyPlacements(fresh, pending) : fresh);
  }, [prefs, setBook]);

  const flush = useCallback(async () => {
    let pending = prefs.getPending();
    while (pending.length > 0) {
      const p = pending[0]!;
      try {
        const r = await setPlacementAction(p.storeId, { targetType: p.targetType, targetKey: p.targetKey }, p.aisleId);
        pending = pending.slice(1); // accepted or refused: either way it must not be retried forever
        prefs.setPending(pending);
        if (r.ok) adopt(r.book);
      } catch {
        break; // still offline
      }
    }
    setPendingCount(prefs.getPending().length);
  }, [prefs, adopt]);

  // Mount: cache the server's book, restore this device's choices, replay anything queued offline.
  useEffect(() => {
    prefs.setBook(initialBook);
    const remembered = prefs.getStoreId();
    setStoreId(remembered && initialBook.stores.some((s) => s.id === remembered) ? remembered : null);
    setLearnState(prefs.getLearn());
    setPendingCount(prefs.getPending().length);
    setReady(true);
    void flush();
  }, []);

  // Other members' changes: refresh when the tab regains focus or the network returns.
  useEffect(() => {
    const refresh = async () => {
      try {
        await flush();
        const r = await loadStoreBook();
        if (r.ok) adopt(r.book);
      } catch { /* offline: keep what we have */ }
    };
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [flush, adopt]);

  // A remembered store that has since been deleted drops back to "no store".
  useEffect(() => {
    if (storeId && !book.stores.some((s) => s.id === storeId)) setStoreId(null);
  }, [book, storeId]);

  const store = useMemo(() => book.stores.find((s) => s.id === storeId) ?? null, [book, storeId]);
  const aislesOfStore = useMemo(() => (store ? sortedAisles(store.id, book.aisles) : []), [book, store]);

  const select = useCallback((id: string | null) => {
    setStoreId(id);
    prefs.setStoreId(id);
    setTicks([]);
    setSuggestion(null);
  }, [prefs]);

  const sections = useCallback(
    (views: ItemView[]) => (store ? orderForStore(views, store, book.aisles, book.placements, { categoryOrder: AISLES }) : []),
    [store, book],
  );
  const aisleOf = useCallback(
    (view: ItemView) => (store ? resolveAisle(view.item, store.id, book.aisles, book.placements) : null),
    [store, book],
  );

  const place = useCallback(async (view: ItemView, aisleId: string | null, scope: PlaceScope) => {
    if (!store) return;
    const t = targetFor(view, scope);
    const edit: PendingPlacement = { storeId: store.id, targetType: t.type, targetKey: t.key, aisleId };
    const before = bookRef.current;
    setBook(applyPlacements(before, [edit])); // optimistic: the list re-orders at once
    try {
      const r = await setPlacementAction(store.id, { targetType: t.type, targetKey: t.key }, aisleId);
      if (r.ok) adopt(r.book);
      else {
        setBook(before);
        notify(r.error, 'error');
      }
    } catch {
      prefs.setPending(queuePlacement(prefs.getPending(), edit));
      setPendingCount(prefs.getPending().length);
      notify('Saved on this device. It will sync when you are back online.');
    }
  }, [store, setBook, adopt, notify, prefs]);

  const addAisle = useCallback(async (label: string): Promise<string | null> => {
    if (!store) return null;
    try {
      const r = await addAisleAction(store.id, label);
      if (!r.ok) {
        notify(r.error, 'error');
        return null;
      }
      adopt(r.book);
      return r.id ?? null;
    } catch {
      notify('You need to be online to add an aisle.', 'error');
      return null;
    }
  }, [store, adopt, notify]);

  const setLearn = useCallback((on: boolean) => {
    setLearnState(on);
    prefs.setLearn(on);
    if (!on) {
      setTicks([]);
      setSuggestion(null);
    }
  }, [prefs]);

  const recordTick = useCallback((view: ItemView) => {
    if (!learn || !store) return;
    const aisle = resolveAisle(view.item, store.id, book.aisles, book.placements);
    if (!aisle) return;
    const next = [...ticks, aisle.id];
    setTicks(next);
    const current = sortedAisles(store.id, book.aisles).map((a) => a.id);
    const s = suggestRouteOrder(current, next.map((aisleId) => ({ aisleId })));
    const label = (id: string) => book.aisles.find((a) => a.id === id)?.label ?? '';
    setSuggestion(s.changed ? { order: s.order, labels: s.order.map(label) } : null);
  }, [learn, store, book, ticks]);

  const applySuggestion = useCallback(async () => {
    if (!store || !suggestion) return;
    const order = suggestion.order;
    setSuggestion(null);
    setTicks([]);
    try {
      const r = await reorderAislesAction(store.id, order);
      if (r.ok) {
        adopt(r.book);
        notify('Aisle order updated.');
      } else notify(r.error, 'error');
    } catch {
      notify('You need to be online to change the aisle order.', 'error');
    }
  }, [store, suggestion, adopt, notify]);

  const dismissSuggestion = useCallback(() => {
    setSuggestion(null);
    setTicks([]);
  }, []);

  return {
    book, store, ready, select, sections, aisleOf, aislesOfStore, place, addAisle, learn, setLearn, recordTick,
    suggestion, applySuggestion, dismissSuggestion, pendingCount,
  };
}
