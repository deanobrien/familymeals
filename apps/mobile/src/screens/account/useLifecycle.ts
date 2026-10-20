import { useCallback, useEffect, useState } from 'react';
import { useApp } from '@/data/AppContext';
import type { Lifecycle } from '@/data/accountSource';
import { messageOf } from '@/lib/accountErrors';

/** Account/household deletion state for Settings > Your data and the delete-account screen (null household = account only). */
export function useLifecycle(householdId: string | null) {
  const { ds } = useApp();
  const [lifecycle, setLifecycle] = useState<Lifecycle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    if (!householdId) {
      setLifecycle({ accountDeletionAt: null, activeMembers: 1, otherOwners: 0 });
      return;
    }
    try {
      setLifecycle(await ds.account.getLifecycle(householdId));
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, [ds, householdId]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { lifecycle, error, reload };
}
