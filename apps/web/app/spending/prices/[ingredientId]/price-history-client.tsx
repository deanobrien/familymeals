'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Badge, Button, Input, Select, formatPence, useToast } from '@fr/ui';
import { poundsToPence, type PriceHistoryView } from '../../../../lib/money/types';
import { addPriceAction } from '../../actions';
import s from '../../spending.module.css';

const UNITS = ['g', 'kg', 'ml', 'l', 'item', 'pack', 'can'];

export function PriceHistoryClient({ view, readOnly }: { view: PriceHistoryView; readOnly: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [store, setStore] = useState('');
  const [retailer, setRetailer] = useState('');
  const [price, setPrice] = useState('');
  const [size, setSize] = useState('');
  const [unit, setUnit] = useState('g');
  const [error, setError] = useState('');
  const c = view.comparison;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const pence = poundsToPence(price);
    const value = Number(size);
    if (pence === null) { setError('Enter the price like 1.25.'); return; }
    if (!(value > 0)) { setError('Enter the pack size, for example 500 and g.'); return; }
    if (!store && !retailer.trim()) { setError('Say which shop it was.'); return; }
    setError('');
    start(async () => {
      const r = await addPriceAction({ ingredientId: view.ingredientId, storeId: store || null, retailer: store ? null : retailer.trim(), pricePence: pence, packValue: value, packUnit: unit });
      if (r.ok) { toast('Price saved.'); setPrice(''); setSize(''); router.refresh(); } else setError(r.error);
    });
  }

  return (
    <div className={s.page}>
      <section aria-labelledby="ph-now">
        <h2 id="ph-now">Latest price at each shop</h2>
        {c.badge && <p className={s.cheap} data-testid="price-badge"><Badge tone="success">{c.badge}</Badge>{c.savingPct !== null && c.savingPct > 0 && !c.tied ? ` about ${c.savingPct}% less per unit than the dearest compared shop` : ''}</p>}
        {c.note && <p className={s.muted} data-testid="price-note">{c.note}</p>}
        {c.shops.length === 0 ? <p className={s.muted}>No shop prices yet.</p> : (
          <table className={`fr-table ${s.shopTable}`} data-testid="shop-prices">
            <thead><tr><th scope="col">Shop</th><th scope="col">Latest price</th><th scope="col">Unit price</th><th scope="col">Seen</th><th scope="col">Times</th></tr></thead>
            <tbody>
              {c.shops.map((x) => (
                <tr key={x.label}>
                  <th scope="row">{x.label}{x.cheapest ? ' ✓ cheapest' : ''}{!x.linked ? <span className="fr-muted"> (not linked)</span> : null}</th>
                  <td>{formatPence(x.pricePence)}{x.packLabel ? ` for ${x.packLabel}` : ''}{x.kind === 'user_confirmed' ? ' (you entered it)' : ' (receipt)'}</td>
                  <td>{x.unitText ?? 'pack size unknown'}</td>
                  <td>{x.observedOn} ({x.ageText}){x.stale ? ' · old: not used for the comparison' : ''}</td>
                  <td>{x.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className={s.muted}>Only your own confirmed receipts and the prices you enter count here. Prices from the last 60 days are compared; older ones are shown but not ranked.</p>
      </section>

      <section aria-labelledby="ph-hist">
        <h2 id="ph-hist">History</h2>
        {view.history.length === 0 ? <p className={s.muted}>Nothing recorded yet.</p> : (
          <ul className={s.list} data-testid="price-history">
            {view.history.map((h, i) => (
              <li key={i} className={s.entry}>
                <span className={s.entryMain}><strong>{h.label}</strong><span className={s.muted}>{h.observedOn} ({h.ageText}) · {h.kind === 'user_confirmed' ? 'you entered it' : 'confirmed receipt'}</span></span>
                <span>{formatPence(h.pricePence)}{h.packLabel ? ` for ${h.packLabel}` : ''}</span>
                <span className={s.muted}>{h.unitText ?? ''}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {!readOnly && (
        <section aria-labelledby="ph-add">
          <h2 id="ph-add">Add a price you saw</h2>
          <form className={s.form} onSubmit={submit} noValidate data-testid="add-price-form">
            <div className={s.formRow}>
              {view.stores.length > 0 && <Select label="Store" value={store} onChange={(e) => setStore(e.target.value)} placeholder="Another shop" options={view.stores.map((x) => ({ value: x.id, label: x.name }))} />}
              {!store && <Input label="Shop name" value={retailer} onChange={(e) => setRetailer(e.target.value)} maxLength={80} />}
              <Input label="Price (£)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="1.25" />
              <Input label="Pack size" inputMode="decimal" value={size} onChange={(e) => setSize(e.target.value)} placeholder="500" />
              <Select label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} options={UNITS.map((u) => ({ value: u, label: u }))} />
            </div>
            {error && <p className={s.error} role="alert">{error}</p>}
            <div><Button type="submit" loading={pending}>Save price</Button></div>
          </form>
        </section>
      )}
    </div>
  );
}
