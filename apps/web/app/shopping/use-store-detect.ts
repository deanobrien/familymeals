'use client';

// "Detect my store" on the shopping page (P2-A, D396). Browser Geolocation ONLY while this page is open: one reading on a
// button press, or (opt-in, off by default) a watch that stops when the page is closed or hidden. The position is compared
// with the stores' saved locations in the browser (pickNearbyStore) and never leaves it. There is no background detection
// on the web (a page cannot run when it is closed); the Android app does that, see DECISIONS D396.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeDistance, pickNearbyStore, type GeoFix } from '@fr/engine/shopping';
import type { StoreLocation } from '../../lib/stores/locations';
import { browserGeolocation, fencesOf, readPosition, watchPosition, GeolocationFailure, type GeolocationLike } from '../../lib/stores/location-client';
import type { StoreMode } from './use-store-mode';
import type { StorePrefs } from '../../lib/shopping/store-prefs';

export interface StoreDetect {
  /** Stores with a saved location (detection needs at least one). */
  fenceCount: number;
  detecting: boolean;
  auto: boolean;
  setAuto: (on: boolean) => void;
  detectNow: () => Promise<void>;
  message: string | null;
}

export function useStoreDetect(opts: {
  mode: StoreMode;
  locations: readonly StoreLocation[];
  prefs: StorePrefs;
  notify: (message: string, tone?: 'info' | 'error') => void;
  /** Test seam. */
  geo?: GeolocationLike | null;
}): StoreDetect {
  const { mode, locations, prefs, notify } = opts;
  const fences = useMemo(() => fencesOf(mode.book.stores, locations), [mode.book.stores, locations]);
  const [detecting, setDetecting] = useState(false);
  const [auto, setAutoState] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const storeRef = useRef<string | null>(null);
  storeRef.current = mode.store?.id ?? null;
  const fencesRef = useRef(fences);
  fencesRef.current = fences;
  const geo = opts.geo === undefined ? browserGeolocation() : opts.geo;

  useEffect(() => setAutoState(prefs.getAutoDetect()), [prefs]);

  const apply = useCallback((fix: GeoFix, announce: boolean) => {
    const hit = pickNearbyStore(fix, fencesRef.current, { currentStoreId: storeRef.current });
    if (!hit) {
      if (announce) setMessage('No saved store is near you. Check the store locations in Settings.');
      return;
    }
    if (hit.storeId !== storeRef.current) {
      mode.select(hit.storeId);
      notify(`Shopping at ${hit.name} (about ${describeDistance(hit.distanceM)} away).`);
    }
    setMessage(`You are at ${hit.name}.`);
  }, [mode, notify]);

  const detectNow = useCallback(async () => {
    if (fencesRef.current.length === 0) {
      setMessage('None of your stores has a location yet. Add one in Settings, Stores.');
      return;
    }
    setDetecting(true);
    setMessage(null);
    try {
      apply(await readPosition(geo), true);
    } catch (e) {
      setMessage(e instanceof GeolocationFailure ? e.message : 'Could not find your position.');
    } finally {
      setDetecting(false);
    }
  }, [apply, geo]);

  const setAuto = useCallback((on: boolean) => {
    setAutoState(on);
    prefs.setAutoDetect(on);
    if (!on) setMessage(null);
  }, [prefs]);

  // Opt-in watch, only while the page is open and visible.
  const hasFences = fences.length > 0;
  useEffect(() => {
    if (!auto || !hasFences) return;
    let stop: (() => void) | null = null;
    const start = () => {
      if (stop) return;
      stop = watchPosition(geo, (fix) => apply(fix, false), (f) => {
        setMessage(f.message);
        if (f.reason === 'denied') {
          setAutoState(false);
          prefs.setAutoDetect(false);
        }
      });
    };
    const halt = () => {
      stop?.();
      stop = null;
    };
    const onVis = () => (document.visibilityState === 'visible' ? start() : halt());
    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      halt();
    };
  }, [auto, hasFences, geo, apply, prefs]);

  return { fenceCount: fences.length, detecting, auto, setAuto, detectNow, message };
}
