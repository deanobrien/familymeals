import { useCallback, useEffect, useRef, useState } from 'react';
import { createLookupTracker, emptyRapid, type LookupState, type LookupTracker, type RapidState } from '@fr/engine/pantry';
import type { ProductClient, ProductSummary } from '@/lib/productApi';

export interface RapidSession {
  state: RapidState;
  /** Always the latest tally (camera callbacks read this, not the render copy). */
  ref: { current: RapidState };
  lookups: ReadonlyMap<string, LookupState<ProductSummary>>;
  /** A counted change: store it and look up any new code in the background. */
  commit(next: RapidState): void;
  /** `seen` bookkeeping only (a repeat read that was not counted): no re-render. */
  note(next: RapidState): void;
  retry(code: string): void;
  clear(): void;
}

/**
 * The continuous-scan session (BS1, D344): the tally (debounce / undo in @fr/engine/pantry, unchanged) and the lookup
 * tracker that resolves codes through POST /api/products. Owned by the pantry scan screen, not the camera view, so
 * lookups keep resolving while the owner reviews (like the web's use-rapid-session). The tracker stops on unmount.
 */
export function useRapidSession(client: ProductClient, householdId: string): RapidSession {
  const [state, setState] = useState<RapidState>(emptyRapid);
  const [lookups, setLookups] = useState<ReadonlyMap<string, LookupState<ProductSummary>>>(new Map());
  const ref = useRef<RapidState>(state);
  const tracker = useRef<LookupTracker<ProductSummary> | null>(null);

  const getTracker = useCallback(() => {
    tracker.current ??= createLookupTracker<ProductSummary>({
      post: (req) => client.lookupBatch(householdId, req),
      onChange: setLookups,
    });
    return tracker.current;
  }, [client, householdId]);

  useEffect(() => () => { tracker.current?.stop(); tracker.current = null; }, []);

  const commit = useCallback((next: RapidState) => {
    ref.current = next;
    setState(next);
    for (const i of next.items) getTracker().request(i.barcode);
  }, [getTracker]);

  const note = useCallback((next: RapidState) => { ref.current = next; }, []);
  const retry = useCallback((code: string) => getTracker().retry(code), [getTracker]);
  const clear = useCallback(() => {
    tracker.current?.stop();
    tracker.current = null;
    ref.current = emptyRapid();
    setState(ref.current);
    setLookups(new Map());
  }, []);

  return { state, ref, lookups, commit, note, retry, clear };
}
