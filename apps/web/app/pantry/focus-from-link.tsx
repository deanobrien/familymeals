'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

/**
 * Deep link from an expiry notification (`/pantry?item=<id>`, P1-C D383): scroll to "Use what I have" (recipes that use
 * what is in, ranked by coverage) so the reminder lands on what can be cooked with it. Does nothing without the parameter.
 */
export function FocusFromLink() {
  const params = useSearchParams();
  const item = params.get('item');
  useEffect(() => {
    if (!item) return;
    const target = document.getElementById('use-h') ?? document.getElementById('expiring-h');
    target?.scrollIntoView({ block: 'start' });
  }, [item]);
  return null;
}
