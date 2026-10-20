'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Button, Card, CardBody, Checkbox, EmptyState, ShoppingCategoryHeader, formatPence, useToast } from '@fr/ui';
import type { ItemView, Quantity } from '../../lib/shopping/engine';
import { activeView, deriveAll, defaultEngineContext, groupByAisle } from '../../lib/shopping/engine';
import { formatAmount, formatQuantity } from '../../lib/shopping/format';
import { PRICE_KIND_LABEL, estimateBasket, type PriceBook } from '../../lib/shopping/prices';
import type { Notice, Transport } from '../../lib/shopping/controller';
import { useShopping } from '../../lib/shopping/use-shopping';
import { createSupabaseLiveFeed, type LiveFeed, type RealtimeClientLike } from '../../lib/shopping/live';
import { createSupabaseBrowserClient } from '../../lib/supabase/browser';
import { AISLES, type ShoppingListInfo, type SnapshotDto } from '../../lib/shopping/types';
import { generateShoppingFromPlan, snapshotShopping, syncShopping } from './actions';
import { ItemFormSheet, PartialSheet, type ItemFormValues } from './forms';
import { ItemRow } from './item-row';
import { ListsSheet } from './lists-sheet';
import styles from './shopping.module.css';

const transport: Transport = {
  sync: (commands, cursor, listId) => syncShopping(commands, cursor, listId),
  snapshot: () => snapshotShopping(),
};

const AISLE_ORDER: string[] = [...AISLES];

export function ShoppingClient({ initial, lists = [], planId, approvedPlanId, actorId, prices, realtimeHouseholdId }: {
  initial: SnapshotDto;
  /** The household's lists (SL1): the active one first, then archived ones. */
  lists?: ShoppingListInfo[];
  /** /shopping?plan=<id>: build the list from that approved plan once. */
  planId?: string;
  /** The household's latest approved plan (for the empty-state button). */
  approvedPlanId?: string;
  /** Signed-in member id (server household context). */
  actorId: string;
  prices: PriceBook;
  /** Set when the list lives in Supabase: subscribe to its command log instead of polling (D122). */
  realtimeHouseholdId?: string;
}) {
  const { toast } = useToast();
  const router = useRouter();
  const [showCompleted, setShowCompleted] = useState(false);
  const [partialFor, setPartialFor] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [listsOpen, setListsOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const onNotice = useCallback(
    (n: Notice) => {
      const what = n.itemName ?? 'that item';
      if (n.kind === 'conflict') {
        toast({ message: `Another shopper already bought ${what}, so your tick was not counted.`, tone: 'error', durationMs: 10000 });
      } else if (n.kind === 'dropped') {
        toast({ message: 'One change could not be saved and was discarded.', tone: 'error' });
      } else if (n.result?.reason === 'item_removed') {
        toast({ message: `${what} was removed from the list by someone else.`, tone: 'error' });
      } else if (n.result?.reason === 'incompatible_unit') {
        toast({ message: `That unit does not match ${what}. Nothing was recorded.`, tone: 'error' });
      } else if (n.result?.reason === 'already_voided') {
        /* second undo is harmless */
      } else {
        toast({ message: `A change to ${what} was not applied (${n.result?.reason ?? 'rejected'}).`, tone: 'error' });
      }
    },
    [toast],
  );

  const liveFeed = useMemo<LiveFeed | undefined>(() => {
    if (!realtimeHouseholdId) return undefined;
    try {
      return createSupabaseLiveFeed(createSupabaseBrowserClient() as unknown as RealtimeClientLike, realtimeHouseholdId);
    } catch {
      return undefined; // no public Supabase env in this bundle: keep polling
    }
  }, [realtimeHouseholdId]);
  const { controller, state, actor } = useShopping(initial, transport, onNotice, actorId, liveFeed);
  const ctx = defaultEngineContext;

  // "Generate from plan": /shopping?plan=<id>
  const generated = useRef<string | null>(null);
  useEffect(() => {
    if (!planId || generated.current === planId) return;
    generated.current = planId;
    void (async () => {
      try {
        const r = await generateShoppingFromPlan(planId);
        if (r.ok) {
          toast({ message: `Added ${r.lineCount} items from "${r.planName}".` });
          await controller.sync();
        } else {
          toast({ message: 'That plan could not be found or is not approved yet, so nothing was added.', tone: 'error' });
        }
      } catch {
        toast({ message: 'Could not reach the server to build the list from your plan.', tone: 'error' });
      }
      router.replace('/shopping');
    })();
  }, [planId, controller, router, toast]);

  const all = useMemo(() => deriveAll(state.view, ctx), [state.view, ctx]);
  const visible = useMemo(
    () => activeView(state.view, ctx, { includeComplete: showCompleted }),
    [state.view, ctx, showCompleted],
  );
  const groups = useMemo(() => groupByAisle(visible, AISLE_ORDER), [visible]);
  const basket = useMemo(() => estimateBasket(all, prices), [all, prices]);

  const live = all.filter((v) => !v.item.removed && !v.noLongerNeeded);
  const doneCount = live.filter((v) => v.status === 'complete' || v.status === 'over_purchased').length;

  const byId = (id: string | null): ItemView | null => (id ? all.find((v) => v.item.id === id) ?? null : null);
  const partialView = byId(partialFor);
  const editingView = byId(editingId);

  // ---- handlers ----
  const tick = (v: ItemView) => {
    const eventId = controller.tick(v.item.id);
    toast({
      message: `Bought ${v.item.displayName}.`,
      actionLabel: 'Undo',
      onAction: () => controller.undo(eventId),
      durationMs: 8000,
    });
  };
  const untick = (v: ItemView) => {
    for (const e of v.activeEvents) controller.undo(e.id);
  };
  const submitPartial = (v: ItemView, q: Quantity, pence?: number) => {
    const eventId = controller.purchase(v.item.id, q, pence);
    setPartialFor(null);
    toast({
      message: `Recorded ${formatQuantity(q)} of ${v.item.displayName}.`,
      actionLabel: 'Undo',
      onAction: () => controller.undo(eventId),
      durationMs: 8000,
    });
  };
  const add = (f: ItemFormValues) => {
    controller.addItem({
      displayName: f.displayName, category: f.category,
      ...(f.quantity ? { quantity: f.quantity } : {}),
      ...(f.notes ? { notes: f.notes } : {}),
    });
    setFormOpen(false);
  };
  const edit = (v: ItemView, f: ItemFormValues) => {
    const had = !!v.item.manualQuantity;
    controller.editItem(v.item.id, {
      displayName: f.displayName,
      category: f.category,
      notes: f.notes || null,
      ...(f.quantity ? { manualQuantity: f.quantity } : v.item.requirement && had ? { manualQuantity: null } : {}),
    });
    setEditingId(null);
    setFormOpen(false);
  };
  const remove = (v: ItemView) => {
    controller.removeItem(v.item.id);
    setEditingId(null);
    setFormOpen(false);
    toast({ message: `Removed ${v.item.displayName}.` });
  };

  // ---- purchased history ----
  const history = useMemo(() => {
    const rows: Array<{ id: string; item: ItemView; at: string; by: string; qty: string; price?: number }> = [];
    const views = new Map(all.map((v) => [v.item.id, v]));
    for (const id of [...state.view.eventOrder].reverse()) {
      const e = state.view.events[id];
      const item = e && !e.voidedBy ? views.get(e.shoppingListItemId) : undefined;
      if (!e || !item) continue;
      rows.push({
        id: e.id, item, at: e.createdAt, by: e.createdBy, qty: formatQuantity(e.quantity),
        ...(e.actualPricePence !== undefined ? { price: e.actualPricePence } : {}),
      });
    }
    return rows;
  }, [all, state.view]);

  const me = mounted ? actor() : '';
  const statusText =
    state.status === 'offline'
      ? `Offline${state.pendingCount ? ` - ${state.pendingCount} change${state.pendingCount === 1 ? '' : 's'} will sync when you are back online` : ''}`
      : state.status === 'syncing' || state.pendingCount > 0
        ? 'Syncing changes...'
        : 'All changes saved';

  const hasAnything = live.length > 0 || history.length > 0;

  return (
    <div data-hydrated={mounted} data-live={state.live ? 'true' : 'false'} data-testid="shopping-root">
      <div className={styles.listBar}>
        <Link href="/shopping/scan" className={`fr-btn fr-btn--primary fr-btn--lg ${styles.scanLink}`} data-testid="scan-list-link">
          <span aria-hidden="true">📷</span> Scan a handwritten list
        </Link>
        <span className={styles.listName} data-testid="list-name">{state.meta.listName ?? 'Shopping list'}</span>
        <Button variant="secondary" size="sm" onClick={() => setListsOpen(true)} data-testid="lists-button">Lists</Button>
      </div>
      <div className={styles.toolbar}>
        <Button onClick={() => { setEditingId(null); setFormOpen(true); }}>Add item</Button>
        <Checkbox
          label="Show completed items"
          checked={showCompleted}
          onChange={(e) => setShowCompleted(e.target.checked)}
        />
        <span className={styles.toolbarSpacer} />
        <span className={styles.status} role="status" data-testid="sync-status" data-status={state.status}>
          {statusText}
        </span>
      </div>

      {live.length > 0 && (
        <Card className={styles.basket}>
          <CardBody>
            <p className={styles.progress} data-testid="progress">{doneCount} of {live.length} items done</p>
            <div className={styles.basketTotal} data-testid="basket-total">
              {formatPence(basket.totalPence)} <Badge tone="warning">{basket.weakestKind ? 'estimate' : 'no prices'}</Badge>
            </div>
            <p className={styles.basketNote}>
              {basket.pricedCount > 0
                ? `Estimated cost of what is left (${PRICE_KIND_LABEL[basket.weakestKind ?? 'generic_estimate']} prices for ${basket.pricedCount} item${basket.pricedCount === 1 ? '' : 's'}).`
                : 'No prices known yet.'}
              {basket.unpricedCount > 0 && ` ${basket.unpricedCount} item${basket.unpricedCount === 1 ? ' has' : 's have'} no price and ${basket.unpricedCount === 1 ? 'is' : 'are'} not included.`}
            </p>
          </CardBody>
        </Card>
      )}

      {!hasAnything && (
        <EmptyState
          icon="cart"
          title="Your list is empty"
          description="Add an item, scan a handwritten list, or build the list from your meal plan."
          action={
            <>
              <Link href="/shopping/scan" className="fr-btn fr-btn--primary fr-btn--md" data-testid="empty-scan-link">
                <span aria-hidden="true">📷</span> Scan a handwritten list
              </Link>
              {approvedPlanId
                ? <Button variant="secondary" onClick={() => router.push(`/shopping?plan=${encodeURIComponent(approvedPlanId)}`)}>Generate from plan</Button>
                : <Button variant="secondary" onClick={() => router.push('/plan')}>Plan your week first</Button>}
            </>
          }
        />
      )}

      {hasAnything && groups.length === 0 && (
        <EmptyState icon="cart" title="Everything is ticked off" description="Nothing left to buy. Turn on completed items to review them." />
      )}

      {groups.map((g) => (
        <section key={g.group} aria-label={g.group}>
          <ShoppingCategoryHeader>{g.group}</ShoppingCategoryHeader>
          <ul className={styles.list}>
            {g.items.map((v) => (
              <ItemRow
                key={v.item.id}
                view={v}
                meta={state.meta}
                pending={state.pendingItemIds.has(v.item.id)}
                cost={basket.byItem[v.item.id]}
                onTick={tick}
                onUntick={untick}
                onPartial={(x) => setPartialFor(x.item.id)}
                onEdit={(x) => { setEditingId(x.item.id); setFormOpen(true); }}
              />
            ))}
          </ul>
        </section>
      ))}

      {history.length > 0 && (
        <section className={styles.history} aria-label="Purchased">
          <ShoppingCategoryHeader>Purchased ({history.length})</ShoppingCategoryHeader>
          <ul className={styles.list} data-testid="purchased-list">
            {history.map((h) => (
              <li key={h.id} className={styles.historyRow} data-testid="purchase-row" data-item-name={h.item.item.displayName}>
                <span className={styles.historyText}>
                  <span className={styles.name}>{h.item.item.displayName}</span>
                  <span className={styles.qty}>
                    {h.qty}
                    {h.price !== undefined && ` for ${formatPence(h.price)}`}
                    {mounted && ` · ${h.by === me ? 'you' : 'another shopper'} at ${new Date(h.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`}
                  </span>
                </span>
                {h.item.noLongerNeeded && <Badge>Bought, no longer needed</Badge>}
                {h.item.status === 'over_purchased' && !h.item.noLongerNeeded && (
                  <Badge tone="accent">Bought extra: {formatAmount(h.item.purchased - h.item.required, h.item.unit)}</Badge>
                )}
                <Button size="sm" variant="ghost" aria-label={`Undo purchase of ${h.item.item.displayName}`} onClick={() => controller.undo(h.id)}>
                  Undo
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <PartialSheet
        view={partialView}
        open={!!partialView}
        onOpenChange={(o) => { if (!o) setPartialFor(null); }}
        onSubmit={submitPartial}
      />
      <ListsSheet
        open={listsOpen}
        onOpenChange={setListsOpen}
        lists={lists}
        currentName={state.meta.listName ?? 'Shopping list'}
        flush={() => controller.sync()}
        onChanged={() => router.refresh()}
      />
      <ItemFormSheet
        open={formOpen}
        onOpenChange={(o) => { setFormOpen(o); if (!o) setEditingId(null); }}
        editing={editingView}
        onAdd={add}
        onEdit={edit}
        onRemove={remove}
      />
    </div>
  );
}
