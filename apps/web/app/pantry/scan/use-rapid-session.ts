'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createLookupTracker, decrement, emptyRapid, fromSnapshot, increment, removeItem, sight, toSnapshot, undo,
  type LookupState, type LookupTracker, type RapidItem, type RapidState, type SightingResult,
} from '@fr/engine/pantry';
import { postBatch } from '../../../lib/products/client';
import type { ProductLookupDto } from '../../../lib/products/types';

/** Survives an accidental refresh or back-swipe within the tab; gone when the tab closes. Only the tally, never product data. */
export const RAPID_STORAGE_KEY = 'fr.rapidscan.v1';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function storage(): Store | null {
  try { return typeof window === 'undefined' ? null : window.sessionStorage; } catch { return null; }
}

export interface RapidSession {
  state: RapidState;
  lookups: ReadonlyMap<string, LookupState<ProductLookupDto>>;
  /** True once the tally was restored from sessionStorage (shown as a notice). */
  restored: boolean;
  /** A read from the camera or typed digits: returns whether it was counted. */
  sight(code: string, now: number): SightingResult;
  plus(code: string): void;
  minus(code: string): void;
  remove(code: string): void;
  undo(): void;
  retry(code: string): void;
  clear(): void;
}

/**
 * The continuous-scan session (BS1): the tally (debounce / undo logic in @fr/engine), the lookup tracker that resolves
 * each distinct code in the background through POST /api/products, and sessionStorage persistence. It lives in ScanFlow, not
 * in the camera component, so lookups keep resolving while the owner reviews, and the tally survives leaving the camera.
 */
export function useRapidSession(seed: readonly RapidItem[] = []): RapidSession {
  const [state, setState] = useState<RapidState>(emptyRapid);
  const [lookups, setLookups] = useState<ReadonlyMap<string, LookupState<ProductLookupDto>>>(new Map());
  const [restored, setRestored] = useState(false);
  const ref = useRef<RapidState>(state);
  const tracker = useRef<LookupTracker<ProductLookupDto> | null>(null);
  const hydrated = useRef(false);

  const getTracker = useCallback((): LookupTracker<ProductLookupDto> => {
    tracker.current ??= createLookupTracker<ProductLookupDto>({ post: postBatch, onChange: setLookups });
    return tracker.current;
  }, []);

  const commit = useCallback((next: RapidState) => {
    ref.current = next;
    setState(next);
    for (const i of next.items) getTracker().request(i.barcode);
    const s = storage();
    try {
      if (!s) return;
      if (next.items.length === 0) s.removeItem(RAPID_STORAGE_KEY);
      else s.setItem(RAPID_STORAGE_KEY, JSON.stringify(toSnapshot(next)));
    } catch { /* storage full or blocked: scanning still works */ }
  }, [getTracker]);

  // Restore after mount (not in the initial state: the server render and first client render must agree).
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      if (seed.length > 0) {
        // Handed over from the Android app (?codes=): that tally is the session.
        commit({ ...emptyRapid(), items: seed.map((i) => ({ ...i })) });
      } else try {
        const raw = storage()?.getItem(RAPID_STORAGE_KEY);
        if (raw) {
          const restoredState = fromSnapshot(JSON.parse(raw) as unknown);
          if (restoredState.items.length > 0) { commit(restoredState); setRestored(true); }
        }
      } catch { /* unreadable: start empty */ }
    }
    // Also re-asks after React's dev-mode effect re-run stopped the tracker (idempotent for codes already asked).
    for (const i of ref.current.items) getTracker().request(i.barcode);
    return () => { tracker.current?.stop(); tracker.current = null; };
    // seed is read once, on mount
  }, [commit, getTracker]);

  return {
    state, lookups, restored,
    sight(code, now) {
      const r = sight(ref.current, code, now);
      // `seen` changes on every frame: keep it in the ref, and only re-render / persist when the tally changed.
      if (r.counted || r.state.items !== ref.current.items) commit(r.state);
      else ref.current = r.state;
      return r;
    },
    plus: (code) => commit(increment(ref.current, code)),
    minus: (code) => commit(decrement(ref.current, code)),
    remove: (code) => commit(removeItem(ref.current, code)),
    undo: () => commit(undo(ref.current)),
    retry: (code) => getTracker().retry(code),
    clear() {
      commit(emptyRapid());
      setRestored(false);
    },
  };
}
