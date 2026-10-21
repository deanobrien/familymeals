import React, { useCallback, useEffect, useState } from 'react';
import { AppState, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useApp } from '@/data/AppContext';
import type { ShoppingListState } from '@/data/DataSource';
import { formatQuantity } from '@/lib/format';
import { orderable, placementTarget } from '@/lib/storeBook';
import { emptyStoreBook, orderForStore, resolveAisle, sortedAisles, type StoreBook } from '@fr/engine/shopping';
import { useServerApi } from '@/data/ServerApiContext';
import type { ShoppingListItem } from '@/viewModels';
import { ShoppingListsBar } from './ShoppingListsSheet';
import VoiceAddSheet from './VoiceAddSheet';
import { cacheOpenCount } from '@/lib/geofence';
import { fencesOf, getLocations } from '@/lib/locationApi';
import { useStoreArrival } from '@/lib/useStoreArrival';
import { RestockBannerCard } from './pantry/Restock';
import { Button, EmptyState, ErrorState, ErrorText, Loading, MIN_TAP, Muted, Text, Toast, useStyles } from './ui';

type Row = { kind: 'header'; key: string; label: string } | { kind: 'item'; key: string; item: ShoppingListItem; aisle: string | null | undefined };

/** "1" -> "Aisle 1"; named aisles are shown as they are. */
const aisleTitle = (label: string) => (/^\d+[a-z]?$/i.test(label) ? `Aisle ${label}` : label);

export default function ShoppingListScreen() {
  const { ds, householdId, online, syncVersion } = useApp();
  const styles = useStyles();
  const api = useServerApi();
  const [book, setBook] = useState<StoreBook>(emptyStoreBook());
  const [storeId, setStoreId] = useState<string | null>(null);
  const [placingId, setPlacingId] = useState<string | null>(null);
  const [state, setState] = useState<ShoppingListState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [voiceOpen, setVoiceOpen] = useState(false);

  const drainConflicts = useCallback(() => {
    const c = ds.takeConflicts();
    if (c.length > 0) setToasts((t) => [...t, ...c.map((x) => x.message)]);
  }, [ds]);

  const refresh = useCallback(async () => {
    if (!householdId) return;
    try {
      setState(await ds.getShoppingList(householdId));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load shopping list');
    }
    drainConflicts();
    if (ds.getStoreBook) {
      try {
        const b = await ds.getStoreBook(householdId);
        setBook(b);
        const remembered = (await ds.getSelectedStoreId?.(householdId)) ?? null;
        setStoreId((cur) => {
          const want = cur ?? remembered;
          return want && b.stores.some((s) => s.id === want) ? want : null;
        });
      } catch {
        /* stores are optional: the list still works by category */
      }
    }
  }, [ds, householdId, drainConflicts]);

  useEffect(() => {
    void refresh();
  }, [refresh, syncVersion]);

  // Resync from the command-log cursor whenever the app returns to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // Live updates while this screen is mounted: Realtime hints (and a poll only while the feed is down) re-read the list.
  useEffect(() => {
    if (!householdId || !ds.watchShopping) return undefined;
    return ds.watchShopping(householdId, () => void refresh());
  }, [ds, householdId, refresh]);

  async function act(fn: () => Promise<unknown>) {
    setActionError(null);
    try {
      await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Something went wrong');
    }
    await refresh();
  }

  async function tick(itemId: string) {
    if (!householdId) return;
    // Optimistic: mark immediately so the tap feels instant, then reconcile with the data source.
    setState((s) =>
      s ? { ...s, items: s.items.map((i) => (i.id === itemId ? { ...i, ticked: true } : i)) } : s,
    );
    await act(() => ds.tickItem(householdId, itemId));
  }

  async function undo(itemId: string) {
    if (!householdId) return;
    await act(() => ds.undoTick(householdId, itemId));
  }

  async function sync() {
    await act(() => ds.flushPending());
  }

  function chooseStore(id: string | null) {
    setStoreId(id);
    setPlacingId(null);
    if (householdId) void ds.setSelectedStoreId?.(householdId, id);
  }

  async function place(item: ShoppingListItem, aisleId: string | null) {
    if (!householdId || !storeId || !ds.setPlacement) return;
    setPlacingId(null);
    await act(() => ds.setPlacement!(householdId, storeId, placementTarget(item), aisleId));
  }

  useStoreArrival({
    householdId,
    storeId,
    onArrive: (id, name) => {
      chooseStore(id);
      setToasts((t) => [...t, `Shopping at ${name}.`]);
    },
    ...(api.configured && householdId ? { fresh: async () => fencesOf(await getLocations(api, householdId)) } : {}),
  });
  // the background "near a store" nudge says how many items are open: keep that number on the device
  const openCount = state ? state.items.filter((i) => !i.ticked).length : null;
  useEffect(() => {
    if (householdId && openCount !== null) void cacheOpenCount(householdId, openCount);
  }, [householdId, openCount]);

  if (!householdId) return <EmptyState title="Pick a household first." />;
  if (!state) return error ? <ErrorState message={error} onRetry={refresh} /> : <Loading label="Loading shopping list" />;

  const pending = new Set(state.pendingItemIds);
  const store = book.stores.find((s) => s.id === storeId) ?? null;
  const storeAisles = store ? sortedAisles(store.id, book.aisles) : [];
  // Default: the list as the data source ordered it. With a store: aisle headers in walking order, "Not placed yet" last.
  const rows: Row[] = store
    ? orderForStore(state.items.map((i) => ({ item: orderable(i), li: i })), store, book.aisles, book.placements).flatMap((sec): Row[] => [
        { kind: 'header', key: `h-${sec.aisleId ?? 'none'}`, label: sec.aisleId ? aisleTitle(sec.label) : sec.label },
        ...sec.items.map((x): Row => ({ kind: 'item', key: x.li.id, item: x.li, aisle: sec.aisleId ? sec.label : null })),
      ])
    : state.items.map((i): Row => ({ kind: 'item', key: i.id, item: i, aisle: undefined }));

  return (
    <View style={styles.screen}>
      {!online && (
        <View style={styles.banner} accessibilityRole="alert" testID="offline-banner">
          <Text>You are offline. Ticks are saved on this phone and will sync when you reconnect.</Text>
        </View>
      )}
      <ErrorText message={error ?? actionError} />
      {api.configured && (
        <ShoppingListsBar
          api={api}
          householdId={householdId}
          version={syncVersion}
          beforeChange={async () => {
            try {
              await ds.flushPending(); // queued ticks land in the list they were made on
            } catch {
              /* offline: the server call below reports it */
            }
          }}
          onChanged={refresh}
        />
      )}
      {api.configured && <RestockBannerCard api={api} householdId={householdId} version={syncVersion} onAdded={refresh} />}
      {api.configured && (
        <>
          <Button title="Add by voice" variant="secondary" onPress={() => setVoiceOpen(true)} testID="voice-add-button" />
          <VoiceAddSheet
            api={api}
            householdId={householdId}
            open={voiceOpen}
            onClose={() => setVoiceOpen(false)}
            onAdded={(m) => {
              setToasts((t) => [...t, m]);
              void refresh();
            }}
          />
        </>
      )}
      {pending.size > 0 && (
        <View style={styles.banner}>
          <Text style={styles.pending} testID="pending-banner">
            {pending.size} change{pending.size === 1 ? '' : 's'} waiting to sync
          </Text>
          <Button title="Sync now" onPress={sync} testID="sync-now" variant="secondary" />
        </View>
      )}
      {book.stores.length > 0 && (
        <View accessibilityRole="radiogroup" accessibilityLabel="Shopping at" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingVertical: 8 }}>
          {[{ id: null as string | null, name: 'No store' }, ...book.stores].map((s) => (
            <Pressable
              key={s.id ?? 'none'}
              accessibilityRole="radio"
              accessibilityLabel={s.id ? `Shop at ${s.name}` : 'No store, group by category'}
              accessibilityState={{ selected: (s.id ?? null) === storeId }}
              onPress={() => chooseStore(s.id)}
              testID={`store-${s.id ?? 'none'}`}
              style={{ minHeight: MIN_TAP, minWidth: MIN_TAP, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 24, borderWidth: 2, borderColor: (s.id ?? null) === storeId ? '#2e7d32' : '#9e9e9e' }}
            >
              <Text style={{ fontWeight: (s.id ?? null) === storeId ? '700' : '400' }}>{s.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await refresh();
              setRefreshing(false);
            }}
          />
        }
        ListEmptyComponent={
          <EmptyState title="Your shopping list is empty." hint="Plan some meals on the web and the ingredients appear here." />
        }
        renderItem={({ item: row }) => {
          if (row.kind === 'header') {
            return (
              <Text accessibilityRole="header" style={{ fontWeight: '700', fontSize: 18, marginTop: 12 }} testID={row.key}>
                {row.label}
              </Text>
            );
          }
          const item = row.item;
          const qty = formatQuantity(item.quantity);
          return (
            <View>
            <View style={styles.row}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: item.ticked, disabled: item.ticked }}
                accessibilityLabel={`${item.displayName}, ${qty}, ${item.aisle}${item.ticked ? ', bought' : ''}`}
                accessibilityHint={item.ticked ? undefined : 'Double tap to mark as bought'}
                style={{ flex: 1, minHeight: MIN_TAP, justifyContent: 'center' }}
                disabled={item.ticked}
                onPress={() => tick(item.id)}
                testID={`item-${item.id}`}
              >
                <Text style={item.ticked ? { textDecorationLine: 'line-through' } : undefined}>
                  {item.ticked ? '[x] ' : '[ ] '}
                  {item.displayName}
                </Text>
                <Muted>
                  {qty} - {item.aisle}
                </Muted>
                {pending.has(item.id) && (
                  <Text style={styles.pending} testID={`pending-${item.id}`}>
                    Pending
                  </Text>
                )}
              </Pressable>
              {item.ticked && item.canUndo && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Undo ${item.displayName}`}
                  onPress={() => undo(item.id)}
                  style={{ minWidth: MIN_TAP, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
                  testID={`undo-${item.id}`}
                >
                  <Text style={styles.pending}>Undo</Text>
                </Pressable>
              )}
              {store && ds.setPlacement && !item.ticked && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={row.aisle ? `Change aisle for ${item.displayName}, now ${row.aisle}` : `Set aisle for ${item.displayName}`}
                  onPress={() => setPlacingId(placingId === item.id ? null : item.id)}
                  style={{ minWidth: MIN_TAP, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }}
                  testID={`place-${item.id}`}
                >
                  <Text style={styles.pending}>{row.aisle ? `Aisle ${row.aisle}` : 'Set aisle'}</Text>
                </Pressable>
              )}
            </View>
            {store && placingId === item.id && (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 8 }} accessibilityLabel={`Which aisle at ${store.name}?`}>
                {storeAisles.map((a) => (
                  <Pressable
                    key={a.id}
                    accessibilityRole="button"
                    accessibilityLabel={`Put ${item.displayName} in ${aisleTitle(a.label)}`}
                    onPress={() => place(item, a.id)}
                    style={{ minWidth: MIN_TAP, minHeight: MIN_TAP, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center', borderRadius: 24, borderWidth: 2, borderColor: resolveAisle(orderable(item), store.id, book.aisles, book.placements)?.id === a.id ? '#2e7d32' : '#9e9e9e' }}
                    testID={`aisle-${a.id}`}
                  >
                    <Text>{a.label}</Text>
                  </Pressable>
                ))}
                {storeAisles.length === 0 && <Muted>This store has no aisles yet. Add them on the web (Settings, Stores).</Muted>}
              </View>
            )}
            </View>
          );
        }}
      />
      <Toast message={toasts[0] ?? null} onDismiss={() => setToasts((t) => t.slice(1))} />
    </View>
  );
}
