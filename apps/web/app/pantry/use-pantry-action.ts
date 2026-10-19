'use client';

import { useCallback, useTransition } from 'react';
import { useToast } from '@fr/ui';
import type { ActionResult } from '../../lib/pantry/types';

/** Runs a server action in a transition and reports the outcome in a toast. Resolves true on success. */
export function usePantryAction() {
  const [pending, start] = useTransition();
  const { toast } = useToast();
  const run = useCallback(
    (action: () => Promise<ActionResult>, after?: () => void) => {
      start(async () => {
        const res = await action();
        if (res.ok) {
          if (res.message) toast(res.message);
          after?.();
        } else {
          toast({ message: res.error, tone: 'error' });
        }
      });
    },
    [toast],
  );
  return { pending, run };
}
