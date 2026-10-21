'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Card, ErrorState, Skeleton, formatPence } from '@fr/ui';
import { basketLabel, defaultDashboardSource } from '../lib/dashboard/source';
import type { DashboardData } from '../lib/dashboard/types';
import s from '../lib/dashboard/dashboard.module.css';
import { MakeNow } from './make-now';
import { RestockBanner } from './restock-banner';
import { SpendingWidget } from './spending-widget';
import { ActivityFeed } from './notifications/activity-feed';

type State =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; data: DashboardData };

export default function HomePage() {
  const [state, setState] = useState<State>({ status: 'loading' });

  const load = useCallback(() => {
    setState({ status: 'loading' });
    defaultDashboardSource.load().then(
      (data) => setState({ status: 'ready', data }),
      () => setState({ status: 'error' }),
    );
  }, []);

  useEffect(load, [load]);

  return (
    <div className={s.page}>
      <header>
        <h1>Home</h1>
        {state.status === 'ready' && <p className={s.sub}>{state.data.householdName}</p>}
      </header>
      <RestockBanner />
      {state.status === 'loading' && <Loading />}
      {state.status === 'error' && (
        <ErrorState
          title="We could not load your dashboard"
          description="Check your connection and try again."
          onRetry={load}
        />
      )}
      {state.status === 'ready' && <Dashboard data={state.data} />}
    </div>
  );
}

function Loading() {
  return (
    <div className={s.grid} aria-busy="true" aria-label="Loading dashboard" role="status">
      {[0, 1, 2].map((i) => (
        <Card key={i}>
          <div className={s.card}>
            <Skeleton width="50%" height="1.1rem" label="Loading" />
            <Skeleton width="30%" height="2rem" label="Loading" />
            <Skeleton height="0.9rem" label="Loading" />
          </div>
        </Card>
      ))}
    </div>
  );
}

function Dashboard({ data }: { data: DashboardData }) {
  const { plannedMeals, plannedSlots, basket, shopping, tasks } = data;
  const pct = shopping.total ? Math.round((shopping.done / shopping.total) * 100) : 0;

  return (
    <>
    <div className={s.quick} data-testid="home-quick-actions">
      <Link className={s.tile} href="/recipes/import" data-testid="tile-recipe-photo">
        <span className={s.tileIcon} aria-hidden="true">📷</span>
        <span className={s.tileTitle}>Add a recipe from a photo</span>
        <span className={s.tileSub}>Photograph a recipe card or cookbook page</span>
      </Link>
      <Link className={s.tile} href="/pantry/scan" data-testid="tile-scan-groceries">
        <span className={s.tileIcon} aria-hidden="true">🛒</span>
        <span className={s.tileTitle}>Scan your groceries</span>
        <span className={s.tileSub}>Photo, video or barcode fills your pantry</span>
      </Link>
    </div>
    <MakeNow limit={3} />
    <div className={s.grid}>
      <Card>
        <section className={s.card} aria-labelledby="h-plan">
          <h2 id="h-plan">This week&rsquo;s plan</h2>
          {plannedMeals === 0 ? (
            <>
              <p className={s.muted}>No meals planned yet for the week of {data.weekStart}.</p>
              <Link className={s.link} href="/plan">Start planning</Link>
            </>
          ) : (
            <>
              <p className={s.big}>
                {plannedMeals} of {plannedSlots} meals planned
              </p>
              <div className={s.strip} aria-hidden="true">
                {Array.from({ length: plannedSlots }, (_, i) => (
                  <span key={i} className={`${s.dot} ${i < plannedMeals ? s.dotOn : ''}`} />
                ))}
              </div>
              <Link className={s.link} href="/plan">Open meal planner</Link>
            </>
          )}
        </section>
      </Card>

      <Card>
        <section className={s.card} aria-labelledby="h-basket">
          <h2 id="h-basket">Estimated basket</h2>
          {basket ? (
            <>
              <p className={s.big}>{formatPence(basket.pence)}</p>
              <div className={s.row}>
                <Badge tone={basket.kind === 'partial' ? 'warning' : 'neutral'}>
                  {basket.kind === 'partial' ? 'Partial estimate' : 'Estimate'}
                </Badge>
              </div>
              <p className={s.muted}>{basketLabel(basket)}</p>
            </>
          ) : (
            <p className={s.muted}>Plan some meals to see an estimated cost.</p>
          )}
        </section>
      </Card>

      <Card>
        <SpendingWidget />
      </Card>

      <Card>
        <section className={s.card} aria-labelledby="h-shop">
          <h2 id="h-shop">Shopping list</h2>
          {shopping.total === 0 ? (
            <p className={s.muted}>Your list is empty.</p>
          ) : (
            <>
              <p className={s.big}>
                {shopping.done} of {shopping.total} items
              </p>
              <progress
                value={shopping.done}
                max={shopping.total}
                aria-label={`Shopping progress, ${pct}% complete`}
              />
            </>
          )}
          <Link className={s.link} href="/shopping">Open shopping list</Link>
        </section>
      </Card>

      <Card>
        <section className={s.card} aria-labelledby="h-add">
          <h2 id="h-add">Add a recipe</h2>
          <div className={s.row}>
            <Link className={s.link} href="/recipes/new">Write a new recipe</Link>
            <Link className={s.link} href="/recipes/import">Import from a link or photo</Link>
          </div>
        </section>
      </Card>

      <Card>
        <section className={s.card} aria-labelledby="h-scan">
          <h2 id="h-scan">Update your pantry</h2>
          <div className={s.row}>
            <Link className={s.link} href="/pantry/scan">Scan groceries</Link>
          </div>
        </section>
      </Card>

      <Card>
        <section className={s.card} aria-labelledby="h-todo">
          <h2 id="h-todo">To do</h2>
          {tasks.length === 0 ? (
            <p className={s.muted}>Nothing outstanding. Nice work.</p>
          ) : (
            <ul className={s.list}>
              {tasks.map((t) => (
                <li key={t.id}>
                  <Link className={s.link} href={t.href}>{t.label}</Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </Card>

      <Card>
        {/* Real household activity, derived from the shopping log, plans, recipes and members (P1-C, D387). */}
        <ActivityFeed limit={8} />
      </Card>
    </div>
    </>
  );
}
