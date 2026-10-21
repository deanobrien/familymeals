'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AppShell, ToastProvider, type NavKey } from '@fr/ui';
import { NotificationBell } from './notifications/bell';
import { OfflineBoot } from './offline-boot';

const ROUTE_KEYS: ReadonlyArray<readonly [string, NavKey]> = [
  ['/recipes', 'recipes'],
  ['/plan', 'planner'],
  ['/shopping', 'shopping'],
  ['/pantry', 'pantry'],
  ['/receipts', 'receipts'],
  ['/spending', 'spending'],
  ['/household', 'household'],
  ['/settings', 'settings'],
];

/** Sign-in / sign-up / password / callback / invite pages render without the app navigation. */
const AUTH_PATHS = ['/sign-in', '/sign-up', '/forgot-password', '/reset-password'];
// '/scan/' = the phone page for "use my phone as the scanner" (P3-C): the phone is not signed in, so no app navigation.
const AUTH_PREFIXES = ['/auth/', '/invite/', '/scan/'];

export function isAuthRoute(pathname: string): boolean {
  return AUTH_PATHS.includes(pathname) || AUTH_PREFIXES.some((p) => pathname.startsWith(p));
}

function activeKey(pathname: string): NavKey {
  return ROUTE_KEYS.find(([p]) => pathname === p || pathname.startsWith(`${p}/`))?.[1] ?? 'home';
}

/** Shown on every page in local mock-auth mode so nobody mistakes the demo for a real account. */
function MockBanner({ label }: { label: string }) {
  return (
    <div
      role="note"
      data-testid="mock-auth-banner"
      style={{
        background: 'var(--fr-warning-soft)',
        color: 'var(--fr-warning)',
        borderBottom: '1px solid currentColor',
        padding: '0.4rem 1rem',
        fontSize: '0.875rem',
        textAlign: 'center',
      }}
    >
      {label}
    </div>
  );
}

export function Shell({ children, mockLabel }: { children: ReactNode; mockLabel?: string }) {
  const pathname = usePathname();
  const banner = mockLabel ? <MockBanner label={mockLabel} /> : null;
  if (isAuthRoute(pathname)) {
    return (
      <ToastProvider>
        <div className="fr-root fr-auth">
          {banner}
          <OfflineBoot />
          {children}
        </div>
      </ToastProvider>
    );
  }
  return (
    <ToastProvider>
      {banner}
      <OfflineBoot />
      <AppShell active={activeKey(pathname)} linkComponent={Link} topBar={<NotificationBell />}>
        {children}
      </AppShell>
    </ToastProvider>
  );
}
