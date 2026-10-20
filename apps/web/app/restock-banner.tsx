'use client';

// "3 items below your minimum - Add 4 tinned tomatoes, 1 olive oil -> Add all / choose" (PR1, D280-D289).
// Shown on /shopping (server-provided `initial`) and on Home (loads itself). Dismissal lasts until the set of suggestions changes.
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Button, useToast } from '@fr/ui';
import type { RestockBannerData } from '../lib/restock/types';
import { addRestockToListAction, getRestockBannerAction } from '../lib/server/restock/actions';
import s from './restock-banner.module.css';

const DISMISS_KEY = 'fr.restock.dismissed';
/** Fired after restock items were added, so an open shopping list can sync straight away. */
export const SHOPPING_CHANGED_EVENT = 'fr:shopping-changed';

function readDismissed(): string | null {
  try { return window.sessionStorage.getItem(DISMISS_KEY); } catch { return null; }
}
function writeDismissed(sig: string): void {
  try { window.sessionStorage.setItem(DISMISS_KEY, sig); } catch { /* storage unavailable: the banner just returns next visit */ }
}

export function RestockBanner({ initial }: { initial?: RestockBannerData | null }) {
  const { toast } = useToast();
  const [data, setData] = useState<RestockBannerData | null>(initial ?? null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getRestockBannerAction().then((d) => setData(d), () => undefined);
  }, []);
  useEffect(() => {
    setDismissed(readDismissed());
    if (initial === undefined) load();
  }, [initial, load]);

  if (!data || data.items.length === 0 || dismissed === data.signature) return null;

  const n = data.items.length;
  const addAll = async () => {
    setBusy(true);
    try {
      const res = await addRestockToListAction();
      if (res.ok) {
        toast(res.message ?? 'Added to your shopping list');
        window.dispatchEvent(new Event(SHOPPING_CHANGED_EVENT));
        load();
      } else {
        toast({ message: res.error, tone: 'error' });
      }
    } catch {
      toast({ message: 'Something went wrong. Please try again.', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={s.banner} aria-label="Restock suggestions" data-testid="restock-banner">
      <h2 className={s.title}>{n} item{n === 1 ? '' : 's'} below your minimum</h2>
      <p className={s.text}>Add {data.items.map((i) => `${i.quantityLabel} ${i.name}`).join(', ')}</p>
      {data.items.some((i) => i.checkQuantity) && <p className={s.muted}>Some quantities need a check: open the pantry to review them.</p>}
      <div className={s.actions}>
        <Button loading={busy} onClick={addAll}>{n === 1 ? 'Add to shopping list' : 'Add all to shopping list'}</Button>
        <Link className="fr-btn fr-btn--secondary fr-btn--md" href="/pantry#low-h">Choose items</Link>
        <Button variant="ghost" aria-label="Dismiss restock suggestions" onClick={() => { writeDismissed(data.signature); setDismissed(data.signature); }}>Dismiss</Button>
      </div>
    </section>
  );
}
