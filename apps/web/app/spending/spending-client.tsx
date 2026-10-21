'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { statusText } from '@fr/engine/money';
import { Badge, Button, Card, CardBody, Input, Select, formatPence, useToast } from '@fr/ui';
import { poundsToPence, type SpendingView } from '../../lib/money/types';
import { addSpendAction, deleteSpendAction, linkRetailerAction } from './actions';
import { monthChartRows, SpendChart, weekChartRows } from './spend-chart';
import s from './spending.module.css';

function StatusTag({ status, variance }: { status: Parameters<typeof statusText>[0]; variance: number | null }) {
  const tone = status === 'over' ? s.over : status === 'under' || status === 'so_far_within' ? s.under : '';
  const icon = status === 'over' ? '▲' : status === 'under' || status === 'so_far_within' ? '▼' : '•';
  return <span className={`${s.tag} ${tone}`} data-testid="budget-status"><span aria-hidden="true">{icon}</span>{statusText(status, variance)}</span>;
}

export function SpendingClient({ view, weeks, ranges, readOnly }: { view: SpendingView; weeks: number; ranges: number[]; readOnly: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [unit, setUnit] = useState<'week' | 'month'>('week');
  const w = view.thisWeek;

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>, done: string) =>
    start(async () => {
      const r = await fn();
      if (r.ok) { toast(done); router.refresh(); } else toast({ message: r.error ?? 'Something went wrong.', tone: 'error' });
    });

  return (
    <div className={s.page}>
      <p className={s.sub}>Budget, what the plan is estimated to cost, and what you actually spent. {view.from} to {view.to}.</p>

      <section aria-labelledby="sp-week" className={s.grid} data-testid="spending-summary">
        <Card><CardBody>
          <h2 id="sp-week" className="fr-visually-hidden-fallback" style={{ fontSize: 'var(--fr-text-md)', margin: 0 }}>This week</h2>
          <p className={s.muted}>Weekly budget</p>
          <p className={s.big} data-testid="budget-value">{view.weeklyBudgetPence === null ? 'Not set' : formatPence(view.weeklyBudgetPence)}</p>
          {view.weeklyBudgetPence === null && <Link href="/settings">Set a weekly budget in Settings</Link>}
        </CardBody></Card>
        <Card><CardBody>
          <p className={s.muted}>Planned this week <Badge tone="warning">estimate</Badge></p>
          <p className={s.big} data-testid="planned-value">{w?.plannedPence == null ? 'No approved plan' : `${w.plannedPartial ? 'At least ' : ''}${formatPence(w.plannedPence)}`}</p>
          <p className={s.muted}>From your recipe costs. {w?.plannedPartial ? 'Some ingredients have no price, so this is a lower bound.' : ''}</p>
        </CardBody></Card>
        <Card><CardBody>
          <p className={s.muted}>Spent this week so far <Badge>actual</Badge></p>
          <p className={s.big} data-testid="actual-value">{formatPence(w?.actualPence ?? 0)}</p>
          {w && <StatusTag status={w.actualStatus} variance={w.varianceToBudgetPence} />}
        </CardBody></Card>
      </section>

      <section aria-labelledby="sp-trend">
        <div className={s.row} style={{ justifyContent: 'space-between' }}>
          <h2 id="sp-trend">Trend</h2>
          <div className={s.row}>
            <div className="fr-viewtoggle" role="group" aria-label="Group by">
              <Button size="sm" variant="ghost" aria-pressed={unit === 'week'} onClick={() => setUnit('week')}>Weekly</Button>
              <Button size="sm" variant="ghost" aria-pressed={unit === 'month'} onClick={() => setUnit('month')}>Monthly</Button>
            </div>
            <div className="fr-viewtoggle" role="group" aria-label="Range">
              {ranges.map((r) => (
                <Link key={r} href={`/spending?weeks=${r}`} className="fr-btn fr-btn--ghost fr-btn--sm" aria-current={r === weeks ? 'true' : undefined} style={r === weeks ? { fontWeight: 700 } : undefined}>{r} wk</Link>
              ))}
            </div>
          </div>
        </div>
        <SpendChart rows={unit === 'week' ? weekChartRows(view.weeks) : monthChartRows(view.months)} unit={unit} />
        <p className={s.muted} data-testid="range-total">Over these {view.weeks.length} weeks you spent {formatPence(view.totals.actualPence)} ({formatPence(view.totals.receiptsPence)} from receipts, {formatPence(view.totals.manualPence)} entered by hand){view.totals.plannedPence !== null ? `; the approved plans were estimated at ${view.totals.plannedPartial ? 'at least ' : ''}${formatPence(view.totals.plannedPence)} across ${view.totals.plannedWeeks} week${view.totals.plannedWeeks === 1 ? '' : 's'}` : ''}.</p>
        <ul className={s.list} aria-label="Week by week">
          {[...view.weeks].reverse().slice(0, 8).map((x) => (
            <li key={x.weekStart} className={s.entry} data-testid="week-row">
              <span className={s.entryMain}><strong>{x.label}{x.inProgress ? ' (this week)' : ''}</strong><span className={s.muted}>{x.entries} receipt{x.entries === 1 ? '' : 's'} or entr{x.entries === 1 ? 'y' : 'ies'}</span></span>
              <span>{formatPence(x.actualPence)}</span>
              <StatusTag status={x.actualStatus} variance={x.varianceToBudgetPence} />
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="sp-cat">
        <h2 id="sp-cat">Where it went</h2>
        {view.categories.length === 0 ? <p className={s.muted}>Nothing recorded in this range yet. Confirm a receipt or add an entry below.</p> : (
          <ul className={s.bars} data-testid="category-breakdown">
            {view.categories.map((c) => (
              <li key={c.category} className={s.barRow}>
                <span>{c.category}</span>
                <span className={s.barTrack} aria-hidden="true"><span className={s.barFill} style={{ display: 'block', width: `${Math.max(2, c.sharePct)}%` }} /></span>
                <span>{formatPence(c.pence)} <span className={s.muted}>({c.sharePct}%)</span></span>
              </li>
            ))}
          </ul>
        )}
        <p className={s.muted}>By the shopping list&rsquo;s categories. &ldquo;Uncategorised&rdquo; is spend we could not tell: receipt lines not matched to a known food, bags, or manual entries without a category.</p>
        {view.shops.length > 0 && (
          <table className="fr-table" data-testid="shop-breakdown">
            <caption className="fr-muted">By shop</caption>
            <thead><tr><th scope="col">Shop</th><th scope="col">Trips</th><th scope="col">Spent</th></tr></thead>
            <tbody>{view.shops.map((x) => <tr key={x.shop}><th scope="row">{x.shop}</th><td>{x.trips}</td><td>{formatPence(x.pence)}</td></tr>)}</tbody>
          </table>
        )}
      </section>

      {view.unlinked.length > 0 && !readOnly && (
        <section aria-labelledby="sp-link" data-testid="unlinked-retailers">
          <h2 id="sp-link">Match receipts to your shops</h2>
          <p className={s.muted}>Receipts print the shop&rsquo;s name in their own way. Confirm which of your stores each one is, so prices from &ldquo;TESCO EXTRA&rdquo; and &ldquo;Tesco&rdquo; are compared as one shop.</p>
          <ul className={s.list}>
            {view.unlinked.map((u) => (
              <li key={u.key} className={s.entry} data-testid="unlinked-row">
                <span className={s.entryMain}><strong>{u.retailer}</strong><span className={s.muted}>{u.receipts} receipt{u.receipts === 1 ? '' : 's'}</span></span>
                {u.suggestion ? (
                  <>
                    <span>Is this <strong>{u.suggestion.name}</strong>?</span>
                    <Button size="sm" loading={pending} onClick={() => run(() => linkRetailerAction(u.retailer, u.suggestion!.id), `Linked to ${u.suggestion!.name}.`)}>Yes, link it</Button>
                  </>
                ) : view.stores.length > 0 ? (
                  <LinkPicker stores={view.stores} onPick={(id, name) => run(() => linkRetailerAction(u.retailer, id), `Linked to ${name}.`)} />
                ) : <Link href="/settings/stores">Add your shops first</Link>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="sp-add">
        <h2 id="sp-add">Add spending without a receipt</h2>
        {readOnly ? <p className={s.muted}>This household is read-only while it is pending deletion.</p> : <AddSpend view={view} busy={pending} onAdd={(input) => run(() => addSpendAction(input), 'Added.')} />}
      </section>

      <section aria-labelledby="sp-recent">
        <div className={s.row} style={{ justifyContent: 'space-between' }}>
          <h2 id="sp-recent">Recent</h2>
          <a className="fr-btn fr-btn--secondary fr-btn--sm" href={`/api/money/spending/csv?weeks=${weeks}`} download data-testid="csv-link">Download CSV</a>
        </div>
        {view.recent.length === 0 ? <p className={s.muted}>No spending recorded yet.</p> : (
          <ul className={s.list} data-testid="recent-spend">
            {view.recent.map((r) => (
              <li key={r.id} className={s.entry} data-testid="spend-row" data-source={r.source}>
                <span className={s.entryMain}>
                  <strong>{r.shop ?? 'Shop not recorded'}</strong>
                  <span className={s.muted}>{r.date} · {r.source === 'receipt' ? 'Receipt' : 'Entered by hand'}{r.category ? ` · ${r.category}` : ''}{r.note ? ` · ${r.note}` : ''}</span>
                </span>
                <span>{formatPence(r.totalPence)}</span>
                {r.source === 'receipt' ? <Link href={`/receipts/${r.id}/review`}>Receipt</Link> : !readOnly && (
                  <Button size="sm" variant="ghost" aria-label={`Delete the ${formatPence(r.totalPence)} entry from ${r.date}`} onClick={() => run(() => deleteSpendAction(r.id), 'Removed.')}>Delete</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <p><Link href="/shopping">Compare shop prices on your shopping list</Link></p>
      <ul className={s.notes} aria-label="How to read this page">
        {view.notes.map((n) => <li key={n}>{n}</li>)}
        {view.usedScanDate > 0 && <li>{view.usedScanDate} receipt{view.usedScanDate === 1 ? ' has' : 's have'} no printed date, so the day it was scanned is used.</li>}
      </ul>
    </div>
  );
}

function LinkPicker({ stores, onPick }: { stores: { id: string; name: string }[]; onPick: (id: string, name: string) => void }) {
  const [id, setId] = useState('');
  return (
    <span className={s.row}>
      <Select label="Link to store" hideLabel value={id} onChange={(e) => setId(e.target.value)} placeholder="Link to a store…" options={stores.map((x) => ({ value: x.id, label: x.name }))} />
      <Button size="sm" disabled={!id} onClick={() => onPick(id, stores.find((x) => x.id === id)?.name ?? 'store')}>Link</Button>
    </span>
  );
}

function AddSpend({ view, busy, onAdd }: { view: SpendingView; busy: boolean; onAdd: (i: { date: string; amountPence: number; storeId: string | null; retailer: string | null; category: string | null; note: string | null }) => void }) {
  const [date, setDate] = useState(view.today);
  const [amount, setAmount] = useState('');
  const [store, setStore] = useState('');
  const [retailer, setRetailer] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  function submit(e: React.FormEvent) {
    e.preventDefault();
    const pence = poundsToPence(amount);
    if (pence === null) { setError('Enter an amount like 12.50.'); return; }
    if (!date) { setError('Choose a date.'); return; }
    setError('');
    onAdd({ date, amountPence: pence, storeId: store || null, retailer: store ? null : retailer.trim() || null, category: category || null, note: note.trim() || null });
    setAmount(''); setNote('');
  }
  return (
    <form className={s.form} onSubmit={submit} data-testid="add-spend-form" noValidate>
      <div className={s.formRow}>
        <Input label="Date" type="date" value={date} max={view.to} onChange={(e) => setDate(e.target.value)} required />
        <Input label="Amount (£)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="12.50" required />
        {view.stores.length > 0 && <Select label="Store" value={store} onChange={(e) => setStore(e.target.value)} placeholder="Another shop" options={view.stores.map((x) => ({ value: x.id, label: x.name }))} />}
        {!store && <Input label="Shop name" value={retailer} onChange={(e) => setRetailer(e.target.value)} maxLength={80} />}
        <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Not sure" options={view.categoryChoices.map((c) => ({ value: c, label: c }))} />
        <Input label="Note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} />
      </div>
      {error && <p className={s.error} role="alert">{error}</p>}
      <div><Button type="submit" loading={busy}>Add spending</Button></div>
    </form>
  );
}
