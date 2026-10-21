import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { ServerScreen } from '@/data/ServerApiContext';
import { addPrice, fetchPriceHistory, gbp, poundsToPence, type PriceHistoryView } from '@/lib/moneyApi';
import type { ServerApi } from '@/lib/serverApi';
import { Button, ErrorText, Loading, Muted, MIN_TAP, Text, useStyles, useTheme } from '../ui';

const UNITS = ['g', 'kg', 'ml', 'l', 'item', 'pack', 'can'];

export function PriceHistoryBody({ api, householdId, ingredientId }: { api: ServerApi; householdId: string; ingredientId: string }) {
  const styles = useStyles();
  const t = useTheme();
  const [view, setView] = useState<PriceHistoryView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [retailer, setRetailer] = useState('');
  const [price, setPrice] = useState('');
  const [size, setSize] = useState('');
  const [unit, setUnit] = useState('g');

  const load = useCallback(async () => {
    try { setView(await fetchPriceHistory(api, householdId, ingredientId)); setError(null); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load prices.'); }
  }, [api, householdId, ingredientId]);
  useEffect(() => { void load(); }, [load]);

  if (!view && !error) return <Loading label="Loading prices" />;
  if (!view) return <View style={styles.screen}><ErrorText message={error} /><Button title="Try again" onPress={() => void load()} /></View>;
  const c = view.comparison;

  async function save() {
    const pence = poundsToPence(price);
    const value = Number(size);
    if (pence === null) { setActionError('Enter the price like 1.25.'); return; }
    if (!(value > 0)) { setActionError('Enter the pack size, for example 500 and g.'); return; }
    if (!storeId && !retailer.trim()) { setActionError('Say which shop it was.'); return; }
    setBusy(true); setActionError(null); setMessage(null);
    try {
      await addPrice(api, householdId, { ingredientId, storeId, retailer: storeId ? null : retailer.trim(), pricePence: pence, packValue: value, packUnit: unit });
      setMessage('Price saved.'); setPrice(''); setSize('');
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not save that price.');
    } finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled" testID="price-history-screen">
      <Text style={styles.title} accessibilityRole="header">{view.name}: prices by shop</Text>
      {c.badge ? <Text style={{ fontWeight: '700', color: t.primary }} testID="price-badge">{c.badge}{c.savingPct !== null && c.savingPct > 0 && !c.tied ? ` (about ${c.savingPct}% less per unit than the dearest shop)` : ''}</Text> : null}
      {c.note ? <Muted testID="price-note">{c.note}</Muted> : null}
      {c.shops.map((s) => (
        <View key={s.label} style={styles.row} testID="shop-price" accessible accessibilityLabel={`${s.label}${s.cheapest ? ', cheapest' : ''}: ${gbp(s.pricePence)}${s.packLabel ? ` for ${s.packLabel}` : ''}, ${s.unitText ?? 'pack size unknown'}, ${s.ageText}`}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '600' }}>{s.label}{s.cheapest ? ' ✓ cheapest' : ''}</Text>
            <Muted>{s.observedOn} ({s.ageText}){s.stale ? ' · old, not used for the comparison' : ''} · seen {s.count}x · {s.kind === 'user_confirmed' ? 'you entered it' : 'receipt'}</Muted>
          </View>
          <View style={{ alignItems: 'flex-end' }}><Text>{gbp(s.pricePence)}{s.packLabel ? ` / ${s.packLabel}` : ''}</Text><Muted>{s.unitText ?? 'pack size unknown'}</Muted></View>
        </View>
      ))}
      <Muted>Only your own confirmed receipts and the prices you enter count. Prices from the last 60 days are compared.</Muted>

      <Text style={styles.heading} accessibilityRole="header">History</Text>
      {view.history.length === 0 ? <Muted>Nothing recorded yet.</Muted> : view.history.map((h, i) => (
        <View key={i} style={styles.row}>
          <View style={{ flex: 1 }}><Text style={{ fontWeight: '600' }}>{h.label}</Text><Muted>{h.observedOn} ({h.ageText}) · {h.kind === 'user_confirmed' ? 'you entered it' : 'confirmed receipt'}</Muted></View>
          <View style={{ alignItems: 'flex-end' }}><Text>{gbp(h.pricePence)}{h.packLabel ? ` / ${h.packLabel}` : ''}</Text><Muted>{h.unitText ?? ''}</Muted></View>
        </View>
      ))}

      <Text style={styles.heading} accessibilityRole="header">Add a price you saw</Text>
      {view.stores.length > 0 && (
        <View accessibilityRole="radiogroup" accessibilityLabel="Store" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          {[{ id: null as string | null, name: 'Another shop' }, ...view.stores].map((s) => (
            <Pressable key={s.id ?? 'other'} accessibilityRole="radio" accessibilityState={{ selected: storeId === s.id }} accessibilityLabel={s.name} onPress={() => setStoreId(s.id)}
              style={{ minHeight: MIN_TAP, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 24, borderWidth: 2, borderColor: storeId === s.id ? t.primary : t.border }} testID={`price-store-${s.id ?? 'other'}`}>
              <Text style={{ fontWeight: storeId === s.id ? '700' : '400' }}>{s.name}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {!storeId && <TextInput style={styles.input} value={retailer} onChangeText={setRetailer} placeholder="Shop name" accessibilityLabel="Shop name" maxLength={80} testID="price-retailer" />}
      <TextInput style={styles.input} value={price} onChangeText={setPrice} placeholder="Price in pounds, e.g. 1.25" accessibilityLabel="Price in pounds" keyboardType="decimal-pad" testID="price-amount" />
      <TextInput style={styles.input} value={size} onChangeText={setSize} placeholder="Pack size, e.g. 500" accessibilityLabel="Pack size" keyboardType="decimal-pad" testID="price-size" />
      <View accessibilityRole="radiogroup" accessibilityLabel="Unit" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        {UNITS.map((u) => (
          <Pressable key={u} accessibilityRole="radio" accessibilityState={{ selected: unit === u }} accessibilityLabel={u} onPress={() => setUnit(u)}
            style={{ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: 'center', alignItems: 'center', borderRadius: 24, borderWidth: 2, borderColor: unit === u ? t.primary : t.border }} testID={`price-unit-${u}`}>
            <Text style={{ fontWeight: unit === u ? '700' : '400' }}>{u}</Text>
          </Pressable>
        ))}
      </View>
      <Button title="Save price" onPress={() => void save()} disabled={busy} testID="save-price" />
      <ErrorText message={actionError} />
      {message ? <Muted accessibilityLiveRegion="polite" testID="price-message">{message}</Muted> : null}
    </ScrollView>
  );
}

export default function PriceHistoryScreen({ ingredientId }: { ingredientId: string }) {
  return <ServerScreen>{(api, householdId) => <PriceHistoryBody api={api} householdId={householdId} ingredientId={ingredientId} />}</ServerScreen>;
}
