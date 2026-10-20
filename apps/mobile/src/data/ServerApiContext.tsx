import React, { createContext, useContext, useMemo } from 'react';
import { createServerApi, type ServerApi } from '@/lib/serverApi';
import { EmptyState } from '@/screens/ui';
import { useApp } from './AppContext';

const Override = createContext<ServerApi | null>(null);

/** Tests (and previews) inject a fake `ServerApi` here; the app itself never needs the provider. */
export function ServerApiProvider({ api, children }: { api: ServerApi; children: React.ReactNode }) {
  return <Override.Provider value={api}>{children}</Override.Provider>;
}

/** The JSON API client for the web server: Bearer token from the data source, base URL from EXPO_PUBLIC_API_BASE_URL. */
export function useServerApi(): ServerApi {
  const injected = useContext(Override);
  const { ds } = useApp();
  return useMemo(
    () => injected ?? createServerApi({ baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL, getToken: () => ds.getAccessToken() }),
    [injected, ds],
  );
}

/**
 * Wraps a server-backed screen: waits for a household, and shows a plain explanation (not a failure) when the app has no
 * server URL (mock mode). `children` receives the client and the household id.
 */
export function ServerScreen({ children }: { children: (api: ServerApi, householdId: string) => React.ReactNode }) {
  const api = useServerApi();
  const { householdId } = useApp();
  if (!householdId) return <EmptyState title="Pick a household first." />;
  if (!api.configured) {
    return (
      <EmptyState
        title="This needs the Family Recipes server."
        hint="The app is running on built-in demo data. Set EXPO_PUBLIC_API_BASE_URL (and Supabase sign-in) to use this feature."
      />
    );
  }
  return <>{children(api, householdId)}</>;
}
