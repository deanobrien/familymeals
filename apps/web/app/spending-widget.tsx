'use client';

// "This week" money at a glance for Home (P2-B, D405): budget, planned estimate and spend so far, each labelled for what it is.
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { statusText } from '@fr/engine/money';
import { Badge, formatPence } from '@fr/ui';
import { getSpendingWidgetAction } from './spending/actions';
import s from '../lib/dashboard/dashboard.module.css';

type Data = Awaited<ReturnType<typeof getSpendingWidgetAction>>;

export function SpendingWidget() {
  const [data, setData] = useState<Data | undefined>(undefined);
  useEffect(() => { getSpendingWidgetAction().then(setData, () => setData(null)); }, []);
  const w = data?.thisWeek ?? null;
  return (
    <section className={s.card} aria-labelledby="h-spend" data-testid="spending-widget">
      <h2 id="h-spend">Spending this week</h2>
      {data === undefined && <p className={s.muted} role="status">Loading&hellip;</p>}
      {data === null && <p className={s.muted}>We could not load your spending just now.</p>}
      {data && (
        <>
          <p className={s.big} data-testid="widget-actual">{formatPence(w?.actualPence ?? 0)} <Badge>spent</Badge></p>
          <p className={s.muted}>
            {data.weeklyBudgetPence === null ? 'No weekly budget set.' : `Budget ${formatPence(data.weeklyBudgetPence)}. ${w ? statusText(w.actualStatus, w.varianceToBudgetPence) : ''}`}
          </p>
          {w?.plannedPence != null && <p className={s.muted}>Plan estimate: {w.plannedPartial ? 'at least ' : 'about '}{formatPence(w.plannedPence)} (estimate)</p>}
          <Link className={s.link} href="/spending">Open spending</Link>
        </>
      )}
    </section>
  );
}
