import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text as RNText, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ServerScreen } from '@/data/ServerApiContext';
import {
  acceptAdjustment, addItem, confirmItem, correctItem, dismissAdjustment, fetchPantry, removeItem, saveSettings,
  type PantryItemView, type PantrySettings, type PantryViewModel,
} from '@/lib/pantryApi';
import type { ServerApi } from '@/lib/serverApi';
import { Button, EmptyState, ErrorState, ErrorText, Loading, MIN_TAP, Muted, Text, Toast, useStyles } from '../ui';
import ItemForm, { type ItemFormValues } from './ItemForm';
import { AdjustmentsPanel, LeftoversPanel, SettingsPanel, SuggestionsPanel } from './Panels';
import { BadgeText, Section } from './shared';

export default function PantryScreen() {
  return <ServerScreen>{(api, householdId) => <PantryContent api={api} householdId={householdId} />}</ServerScreen>;
}

function PantryContent({ api, householdId }: { api: ServerApi; householdId: string }) {
  const styles = useStyles();
  const router = useRouter();
  const [view, setView] = useState<PantryViewModel | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    try {
      setView(await fetchPantry(api, householdId));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Could not load the pantry');
    }
  }, [api, householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Run a mutation: surface the server's message (or refusal, incl. the read-only 403 text), then refresh. */
  async function run(fn: () => Promise<string>, after?: () => void) {
    setBusy(true);
    setActionError(null);
    try {
      setToast(await fn());
      after?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Something went wrong');
    }
    await load();
    setBusy(false);
  }

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (loadError && !view) return <ErrorState message={loadError} onRetry={() => void load()} />;
  if (!view) return <Loading label="Loading your pantry" />;

  const scan = () => router.push('/pantry/scan');

  const submitAdd = (v: ItemFormValues) =>
    void run(
      () => addItem(api, householdId, {
        value: v.value, unit: v.unit, ...(v.ingredientId ? { ingredientId: v.ingredientId } : {}),
        ...(v.name ? { name: v.name } : {}), ...(v.expiry ? { expiry: v.expiry } : {}),
      }),
      () => setAdding(false),
    );
  const submitEdit = (id: string, v: ItemFormValues) =>
    void run(() => correctItem(api, householdId, { id, value: v.value, unit: v.unit, expiry: v.expiry }), () => setEditingId(null));
  const onSaveSettings = (s: PantrySettings) => void run(() => saveSettings(api, householdId, s));

  const renderRow = (item: PantryItemView) => {
    if (editingId === item.id) {
      return (
        <ItemForm
          key={item.id} api={api} householdId={householdId} mode="edit" busy={busy}
          initial={{ name: item.name, ...(item.value !== undefined ? { value: item.value } : {}), ...(item.unit ? { unit: item.unit } : {}), ...(item.expiry ? { expiry: item.expiry } : {}) }}
          onSubmit={(v) => submitEdit(item.id, v)} onCancel={() => setEditingId(null)}
        />
      );
    }
    return (
      <View key={item.id} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(128,128,128,0.3)' }} testID={`item-${item.id}`}>
        <Text style={{ fontWeight: '600' }}>{item.name}</Text>
        <Muted>{item.quantityLabel}</Muted>
        {item.expiryBadge ? <BadgeText badge={item.expiryBadge} testID={`badge-${item.id}`} /> : null}
        {item.stale ? <Muted>{item.confidenceMessage}</Muted> : null}
        {removingId === item.id ? (
          <View accessibilityRole="alert" testID={`remove-prompt-${item.id}`}>
            <Text>Remove {item.name} from the pantry?</Text>
            <Button title="Yes, remove" accessibilityLabel={`Yes, remove ${item.name}`} disabled={busy} testID={`remove-yes-${item.id}`} onPress={() => void run(() => removeItem(api, householdId, item.id), () => setRemovingId(null))} />
            <Button title="Keep it" variant="secondary" testID={`remove-no-${item.id}`} onPress={() => setRemovingId(null)} />
          </View>
        ) : (
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title="Edit" variant="secondary" accessibilityLabel={`Edit ${item.name}`} testID={`edit-${item.id}`} onPress={() => { setAdding(false); setEditingId(item.id); }} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Remove" variant="secondary" accessibilityLabel={`Remove ${item.name}`} testID={`remove-${item.id}`} onPress={() => setRemovingId(item.id)} />
            </View>
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={styles.screen} contentContainerStyle={{ paddingBottom: 96 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void onRefresh()} />}
        testID="pantry-scroll"
      >
        <RNText accessibilityRole="header" style={styles.title}>Pantry</RNText>
        <Button title="Scan groceries" onPress={scan} testID="scan-groceries" accessibilityHint="Photograph a shelf or scan barcodes to add stock" />
        <Button title={adding ? 'Close' : 'Add an item'} variant="secondary" onPress={() => { setEditingId(null); setAdding((a) => !a); }} testID="add-toggle" />
        <ErrorText message={actionError} />
        {loadError ? <ErrorText message={`Could not refresh: ${loadError}`} /> : null}
        {adding ? <ItemForm api={api} householdId={householdId} mode="add" busy={busy} onSubmit={submitAdd} onCancel={() => setAdding(false)} /> : null}

        {view.totalItems === 0 ? (
          <EmptyState title="Your pantry is empty." hint="Scan your groceries or add items by hand so recipes can use what you have." />
        ) : null}

        {view.staleItems.length > 0 ? (
          <Section title="Still have these?" testID="stale-panel">
            <Muted>These have not been checked for a while.</Muted>
            {view.staleItems.map((i) => (
              <View key={i.id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text>{i.name}</Text>
                  <Muted>{i.quantityLabel}</Muted>
                </View>
                <Pressable
                  accessibilityRole="button" accessibilityLabel={`Still have ${i.name}`} testID={`stale-confirm-${i.id}`}
                  disabled={busy} onPress={() => void run(() => confirmItem(api, householdId, i.id))}
                  style={{ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: 'center', paddingHorizontal: 12 }}
                >
                  <Text style={{ fontWeight: '700' }}>Confirm</Text>
                </Pressable>
              </View>
            ))}
          </Section>
        ) : null}

        <AdjustmentsPanel
          pending={view.pending} busy={busy}
          onAccept={(eventId, expiry) => void run(() => acceptAdjustment(api, householdId, eventId, expiry))}
          onDismiss={(eventId) => void run(() => dismissAdjustment(api, householdId, eventId))}
        />

        {view.expiring.length > 0 ? (
          <Section title="Expiring soon" testID="expiring-panel">
            {view.expiring.map((e) => (
              <View key={e.id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text>{e.name}</Text>
                  <Muted>{e.quantityLabel}</Muted>
                </View>
                <BadgeText badge={e.badge} testID={`expiring-badge-${e.id}`} />
              </View>
            ))}
          </Section>
        ) : null}

        <SuggestionsPanel suggestions={view.suggestions} onOpen={(id) => router.push(`/recipe/${id}`)} />

        {view.categories.length > 0 ? (
          <Section title={`Stock (${view.totalItems})`} testID="stock-panel">
            {view.categories.map((c) => {
              const closed = !!collapsed[c.category];
              return (
                <View key={c.category}>
                  <Pressable
                    accessibilityRole="button" accessibilityState={{ expanded: !closed }}
                    accessibilityLabel={`${c.label}, ${c.items.length} items, ${closed ? 'collapsed' : 'expanded'}`}
                    testID={`category-${c.category}`}
                    onPress={() => setCollapsed((s) => ({ ...s, [c.category]: !closed }))}
                    style={{ minHeight: MIN_TAP, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
                  >
                    <Text style={{ fontWeight: '700' }}>{c.label}</Text>
                    <Muted>{c.items.length} {closed ? '(show)' : '(hide)'}</Muted>
                  </Pressable>
                  {closed ? null : c.items.map(renderRow)}
                </View>
              );
            })}
          </Section>
        ) : null}

        <LeftoversPanel leftovers={view.leftovers} api={api} householdId={householdId} />
        <SettingsPanel key={`${view.settings.purchaseMode}-${view.settings.staleAfterDays}`} settings={view.settings} busy={busy} onSave={onSaveSettings} />
      </ScrollView>
      <Toast message={toast} onDismiss={() => setToast(null)} />
    </View>
  );
}
