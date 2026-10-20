'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, relativeTime, type ActivityEventView } from '../../lib/notifications/client';
import s from '../../lib/dashboard/dashboard.module.css';

/** Household activity (purchases, list additions, plan approved, recipes, members), derived from existing logs (D387). */
export function ActivityFeed({ limit = 8, headingId = 'h-act', title = 'Recent activity' }: { limit?: number; headingId?: string; title?: string }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; events: ActivityEventView[] }>({ status: 'loading' });

  useEffect(() => {
    let live = true;
    api.activity(limit).then(
      (r) => live && setState({ status: 'ready', events: r.events }),
      () => live && setState({ status: 'error' }),
    );
    return () => {
      live = false;
    };
  }, [limit]);

  return (
    <section className={s.card} aria-labelledby={headingId} data-testid="activity-feed">
      <h2 id={headingId}>{title}</h2>
      {state.status === 'loading' && <p className={s.muted}>Loading&hellip;</p>}
      {state.status === 'error' && <p className={s.muted}>Activity could not be loaded.</p>}
      {state.status === 'ready' && state.events.length === 0 && <p className={s.muted}>No household activity in the last two weeks.</p>}
      {state.status === 'ready' && state.events.length > 0 && (
        <ul className={s.list}>
          {state.events.map((e) => (
            <li key={e.id}>
              <Link href={e.link} className={s.link} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                <strong>{e.actor}</strong> {e.text} <span className={s.muted}>({relativeTime(e.at)})</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
