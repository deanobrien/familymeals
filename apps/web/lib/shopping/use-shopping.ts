'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  ShoppingController, localStoragePendingStore, newUuid,
  type ControllerState, type Notice, type Transport,
} from './controller';
import type { LiveFeed } from './live';
import { idbKv } from '../offline/kv';
import { OfflineShoppingStore } from '../offline/shopping-store';
import type { SnapshotDto } from './types';

export const PENDING_KEY = 'fr.shopping.pending.v1';

/**
 * The device-side queue and list snapshot (P3-C, D446): IndexedDB bound to the signed-in user, with the old localStorage queue
 * migrated in. Where IndexedDB does not exist (some private windows), the localStorage queue is used as before.
 */
function offlineStore(actorId: string): OfflineShoppingStore | null {
  const kv = typeof window === 'undefined' ? null : idbKv();
  if (!kv) return null;
  let legacy: Storage | null = null;
  try { legacy = window.localStorage; } catch { /* blocked */ }
  return new OfflineShoppingStore(kv, actorId, legacy);
}

/** `actorId` = the signed-in member (server household context). Create a controller once per mount, start polling/replay after hydration, expose its state. */
export function useShopping(
  initial: SnapshotDto,
  transport: Transport,
  onNotice: (n: Notice) => void,
  actorId: string,
  /** Supabase Realtime feed (D122); omit to poll (mock mode). Read once, on first render. */
  live?: LiveFeed,
): { controller: ShoppingController; state: ControllerState; actor: () => string } {
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;

  const ref = useRef<ShoppingController | null>(null);
  if (!ref.current) {
    const offline = offlineStore(actorId);
    ref.current = new ShoppingController(initial, {
      transport,
      store: offline ?? localStoragePendingStore(PENDING_KEY),
      ...(offline ? { snapshots: offline.snapshots } : {}),
      actor: () => actorId,
      newId: newUuid,
      onNotice: (n) => noticeRef.current(n),
      ...(live ? { live } : {}),
    });
  }
  const controller = ref.current;

  useEffect(() => controller.start(), [controller]);

  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return { controller, state, actor: () => actorId };
}
