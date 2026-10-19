import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Uuid } from '@fr/domain';
import { netInfoConnectivity, type Connectivity } from '@/lib/connectivity';
import type { DataSource } from './DataSource';
import { createDataSource } from './createDataSource';

interface AppState {
  ds: DataSource;
  householdId: Uuid | null;
  setHouseholdId: (id: Uuid | null) => void;
  /** NetInfo connectivity (true until proven otherwise). */
  online: boolean;
  /** Increments after a reconnect replay finished: screens re-read the list and drain conflicts. */
  syncVersion: number;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({
  dataSource,
  connectivity,
  children,
}: {
  dataSource?: DataSource;
  connectivity?: Connectivity;
  children: React.ReactNode;
}) {
  // Supabase when EXPO_PUBLIC_SUPABASE_URL is set, otherwise the mock (see createDataSource).
  const ds = useMemo(() => dataSource ?? createDataSource(), [dataSource]);
  const net = connectivity ?? netInfoConnectivity;
  const [householdId, setHouseholdId] = useState<Uuid | null>(null);
  const [online, setOnline] = useState(true);
  const [syncVersion, setSyncVersion] = useState(0);
  const wasOnline = useRef(true);

  useEffect(() => {
    const unsubscribe = net.subscribe((isOnline) => {
      ds.setOnline?.(isOnline);
      setOnline(isOnline);
      // Replay the persisted queue the moment we are back (the engine/server make resends idempotent).
      if (isOnline && !wasOnline.current) {
        ds.flushPending()
          .catch(() => 0)
          .then(() => setSyncVersion((v) => v + 1));
      }
      wasOnline.current = isOnline;
    });
    return unsubscribe;
  }, [ds, net]);

  const value = useMemo(
    () => ({ ds, householdId, setHouseholdId, online, syncVersion }),
    [ds, householdId, online, syncVersion],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}
