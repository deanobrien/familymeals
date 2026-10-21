'use client';

// Settings > Stores (AS1, D297): create/edit/delete stores, manage aisles (add, rename, drag or button reorder),
// view/edit placements, copy a layout from another store, start from a clearly-labelled generic template.
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, ConfirmDialog, Input, Select, useToast } from '@fr/ui';
import type { Store, StoreAisle, StoreBook, StorePlacement } from '../../../lib/shopping/engine';
import { KNOWN_CHAINS, STORE_TEMPLATES, sortedAisles, templateForChain } from '../../../lib/shopping/engine';
import {
  addAisleAction, applyStoreTemplateAction, copyStoreLayoutAction, createStoreAction, deleteAisleAction, deleteStoreAction,
  renameAisleAction, reorderAislesAction, setPlacementAction, updateStoreAction, type StoreActionResult,
} from '../../shopping/store-actions';
import s from '../../../lib/dashboard/dashboard.module.css';
import m from './stores.module.css';
import { StoreLocationPanel } from './store-location';
import type { StoreLocation } from '../../../lib/stores/locations';

type Template = keyof typeof STORE_TEMPLATES;
const NONE = '';

export function StoresManager({ initial, ingredientNames, readOnly, initialLocations = [] }: { initial: StoreBook; ingredientNames: Record<string, string>; readOnly: boolean; initialLocations?: StoreLocation[] }) {
  const { toast } = useToast();
  const [book, setBook] = useState(initial);
  const [names, setNames] = useState(ingredientNames);
  const [locations, setLocations] = useState(initialLocations);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Run an action; replace the book from its answer; toast the error otherwise. */
  async function act(fn: () => Promise<StoreActionResult>, done?: string): Promise<StoreActionResult | null> {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (r.ok) {
        setBook(r.book);
        if (done) toast({ message: done });
      } else {
        setError(r.error); // also on the page (a toast alone disappears)
        toast({ message: r.error, tone: 'error' });
      }
      return r;
    } catch {
      setError('Could not reach the server. Nothing was changed.');
      return null;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.page} data-testid="stores-manager">
      <p><Link href="/settings">Back to settings</Link></p>
      <h1>Stores and aisles</h1>
      <p className={s.muted}>
        Tell the app how each shop is laid out, then pick the shop on the shopping list to see it in aisle order. Everyone in your household shares these.
      </p>
      {readOnly && <p role="status">This household is read-only while it waits to be deleted, so stores cannot be changed.</p>}

      {error && <p role="alert" className={m.error} data-testid="stores-error">{error}</p>}

      <NewStore book={book} disabled={busy || readOnly} act={act} />

      {book.stores.length === 0 && <p data-testid="no-stores">No stores yet. Add your first one above.</p>}
      {book.stores.map((st) => (
        <StoreCard key={st.id} store={st} book={book} names={names} disabled={busy || readOnly} act={act} setNames={setNames} location={locations.find((l) => l.storeId === st.id)} onLocations={(p) => setLocations(p.locations)} />
      ))}
    </div>
  );
}

type Act = (fn: () => Promise<StoreActionResult>, done?: string) => Promise<StoreActionResult | null>;

function NewStore({ book, disabled, act }: { book: StoreBook; disabled: boolean; act: Act }) {
  const [name, setName] = useState('');
  const [chain, setChain] = useState('');
  const [notes, setNotes] = useState('');
  const [tpl, setTpl] = useState<string>(NONE);
  const [error, setError] = useState<string | undefined>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setError('Give the store a name.');
    setError(undefined);
    const r = await act(() => createStoreAction({ name, chain, notes }, tpl || undefined), `Added ${name.trim()}.`);
    if (r?.ok) { setName(''); setChain(''); setNotes(''); setTpl(NONE); }
  }

  return (
    <Card>
      <form className={s.card} onSubmit={(e) => void submit(e)} aria-labelledby="h-new-store">
        <h2 id="h-new-store">Add a store</h2>
        <Input label="Store name" value={name} onChange={(e) => setName(e.target.value)} placeholder="ALDI Gosforth" maxLength={80} {...(error ? { error } : {})} />
        <Input label="Chain (optional)" list="store-chains" value={chain} onChange={(e) => setChain(e.target.value)} placeholder="ALDI" maxLength={60} />
        <datalist id="store-chains">{KNOWN_CHAINS.map((c) => <option key={c} value={c} />)}</datalist>
        <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
        <Select
          label="Starting aisles"
          hint="A generic guess at a typical layout, not real data for any shop. Edit it to match yours."
          value={tpl}
          onChange={(e) => setTpl(e.target.value)}
          options={[
            { value: NONE, label: 'Start empty' },
            ...Object.values(STORE_TEMPLATES).map((t) => ({ value: t.id, label: t.title + (t.id === templateForChain(chain).id ? ' (suggested)' : '') })),
          ]}
        />
        <Button type="submit" disabled={disabled}>Add store</Button>
        {book.stores.length > 0 && <span className={s.muted}>{book.stores.length} store{book.stores.length === 1 ? '' : 's'} so far.</span>}
      </form>
    </Card>
  );
}

function StoreCard({ store, book, names, disabled, act, setNames, location, onLocations }: {
  location: StoreLocation | undefined; onLocations: (p: { locations: StoreLocation[] }) => void;
  store: Store; book: StoreBook; names: Record<string, string>; disabled: boolean; act: Act; setNames: (n: Record<string, string>) => void;
}) {
  const aisles = sortedAisles(store.id, book.aisles);
  const placements = book.placements.filter((p) => p.storeId === store.id);
  const [name, setName] = useState(store.name);
  const [chain, setChain] = useState(store.chain ?? '');
  const [notes, setNotes] = useState(store.notes ?? '');
  const [newAisle, setNewAisle] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copyFrom, setCopyFrom] = useState('');
  const [confirmCopy, setConfirmCopy] = useState(false);
  const [tpl, setTpl] = useState('');
  const [dragId, setDragId] = useState<string | null>(null);
  void setNames;

  const others = book.stores.filter((x) => x.id !== store.id).sort((a, b) => Number(sameChain(b, store)) - Number(sameChain(a, store)));
  const move = (index: number, delta: number) => {
    const ids = aisles.map((a) => a.id);
    const j = index + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[index], ids[j]] = [ids[j]!, ids[index]!];
    void act(() => reorderAislesAction(store.id, ids));
  };
  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const ids = aisles.map((a) => a.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    setDragId(null);
    void act(() => reorderAislesAction(store.id, ids));
  };

  return (
    <Card>
      <section className={s.card} aria-labelledby={`h-${store.id}`} data-testid={`store-${store.name}`}>
        <h2 id={`h-${store.id}`}>{store.name} {store.chain && <Badge>{store.chain}</Badge>}</h2>

        <form
          className={m.row}
          onSubmit={(e) => { e.preventDefault(); void act(() => updateStoreAction(store.id, { name, chain, notes }), 'Saved.'); }}
        >
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
          <Input label="Chain" list="store-chains" value={chain} onChange={(e) => setChain(e.target.value)} maxLength={60} />
          <Input label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={500} />
          <Button type="submit" variant="secondary" disabled={disabled}>Save details</Button>
        </form>

        <h3>Aisles (in the order you walk them)</h3>
        {aisles.length === 0 && <p className={s.muted}>No aisles yet.</p>}
        <ol className={m.aisles} aria-label={`Aisles at ${store.name}`}>
          {aisles.map((a, i) => (
            <AisleRow
              key={a.id} aisle={a} index={i} count={aisles.length} disabled={disabled} storeName={store.name}
              onRename={(label) => act(() => renameAisleAction(a.id, label))}
              onDelete={() => void act(() => deleteAisleAction(a.id), `Removed ${a.label}.`)}
              onMove={(d) => move(i, d)}
              onDragStart={() => setDragId(a.id)} onDrop={() => drop(a.id)} dragging={dragId === a.id}
            />
          ))}
        </ol>
        <form className={m.row} onSubmit={(e) => { e.preventDefault(); if (newAisle.trim()) void act(() => addAisleAction(store.id, newAisle), `Added aisle ${newAisle.trim()}.`).then((r) => r?.ok && setNewAisle('')); }}>
          <Input label="New aisle" value={newAisle} onChange={(e) => setNewAisle(e.target.value)} placeholder="1, Frozen, Fruit & veg" maxLength={60} />
          <Button type="submit" variant="secondary" disabled={disabled || !newAisle.trim()}>Add aisle</Button>
        </form>

        <StoreLocationPanel store={store} location={location} disabled={disabled} onChange={onLocations} />

        <h3>Where things are</h3>
        <PlacementList storeName={store.name} aisles={aisles} placements={placements} names={names} disabled={disabled}
          onChange={(p, aisleId) => act(() => setPlacementAction(store.id, { targetType: p.targetType, targetKey: p.targetKey }, aisleId))} />

        <h3>Quick setup</h3>
        <div className={m.row}>
          <Select
            label="Add starting aisles"
            hint="A generic guess, not real shop data. Keeps what you already set."
            value={tpl}
            onChange={(e) => setTpl(e.target.value)}
            placeholder="Choose a layout"
            options={Object.values(STORE_TEMPLATES).map((t) => ({ value: t.id, label: t.title }))}
          />
          <Button variant="secondary" disabled={disabled || !tpl} onClick={() => void act(() => applyStoreTemplateAction(store.id, tpl as Template), 'Starting aisles added.')}>Add</Button>
        </div>
        {others.length > 0 && (
          <div className={m.row}>
            <Select
              label="Copy aisles and placements from"
              hint="Replaces this store's aisles and placements."
              value={copyFrom}
              onChange={(e) => setCopyFrom(e.target.value)}
              placeholder="Choose a store"
              options={others.map((o) => ({ value: o.id, label: o.name + (sameChain(o, store) ? ' (same chain)' : '') }))}
            />
            <Button variant="secondary" disabled={disabled || !copyFrom} onClick={() => setConfirmCopy(true)}>Copy</Button>
          </div>
        )}

        <div className={m.danger}>
          <Button variant="danger" disabled={disabled} onClick={() => setConfirmDelete(true)}>Delete {store.name}</Button>
        </div>
      </section>

      <ConfirmDialog
        open={confirmDelete} onOpenChange={setConfirmDelete} destructive confirmLabel="Delete store"
        title={`Delete ${store.name}?`} description="Its aisles and placements are deleted too. Your shopping lists are not affected."
        onConfirm={() => { setConfirmDelete(false); void act(() => deleteStoreAction(store.id), `Deleted ${store.name}.`); }}
      />
      <ConfirmDialog
        open={confirmCopy} onOpenChange={setConfirmCopy} confirmLabel="Replace and copy"
        title={`Copy onto ${store.name}?`} description="This replaces the aisles and placements this store has now."
        onConfirm={() => { setConfirmCopy(false); const from = copyFrom; setCopyFrom(''); void act(() => copyStoreLayoutAction(from, store.id), 'Layout copied.'); }}
      />
    </Card>
  );
}

const sameChain = (a: Store, b: Store): boolean => !!a.chain && !!b.chain && a.chain.toLowerCase() === b.chain.toLowerCase();

function AisleRow({ aisle, index, count, disabled, storeName, onRename, onDelete, onMove, onDragStart, onDrop, dragging }: {
  aisle: StoreAisle; index: number; count: number; disabled: boolean; storeName: string;
  onRename: (label: string) => Promise<unknown>; onDelete: () => void; onMove: (delta: number) => void;
  onDragStart: () => void; onDrop: () => void; dragging: boolean;
}) {
  const [label, setLabel] = useState(aisle.label);
  return (
    <li
      className={m.aisle} data-dragging={dragging} data-testid={`aisle-row-${aisle.label}`}
      draggable={!disabled} onDragStart={onDragStart} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); onDrop(); }}
    >
      <span className={m.grip} aria-hidden="true">::</span>
      <Input
        label={`Aisle ${index + 1} name at ${storeName}`} hideLabel value={label} maxLength={60}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={() => { if (label.trim() && label.trim() !== aisle.label) void onRename(label); else setLabel(aisle.label); }}
      />
      <Button size="sm" variant="ghost" disabled={disabled || index === 0} aria-label={`Move ${aisle.label} up`} onClick={() => onMove(-1)}>Up</Button>
      <Button size="sm" variant="ghost" disabled={disabled || index === count - 1} aria-label={`Move ${aisle.label} down`} onClick={() => onMove(1)}>Down</Button>
      <Button size="sm" variant="ghost" disabled={disabled} aria-label={`Delete aisle ${aisle.label}`} onClick={onDelete}>Delete</Button>
    </li>
  );
}

function PlacementList({ storeName, aisles, placements, names, disabled, onChange }: {
  storeName: string; aisles: StoreAisle[]; placements: StorePlacement[]; names: Record<string, string>; disabled: boolean;
  onChange: (p: StorePlacement, aisleId: string | null) => Promise<unknown>;
}) {
  if (placements.length === 0) return <p className={s.muted}>Nothing placed yet. Place items from the shopping list while you are in the shop, or add starting aisles below.</p>;
  const label = (p: StorePlacement): string =>
    p.targetType === 'ingredient' ? (names[p.targetKey] ?? 'Ingredient') : p.targetType === 'category' ? `Everything in ${p.targetKey}` : p.targetKey;
  const sorted = [...placements].sort((a, b) => aisles.findIndex((x) => x.id === a.aisleId) - aisles.findIndex((x) => x.id === b.aisleId) || label(a).localeCompare(label(b)));
  return (
    <ul className={m.placements} aria-label={`Placements at ${storeName}`}>
      {sorted.map((p) => (
        <li key={`${p.targetType}:${p.targetKey}`} className={m.placement}>
          <span className={m.target}>{label(p)} {p.targetType === 'category' && <Badge>category</Badge>}</span>
          <Select
            label={`Aisle for ${label(p)}`} hideLabel value={p.aisleId} disabled={disabled}
            onChange={(e) => void onChange(p, e.target.value)}
            options={aisles.map((a) => ({ value: a.id, label: a.label }))}
          />
          <Button size="sm" variant="ghost" disabled={disabled} aria-label={`Remove placement for ${label(p)}`} onClick={() => void onChange(p, null)}>Remove</Button>
        </li>
      ))}
    </ul>
  );
}
