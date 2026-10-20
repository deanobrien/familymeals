'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorState } from '@fr/ui';
import { api, notifyChanged, relativeTime, type CentreView, type NotificationView } from '../../lib/notifications/client';
import s from '../../lib/dashboard/dashboard.module.css';
import c from './notifications.module.css';
import { ActivityFeed } from './activity-feed';

/** In-app notification centre: always available, whatever the push permission (D380). */
export function NotificationCentre() {
  const router = useRouter();
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; centre: CentreView }>({ status: 'loading' });

  const load = useCallback(() => {
    api.centre().then((r) => setState({ status: 'ready', centre: r.centre }), () => setState({ status: 'error' }));
  }, []);
  useEffect(load, [load]);

  const markAll = async () => {
    await api.markRead().catch(() => undefined);
    notifyChanged();
    load();
  };
  const open = async (n: NotificationView) => {
    if (!n.read) {
      await api.markRead([n.id]).catch(() => undefined);
      notifyChanged();
    }
    router.push(n.link);
  };

  return (
    <div className={s.page}>
      <header className={s.row} style={{ justifyContent: 'space-between' }}>
        <h1 style={{ margin: 0 }}>Notifications</h1>
        <Link className={s.link} href="/settings/notifications">Notification settings</Link>
      </header>
      <Card>
        <section className={s.card} aria-labelledby="h-centre" data-testid="notification-centre">
          <div className={s.row} style={{ justifyContent: 'space-between' }}>
            <h2 id="h-centre">For you</h2>
            {state.status === 'ready' && state.centre.unread > 0 && (
              <Button variant="secondary" size="sm" onClick={markAll} data-testid="mark-all-read">Mark all as read</Button>
            )}
          </div>
          {state.status === 'loading' && <p className={s.muted}>Loading&hellip;</p>}
          {state.status === 'error' && <ErrorState title="Notifications could not be loaded" onRetry={load} />}
          {state.status === 'ready' && state.centre.items.length === 0 && (
            <EmptyState title="Nothing yet" description="Reminders about food to use soon and the household updates you choose appear here." icon="inbox" />
          )}
          {state.status === 'ready' && state.centre.items.length > 0 && (
            <ul className={s.list} aria-label="Your notifications">
              {state.centre.items.map((n) => (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => void open(n)}
                    data-testid="notification-item"
                    data-read={n.read ? 'true' : 'false'}
                    className={`${c.item} ${n.read ? '' : c.unread}`}
                  >
                    <span className={s.row}>
                      {!n.read && <Badge tone="accent">New</Badge>}
                      <strong>{n.title}</strong>
                    </span>
                    {n.body && <span className={s.muted}>{n.body}</span>}
                    <span className={s.muted}>{relativeTime(n.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Card>
      <Card>
        <ActivityFeed limit={20} headingId="h-household-activity" title="Household activity" />
      </Card>
    </div>
  );
}
