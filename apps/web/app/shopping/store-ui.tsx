'use client';

// Store-mode UI pieces for /shopping (AS1, D294-D296): the "Shopping at" selector, the "Which aisle?" sheet and the
// learn-from-my-route suggestion. Logic lives in use-store-mode.ts; ordering in @fr/engine/shopping.
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button, Card, CardBody, Checkbox, Input, Select, Sheet } from '@fr/ui';
import type { ItemView, Store, StoreAisle } from '../../lib/shopping/engine';
import type { PlaceScope, StoreMode } from './use-store-mode';
import type { StoreDetect } from './use-store-detect';
import styles from './shopping.module.css';

export const NO_STORE = '';

export function StoreSelector({ mode }: { mode: StoreMode }) {
  const { book, store, select } = mode;
  return (
    <div className={styles.storePicker} data-testid="store-selector">
      <Select
        label="Shopping at"
        value={store?.id ?? NO_STORE}
        onChange={(e) => select(e.target.value || null)}
        options={[
          { value: NO_STORE, label: 'No store: group by category' },
          ...book.stores.map((s) => ({ value: s.id, label: s.name })),
        ]}
        wrapperClassName={styles.storePickerField}
      />
      {book.stores.length === 0 && (
        <Link href="/settings/stores" className={styles.storeLink}>Set up your stores</Link>
      )}
      {store && <Link href="/settings/stores" className={styles.storeLink}>Edit aisles</Link>}
    </div>
  );
}

/** "Detect my store" + opt-in auto-detect while this page is open (P2-A, D396). The position never leaves the browser. */
export function DetectStore({ detect }: { detect: StoreDetect }) {
  return (
    <div className={styles.storePicker} data-testid="store-detect">
      <Button variant="secondary" size="sm" loading={detect.detecting} disabled={detect.fenceCount === 0} onClick={() => void detect.detectNow()} data-testid="detect-store">
        Detect my store
      </Button>
      {detect.fenceCount === 0 ? (
        <Link href="/settings/stores" className={styles.storeLink}>Add a location to a store first</Link>
      ) : (
        <Checkbox
          label="Detect automatically while this page is open"
          checked={detect.auto}
          onChange={(e) => detect.setAuto(e.target.checked)}
          data-testid="auto-detect"
        />
      )}
      {detect.fenceCount > 0 && (
        <p className={styles.pickerEmpty}>
          Your browser asks before sharing your location. It is compared with your saved stores here in the browser and is not sent to us. Detection stops when you leave this page; only the phone app can do it in the background.
        </p>
      )}
      {detect.message && <p role="status" data-testid="detect-message">{detect.message}</p>}
    </div>
  );
}

export function LearnToggle({ mode }: { mode: StoreMode }) {
  if (!mode.store) return null;
  return (
    <Checkbox
      label="Learn from my route"
      checked={mode.learn}
      onChange={(e) => mode.setLearn(e.target.checked)}
      data-testid="learn-route"
    />
  );
}

/** "You walked the aisles in a different order": suggest only, the user confirms. */
export function RouteSuggestion({ mode }: { mode: StoreMode }) {
  const s = mode.suggestion;
  if (!s || !mode.store) return null;
  return (
    <Card className={styles.routeCard} data-testid="route-suggestion">
      <CardBody>
        <p className={styles.routeText}>
          You went round {mode.store.name} in a different order from the list. Use this aisle order next time?
        </p>
        <p className={styles.routeOrder}>{s.labels.join(' > ')}</p>
        <div className={styles.formActions}>
          <Button variant="secondary" onClick={mode.dismissSuggestion}>Not now</Button>
          <Button onClick={() => void mode.applySuggestion()}>Update aisle order</Button>
        </div>
      </CardBody>
    </Card>
  );
}

/** Where is this item? Chips for the store's aisles; remembered for this store from now on. */
export function AislePickerSheet({
  mode, view, onClose,
}: {
  mode: StoreMode;
  view: ItemView | null;
  onClose: () => void;
}) {
  const store = mode.store;
  if (!view || !store) return null;
  return (
    <Sheet
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title={`Which aisle at ${store.name}?`}
      description={view.item.displayName}
    >
      <PickerBody key={view.item.id} mode={mode} view={view} store={store} onClose={onClose} />
    </Sheet>
  );
}

function PickerBody({ mode, view, store, onClose }: { mode: StoreMode; view: ItemView; store: Store; onClose: () => void }) {
  const current = mode.aisleOf(view);
  const hasIngredient = !!view.item.ingredientId;
  const [scope, setScope] = useState<PlaceScope>(hasIngredient ? 'ingredient' : 'item');
  const [newLabel, setNewLabel] = useState('');
  const [busy, setBusy] = useState(false);

  const choose = async (aisle: StoreAisle) => {
    onClose();
    await mode.place(view, aisle.id, scope);
  };
  const create = async (e: FormEvent) => {
    e.preventDefault();
    const label = newLabel.trim();
    if (!label) return;
    setBusy(true);
    const id = await mode.addAisle(label);
    setBusy(false);
    if (id) {
      onClose();
      await mode.place(view, id, scope);
    }
  };

  return (
    <div className={styles.pickerBody}>
      <fieldset className={styles.scope}>
        <legend>Remember this for</legend>
        <label className={styles.scopeOption}>
          <input type="radio" name="scope" checked={scope !== 'category'} onChange={() => setScope(hasIngredient ? 'ingredient' : 'item')} />
          <span>{hasIngredient ? `${view.item.displayName} (every time)` : `Just ${view.item.displayName}`}</span>
        </label>
        <label className={styles.scopeOption}>
          <input type="radio" name="scope" checked={scope === 'category'} onChange={() => setScope('category')} />
          <span>Everything in {view.item.category}</span>
        </label>
      </fieldset>

      {mode.aislesOfStore.length === 0 ? (
        <p className={styles.pickerEmpty}>This store has no aisles yet. Add the first one below.</p>
      ) : (
        <ul className={styles.chips} aria-label={`Aisles at ${store.name}`}>
          {mode.aislesOfStore.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                className={styles.chip}
                aria-pressed={current?.id === a.id}
                data-testid={`aisle-chip-${a.label}`}
                onClick={() => void choose(a)}
              >
                {a.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      <form className={styles.newAisle} onSubmit={(e) => void create(e)}>
        <Input label="New aisle" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="For example 7 or Frozen" maxLength={60} />
        <Button type="submit" variant="secondary" loading={busy} disabled={!newLabel.trim()}>Add and use</Button>
      </form>

      <div className={styles.formActions}>
        {current && (
          <Button
            variant="ghost"
            onClick={() => { onClose(); void mode.place(view, null, scope); }}
          >
            Clear aisle
          </Button>
        )}
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}
