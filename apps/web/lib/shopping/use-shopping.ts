'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import {
  ShoppingController, getActorId, localStoragePendingStore, newUuid,
  type ControllerState, type Notice, type Transport,
} from './controller';
import type { SnapshotDto } from './types';

export const PENDING_KEY = 'fr.shopping.pending.v1';

/** Create a controller once per mount, start polling/replay after hydration, expose its state. */
export function useShopping(
  initial: SnapshotDto,
  transport: Transport,
  onNotice: (n: Notice) => void,
): { controller: ShoppingController; state: ControllerState; actor: () => string } {
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;

  const ref = useRef<ShoppingController | null>(null);
  if (!ref.current) {
    ref.current = new ShoppingController(initial, {
      transport,
      store: localStoragePendingStore(PENDING_KEY),
      actor: () => getActorId(newUuid),
      newId: newUuid,
      onNotice: (n) => noticeRef.current(n),
    });
  }
  const controller = ref.current;

  useEffect(() => controller.start(), [controller]);

  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  return { controller, state, actor: () => getActorId(newUuid) };
}
