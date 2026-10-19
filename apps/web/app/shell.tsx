'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppShell, ToastProvider, type NavKey } from '@fr/ui';

const ROUTE_KEYS: ReadonlyArray<readonly [string, NavKey]> = [
  ['/recipes', 'recipes'],
  ['/plan', 'planner'],
  ['/shopping', 'shopping'],
  ['/pantry', 'pantry'],
  ['/receipts', 'receipts'],
  ['/household', 'household'],
  ['/settings', 'settings'],
];

function activeKey(pathname: string): NavKey {
  return ROUTE_KEYS.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1] ?? 'home';
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <ToastProvider>
      <AppShell active={activeKey(pathname)} linkComponent={Link}>
        {children}
      </AppShell>
    </ToastProvider>
  );
}
