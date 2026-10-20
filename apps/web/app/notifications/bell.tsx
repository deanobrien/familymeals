'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Icon } from '@fr/ui';
import { CHANGED_EVENT, api } from '../../lib/notifications/client';

const POLL_MS = 60_000;

/** Bell with the unread count, top right of every app page. Polls once a minute and when the tab becomes visible. */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const pathname = usePathname();

  const refresh = useCallback(() => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    api.unread().then((r) => setUnread(r.unread), () => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const id = window.setInterval(refresh, POLL_MS);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener(CHANGED_EVENT, refresh);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener(CHANGED_EVENT, refresh);
    };
  }, [refresh]);

  // Refresh on navigation too (opening the centre marks things read).
  useEffect(refresh, [pathname, refresh]);

  const label = unread ? `Notifications, ${unread} unread` : 'Notifications';
  return (
    <Link
      href="/notifications"
      aria-label={label}
      title={label}
      data-testid="notification-bell"
      aria-current={pathname === '/notifications' ? 'page' : undefined}
      style={{
        position: 'relative', display: 'inline-grid', placeItems: 'center', minWidth: 'var(--fr-target)', minHeight: 'var(--fr-target)',
        color: 'var(--fr-text)', borderRadius: 'var(--fr-radius-md)',
      }}
    >
      <Icon name="bell" aria-hidden="true" />
      {unread > 0 && (
        <span
          data-testid="notification-unread"
          aria-hidden="true"
          style={{
            position: 'absolute', top: 4, right: 2, minWidth: 18, height: 18, padding: '0 4px', borderRadius: 999, boxSizing: 'border-box',
            background: 'var(--fr-danger, #b3261e)', color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: '18px', textAlign: 'center',
          }}
        >
          {unread > 99 ? '99+' : unread}
        </span>
      )}
    </Link>
  );
}
