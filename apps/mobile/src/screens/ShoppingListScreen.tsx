import React, { useCallback, useEffect, useState } from 'react';
import { AppState, FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useApp } from '@/data/AppContext';
import type { ShoppingListState } from '@/data/DataSource';
import { formatQuantity } from '@/lib/format';
import { Button, EmptyState, ErrorState, ErrorText, Loading, MIN_TAP, Muted, Text, Toast, useStyles } from './ui';

export default function ShoppingListScreen() {
  const { ds, householdId, online, syncVersion } = useApp();
  const styles = useStyles();
  const [state, setState] = useState<ShoppingListState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toasts, setToasts] = useState<string[]>([]);
  const [refreshing, setRefreshing] = useState(false);

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

  if (!householdId) return <EmptyState title="Pick a household first." />;
  if (!state) return error ? <ErrorState message={error} onRetry={refresh} /> : <Loading label="Loading shopping list" />;

  const pending = new Set(state.pendingItemIds);

  return (
    <View style={styles.screen}>
      {!online && (
        <View style={styles.banner} accessibilityRole="alert" testID="offline-banner">
          <Text>You are offline. Ticks are saved on this phone and will sync when you reconnect.</Text>
        </View>
      )}
      <ErrorText message={error ?? actionError} />
      {pending.size > 0 && (
        <View style={styles.banner}>
          <Text style={styles.pending} testID="pending-banner">
            {pending.size} change{pending.size === 1 ? '' : 's'} waiting to sync
          </Text>
          <Button title="Sync now" onPress={sync} testID="sync-now" variant="secondary" />
        </View>
      )}
      <FlatList
        data={state.items}
        keyExtractor={(i) => i.id}
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
        renderItem={({ item }) => {
          const qty = formatQuantity(item.quantity);
          return (
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
            </View>
          );
        }}
      />
      <Toast message={toasts[0] ?? null} onDismiss={() => setToasts((t) => t.slice(1))} />
    </View>
  );
}
