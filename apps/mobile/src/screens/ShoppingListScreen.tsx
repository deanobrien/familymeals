import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useApp } from '@/data/AppContext';
import type { ShoppingListState } from '@/data/DataSource';
import { formatQuantity } from '@/lib/format';
import { Button, ErrorText, styles } from './ui';

export default function ShoppingListScreen() {
  const { ds, householdId } = useApp();
  const [state, setState] = useState<ShoppingListState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!householdId) return;
    try {
      setState(await ds.getShoppingList(householdId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load shopping list');
    }
  }, [ds, householdId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function tick(itemId: string) {
    if (!householdId) return;
    // Optimistic: mark immediately so the tap feels instant, then reconcile.
    setState((s) =>
      s ? { ...s, items: s.items.map((i) => (i.id === itemId ? { ...i, ticked: true } : i)) } : s,
    );
    try {
      await ds.tickItem(householdId, itemId);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not tick item');
    }
    await refresh();
  }

  async function sync() {
    await ds.flushPending();
    await refresh();
  }

  if (!householdId) return <Text style={styles.muted}>Pick a household first.</Text>;
  if (!state) return error ? <ErrorText message={error} /> : <ActivityIndicator accessibilityLabel="Loading" />;

  const pending = new Set(state.pendingItemIds);

  return (
    <View style={styles.screen}>
      <ErrorText message={error} />
      {pending.size > 0 && (
        <View>
          <Text style={styles.pending} testID="pending-banner">
            {pending.size} change{pending.size === 1 ? '' : 's'} waiting to sync
          </Text>
          <Button title="Sync now" onPress={sync} testID="sync-now" />
        </View>
      )}
      <FlatList
        data={state.items}
        keyExtractor={(i) => i.id}
        ListEmptyComponent={<Text style={styles.muted}>Your shopping list is empty.</Text>}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: item.ticked }}
            accessibilityLabel={item.displayName}
            style={styles.row}
            disabled={item.ticked}
            onPress={() => tick(item.id)}
          >
            <View>
              <Text style={item.ticked ? { textDecorationLine: 'line-through' } : undefined}>
                {item.ticked ? '[x] ' : '[ ] '}
                {item.displayName}
              </Text>
              <Text style={styles.muted}>
                {formatQuantity(item.quantity)} - {item.aisle}
              </Text>
            </View>
            {pending.has(item.id) && (
              <Text style={styles.pending} testID={`pending-${item.id}`}>
                Pending
              </Text>
            )}
          </Pressable>
        )}
      />
    </View>
  );
}
