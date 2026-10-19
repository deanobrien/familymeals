import React, { createContext, useContext, useMemo, useState } from 'react';
import type { Uuid } from '@fr/domain';
import type { DataSource } from './DataSource';
import { MockDataSource } from './mockDataSource';

interface AppState {
  ds: DataSource;
  householdId: Uuid | null;
  setHouseholdId: (id: Uuid | null) => void;
}

const Ctx = createContext<AppState | null>(null);

export function AppProvider({ dataSource, children }: { dataSource?: DataSource; children: React.ReactNode }) {
  // Swap to a SupabaseDataSource here once it exists (see MONOREPO.md / README).
  const ds = useMemo(() => dataSource ?? new MockDataSource(), [dataSource]);
  const [householdId, setHouseholdId] = useState<Uuid | null>(null);
  const value = useMemo(() => ({ ds, householdId, setHouseholdId }), [ds, householdId]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useApp must be used inside <AppProvider>');
  return v;
}
