'use client';

import { useEffect, useState, useTransition } from 'react';
import { Badge, Button, Input, Sheet } from '@fr/ui';
import type { ShoppingListInfo } from '../../lib/shopping/types';
import {
  archiveShoppingListAction, createShoppingListAction, renameShoppingListAction, switchShoppingListAction,
} from './actions';
import styles from './shopping.module.css';

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/**
 * The household's shopping lists (D263): one is active (the one you shop from), the rest are archived. Starting a new
 * list or switching archives the current one whole, nothing is deleted. `flush` sends any unsaved change first so it
 * lands in the list it was made on.
 */
export function ListsSheet({
  open, onOpenChange, lists, currentName, flush, onChanged,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  lists: ShoppingListInfo[];
  currentName: string;
  flush: () => Promise<void>;
  /** After a change: refresh the page data (a different list remounts the client). */
  onChanged: () => void;
}) {
  const active = lists.find((l) => l.status === 'active');
  const archived = lists.filter((l) => l.status === 'archived');
  const [rename, setRename] = useState(currentName);
  const [fresh, setFresh] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pending, start] = useTransition();
  useEffect(() => { if (open) { setRename(currentName); setError(null); setConfirmArchive(false); } }, [open, currentName]);

  function run(op: () => Promise<{ ok: true } | { ok: false; error: string }>, close = true) {
    setError(null);
    start(async () => {
      await flush();
      const res = await op();
      if (!res.ok) { setError(res.error); return; }
      setFresh('');
      setConfirmArchive(false);
      onChanged();
      if (close) onOpenChange(false);
    });
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Your shopping lists" description="You shop from one list at a time. Other lists are kept, not deleted.">
      <div className={styles.form} data-testid="lists-sheet">
        {error && <p role="alert" className={styles.listsError}>{error}</p>}

        <section className={styles.listsSection} aria-label="Current list">
          <h3 className={styles.listsHeading}>Current list</h3>
          {active ? (
            <>
              <Input label="List name" value={rename} maxLength={120} onChange={(e) => setRename(e.target.value)} data-testid="rename-input" />
              <div className={styles.formActions}>
                <Button variant="secondary" disabled={pending || !rename.trim() || rename.trim() === active.name} onClick={() => run(() => renameShoppingListAction(active.id, rename), false)}>
                  Rename
                </Button>
                {!confirmArchive
                  ? <Button variant="secondary" disabled={pending} onClick={() => setConfirmArchive(true)}>Put this list away</Button>
                  : (
                    <>
                      <span className={styles.listsHint}>It is kept, and your next item starts a fresh list.</span>
                      <Button variant="secondary" disabled={pending} onClick={() => setConfirmArchive(false)}>Keep it</Button>
                      <Button variant="danger" disabled={pending} onClick={() => run(() => archiveShoppingListAction())}>Put it away</Button>
                    </>
                  )}
              </div>
            </>
          ) : (
            <p className={styles.listsHint}>You have no current list. Your next item starts one.</p>
          )}
        </section>

        <section className={styles.listsSection} aria-label="Start a new list">
          <h3 className={styles.listsHeading}>Start a new list</h3>
          <Input label="New list name" value={fresh} maxLength={120} placeholder="For example: Weekend shop" onChange={(e) => setFresh(e.target.value)} data-testid="new-list-input" />
          <div className={styles.formActions}>
            <Button disabled={pending || !fresh.trim()} loading={pending} onClick={() => run(() => createShoppingListAction(fresh))}>Create new list</Button>
          </div>
        </section>

        {archived.length > 0 && (
          <section className={styles.listsSection} aria-label="Earlier lists">
            <h3 className={styles.listsHeading}>Earlier lists</h3>
            <ul className={styles.list} data-testid="archived-lists">
              {archived.map((l) => (
                <li key={l.id} className={styles.historyRow}>
                  <span className={styles.historyText}>
                    <span className={styles.name}>{l.name}</span>
                    <span className={styles.qty}>Last changed {fmtDate(l.updatedAt)}</span>
                  </span>
                  <Badge>Archived</Badge>
                  <Button size="sm" variant="secondary" disabled={pending} aria-label={`Switch to ${l.name}`} onClick={() => run(() => switchShoppingListAction(l.id))}>
                    Switch to this list
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  );
}
