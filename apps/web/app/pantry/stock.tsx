'use client';

import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, CardBody, ConfirmDialog, EmptyState, Input, Select } from '@fr/ui';
import type { ExpiringView, ItemView, PantryView } from '../../lib/pantry/types';
import {
  confirmItemAction, correctItemAction, removeItemAction, updateSettingsAction,
} from '../../lib/server/pantry/actions';
import { unitOptions } from './add-item';
import { usePantryAction } from './use-pantry-action';
import s from './pantry.module.css';

/* ---------- Stale "please confirm" prompts ---------- */
export function StalePrompts({ items }: { items: ItemView[] }) {
  const { pending, run } = usePantryAction();
  if (!items.length) return null;
  return (
    <section className={s.section} aria-labelledby="stale-h">
      <h2 id="stale-h">Please confirm ({items.length})</h2>
      <p className={s.lead}>We have not heard about these for a while, so we are not counting them until you say they are still there.</p>
      <ul className={s.list} aria-label="Stock to confirm">
        {items.map((i) => (
          <li key={i.id} className={s.row}>
            <div className={s.rowMain}>
              <span className={s.name}>{i.name} <span className={s.muted}>{i.quantityLabel}</span></span>
              <span className={s.muted}>{i.confidenceMessage}</span>
            </div>
            <Button size="sm" loading={pending} aria-label={`Confirm ${i.name} is still in stock`} onClick={() => run(() => confirmItemAction(i.id))}>
              Yes, still have it
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------- Stock list ---------- */
function ItemRow({ item, onRemove }: { item: ItemView; onRemove: (i: ItemView) => void }) {
  const { pending, run } = usePantryAction();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(String(item.value ?? ''));
  const [unit, setUnit] = useState(item.unit ?? 'item');
  const [expiry, setExpiry] = useState(item.expiry ?? '');

  function save(e: FormEvent) {
    e.preventDefault();
    run(() => correctItemAction({ id: item.id, value: Number(value), unit, expiry }), () => setEditing(false));
  }

  return (
    <li>
      <div className={s.row}>
        <div className={s.rowMain}>
          <span className={s.name}>{item.name}</span>
          <span className={s.muted}>{item.quantityLabel}</span>
        </div>
        <div className={s.badges}>
          {item.expiryBadge && <Badge tone={item.expiryBadge.tone === 'neutral' ? 'neutral' : item.expiryBadge.tone}>{item.expiryBadge.label}</Badge>}
          {item.stale && <Badge tone="warning">Needs confirming</Badge>}
          {item.status === 'approximate' && <Badge>Approximate</Badge>}
        </div>
        <div className={s.actions}>
          <Button size="sm" variant="secondary" aria-expanded={editing} aria-label={`Correct ${item.name}`} onClick={() => setEditing((v) => !v)}>
            Correct
          </Button>
          <Button size="sm" variant="ghost" aria-label={`Remove ${item.name}`} onClick={() => onRemove(item)}>
            Remove
          </Button>
        </div>
      </div>
      {editing && (
        <form className={s.inlineForm} onSubmit={save} aria-label={`Correct ${item.name}`}>
          <Input label="Actual quantity" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} hint="Set to 0 to remove it." />
          <Select label="Unit" options={unitOptions} value={unit} onChange={(e) => setUnit(e.target.value)} />
          <Input label="Expiry" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          <Button type="submit" size="sm" loading={pending}>Save correction</Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
        </form>
      )}
    </li>
  );
}

export function StockList({ view }: { view: PantryView }) {
  const { pending, run } = usePantryAction();
  const [removing, setRemoving] = useState<ItemView | null>(null);

  return (
    <section className={s.section} aria-labelledby="stock-h">
      <h2 id="stock-h">In your pantry ({view.totalItems})</h2>
      {view.categories.length === 0 ? (
        <EmptyState icon="inbox" title="Your pantry is empty" description="Add what you have so we can suggest recipes and trim your shopping list." />
      ) : (
        view.categories.map((c) => (
          <Card key={c.category}>
            <CardBody>
              <h3 style={{ margin: 0 }}>{c.label}</h3>
              <ul className={s.list} aria-label={c.label}>
                {c.items.map((i) => <ItemRow key={i.id} item={i} onRemove={setRemoving} />)}
              </ul>
            </CardBody>
          </Card>
        ))
      )}
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? 'item'}?`}
        description="It will no longer count towards recipe suggestions or your shopping list."
        confirmLabel="Remove"
        destructive
        loading={pending}
        onConfirm={() => removing && run(() => removeItemAction(removing.id), () => setRemoving(null))}
      />
    </section>
  );
}

/* ---------- Expiring soon ---------- */
export function ExpiringPanel({ items }: { items: ExpiringView[] }) {
  return (
    <section className={s.section} aria-labelledby="expiring-h">
      <h2 id="expiring-h">Expiring soon</h2>
      {items.length === 0 ? (
        <p className={s.lead}>Nothing is close to its expiry date.</p>
      ) : (
        <Card>
          <CardBody>
            <ul className={s.list} aria-label="Expiring items">
              {items.map((i) => (
                <li key={i.id} className={s.row}>
                  <div className={s.rowMain}>
                    <span className={s.name}>{i.name}</span>
                    <span className={s.muted}>{i.quantityLabel}{i.expired ? ' - do not rely on this stock' : ' - use it up first'}</span>
                  </div>
                  <Badge tone={i.badge.tone === 'neutral' ? 'neutral' : i.badge.tone}>{i.badge.label}</Badge>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      )}
    </section>
  );
}

/* ---------- Settings ---------- */
const MODE_OPTIONS = [
  { value: 'off', label: 'Off - never change my pantry from purchases' },
  { value: 'suggest', label: 'Suggest - ask me to confirm each purchase' },
  { value: 'auto', label: 'Auto - add exact purchases automatically' },
];

export function SettingsPanel({ settings }: { settings: PantryView['settings'] }) {
  const { pending, run } = usePantryAction();
  const [mode, setMode] = useState<string>(settings.purchaseMode);
  const [days, setDays] = useState(String(settings.staleAfterDays));

  function save(e: FormEvent) {
    e.preventDefault();
    run(() => updateSettingsAction({ purchaseMode: mode as PantryView['settings']['purchaseMode'], staleAfterDays: Number(days) }));
  }

  return (
    <section className={s.section} aria-labelledby="settings-h">
      <h2 id="settings-h">Pantry settings</h2>
      <Card>
        <CardBody>
          <form className={s.cardBody} onSubmit={save} aria-label="Pantry settings">
            <Select label="After I buy something" options={MODE_OPTIONS} value={mode} onChange={(e) => setMode(e.target.value)}
              hint="Bought quantities are never assumed to last forever; you can always correct them." />
            <Input label="Ask me to confirm stock after (days)" type="number" min={1} max={730} value={days} onChange={(e) => setDays(e.target.value)} />
            <div><Button type="submit" loading={pending}>Save settings</Button></div>
          </form>
        </CardBody>
      </Card>
    </section>
  );
}
