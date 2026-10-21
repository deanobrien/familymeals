import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import { pickNearbyStore, type StoreFence } from '@fr/engine/shopping';
import { loadFences, loadGeoState, syncGeofencing, takePendingArrival } from './geofence';

/**
 * "Shopping at" follows where the phone is (P2-A, D392), only when the member turned location switching on:
 *  - applies a store the background geofence recorded while the app was closed (once, if recent), and
 *  - while the app is open on this screen, watches the position and compares it with the saved store spots ON THE DEVICE.
 * Nothing about the position is sent anywhere. Never prompts for permission (that happens in Settings, Location).
 */
export function useStoreArrival(opts: { householdId: string | null; storeId: string | null; onArrive: (storeId: string, name: string) => void; fresh?: () => Promise<StoreFence[]> }): void {
  const { householdId } = opts;
  const current = useRef(opts.storeId);
  current.current = opts.storeId;
  const arrive = useRef(opts.onArrive);
  arrive.current = opts.onArrive;

  useEffect(() => {
    if (!householdId) return undefined;
    let cancelled = false;
    let sub: { remove(): void } | null = null;
    let fences: StoreFence[] = [];

    const stop = () => {
      sub?.remove();
      sub = null;
    };
    const start = async () => {
      if (sub) return;
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted' || cancelled) return;
        const s = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 25, timeInterval: 20_000 },
          (loc) => {
            const hit = pickNearbyStore(
              { lat: loc.coords.latitude, lng: loc.coords.longitude, accuracyM: loc.coords.accuracy ?? undefined },
              fences,
              { currentStoreId: current.current },
            );
            if (hit && hit.storeId !== current.current) arrive.current(hit.storeId, hit.name);
          },
        );
        if (cancelled) s.remove();
        else sub = s;
      } catch {
        /* location unavailable: the store picker still works by hand */
      }
    };

    void (async () => {
      const state = await loadGeoState();
      if (cancelled || state.mode === 'off' || state.householdId !== householdId) return;
      fences = await loadFences();
      if (opts.fresh) {
        try {
          // other members may have changed the saved spots (web or phone): re-register what the OS watches
          fences = await opts.fresh();
          await syncGeofencing(fences, state.mode);
        } catch {
          /* offline: keep the spots saved on this phone */
        }
      }
      const pending = await takePendingArrival();
      const fence = pending ? fences.find((f) => f.storeId === pending.storeId) : undefined;
      if (pending && fence && pending.storeId !== current.current) arrive.current(fence.storeId, fence.name);
      await start();
    })();

    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') void start();
      else stop();
    });
    return () => {
      cancelled = true;
      appState.remove();
      stop();
    };
  }, [householdId]);
}
