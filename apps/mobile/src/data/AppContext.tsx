import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Uuid } from '@fr/domain';
import { netInfoConnectivity, type Connectivity } from '@/lib/connectivity';
import type { DataSource } from './DataSource';
import { createDataSource } from './createDataSource';
import { createMockRecipesApi } from '@/lib/mockRecipesApi';
import { createRecipesApi, type RecipesApi } from '@/lib/recipesApi';
import { isSupabaseConfigured } from '@/lib/supabase';
import { registerActiveSource, setWidgetHousehold } from '@/widget/widgetBridge';

interface AppState {
  ds: DataSource;
  /** Recipes, ingredient catalogue and discover: the web app's bearer JSON routes (D330), or an in-memory demo (no env). */
  recipes: RecipesApi;
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
  recipesApi,
  connectivity,
  children,
}: {
  dataSource?: DataSource;
  recipesApi?: RecipesApi;
  connectivity?: Connectivity;
  children: React.ReactNode;
}) {
  // Supabase when EXPO_PUBLIC_SUPABASE_URL is set, otherwise the mock (see createDataSource).
  const ds = useMemo(() => dataSource ?? createDataSource(), [dataSource]);
  // No Supabase env (or an injected data source, i.e. tests): the in-memory demo; otherwise the web app's JSON routes.
  const recipes = useMemo(
    () =>
      recipesApi ??
      (dataSource || !isSupabaseConfigured()
        ? createMockRecipesApi()
        : createRecipesApi({ baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL, getToken: () => ds.getAccessToken() })),
    [recipesApi, ds, dataSource],
  );
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

  // Home-screen widget (P3-C, D441): while the app runs, the widget shares THIS data source (one queue, no racing writers);
  // it also learns which household is on screen, and redraws after every household change / reconnect replay.
  useEffect(() => {
    registerActiveSource(ds);
    return () => registerActiveSource(null);
  }, [ds]);
  useEffect(() => {
    if (householdId) void setWidgetHousehold(householdId);
  }, [householdId, syncVersion]);

  const value = useMemo(
    () => ({ ds, recipes, householdId, setHouseholdId, online, syncVersion }),
    [ds, recipes, householdId, online, syncVersion],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}
