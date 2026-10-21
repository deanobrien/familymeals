import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, TextInput, View } from 'react-native';
import { ServerScreen } from '@/data/ServerApiContext';
import {
  addSpend, deleteSpend, fetchSpending, gbp, linkRetailer, poundsToPence, statusText, type SpendingView,
} from '@/lib/moneyApi';
import type { ServerApi } from '@/lib/serverApi';
import { shareSpendCsv, type CsvDeps, realCsvDeps } from '@/lib/spendingCsv';
import { Button, ErrorText, Loading, Muted, MIN_TAP, Text, useStyles, useTheme } from '../ui';
import { monthBars, SpendChart, weekBars } from './SpendChart';

const RANGES = [4, 12, 26, 52];

function Chip({ label, selected, onPress, testID }: { label: string; selected: boolean; onPress: () => void; testID?: string }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      testID={testID}
      style={{ minHeight: MIN_TAP, minWidth: MIN_TAP, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 24, borderWidth: 2, borderColor: selected ? t.primary : t.border }}
    >
      <Text style={{ fontWeight: selected ? '700' : '400' }}>{label}</Text>
    </Pressable>
  );
}

function StatusLine({ status, variance }: { status: Parameters<typeof statusText>[0]; variance: number | null }) {
  const t = useTheme();
  const colour = status === 'over' ? t.danger : t.text;
  const icon = status === 'over' ? '▲ ' : status === 'under' || status === 'so_far_within' ? '▼ ' : '• ';
  return <Text style={{ color: colour, fontWeight: '600' }} testID="budget-status">{icon}{statusText(status, variance)}</Text>;
}

export function SpendingBody({ api, householdId, csvDeps = realCsvDeps }: { api: ServerApi; householdId: string; csvDeps?: CsvDeps }) {
  const styles = useStyles();
  const [weeks, setWeeks] = useState(12);
  const [unit, setUnit] = useState<'week' | 'month'>('week');
  const [view, setView] = useState<SpendingView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [date, setDate] = useState('');
  const [amount, setAmount] = useState('');
  const [shop, setShop] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const v = await fetchSpending(api, householdId, weeks);
      setView(v);
      setDate((d) => d || v.today);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your spending.');
    }
  }, [api, householdId, weeks]);
  useEffect(() => { void load(); }, [load]);

  async function run(fn: () => Promise<void>, done: string) {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(done);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (!view && !error) return <Loading label="Loading your spending" />;
  if (!view) {
    return (
      <View style={styles.screen}>
        <ErrorText message={error} />
        <Button title="Try again" onPress={() => void load()} testID="spending-retry" />
      </View>
    );
  }
  const w = view.thisWeek;

  function submit() {
    const pence = poundsToPence(amount);
    if (pence === null) { setActionError('Enter an amount like 12.50.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setActionError('Enter the date as YYYY-MM-DD.'); return; }
    void run(async () => {
      await addSpend(api, householdId, { date, amountPence: pence, retailer: shop.trim() || null, category, note: note.trim() || null });
      setAmount(''); setNote('');
    }, 'Added.');
  }

  return (
    <ScrollView
      contentContainerStyle={{ padding: 16, paddingBottom: 48 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      testID="spending-screen"
    >
      <Text style={styles.title} accessibilityRole="header">Spending</Text>
      <Muted>Budget, what the plan is estimated to cost, and what you actually spent.</Muted>

      <View style={styles.banner} accessible testID="spending-summary">
        <Muted>Weekly budget</Muted>
        <Text style={{ fontSize: 22, fontWeight: '700' }} testID="budget-value">{view.weeklyBudgetPence === null ? 'Not set' : gbp(view.weeklyBudgetPence)}</Text>
        <Muted>Planned this week (estimate)</Muted>
        <Text style={{ fontSize: 18, fontWeight: '600' }} testID="planned-value">{w?.plannedPence == null ? 'No approved plan' : `${w.plannedPartial ? 'At least ' : ''}${gbp(w.plannedPence)}`}</Text>
        <Muted>Spent this week so far (actual)</Muted>
        <Text style={{ fontSize: 22, fontWeight: '700' }} testID="actual-value">{gbp(w?.actualPence ?? 0)}</Text>
        {w ? <StatusLine status={w.actualStatus} variance={w.varianceToBudgetPence} /> : null}
      </View>

      <Text style={styles.heading} accessibilityRole="header">Trend</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel="Group by" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
        <Chip label="Weekly" selected={unit === 'week'} onPress={() => setUnit('week')} testID="unit-week" />
        <Chip label="Monthly" selected={unit === 'month'} onPress={() => setUnit('month')} testID="unit-month" />
      </View>
      <View accessibilityRole="radiogroup" accessibilityLabel="Range" style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        {RANGES.map((r) => <Chip key={r} label={`${r} wk`} selected={weeks === r} onPress={() => setWeeks(r)} testID={`range-${r}`} />)}
      </View>
      <SpendChart rows={unit === 'week' ? weekBars(view.weeks) : monthBars(view.months)} />
      <Muted testID="range-total">
        Over {view.weeks.length} weeks: {gbp(view.totals.actualPence)} spent ({gbp(view.totals.receiptsPence)} receipts, {gbp(view.totals.manualPence)} entered by hand)
        {view.totals.plannedPence !== null ? `; plans estimated at ${view.totals.plannedPartial ? 'at least ' : ''}${gbp(view.totals.plannedPence)}` : ''}.
      </Muted>

      <Text style={styles.heading} accessibilityRole="header">Where it went</Text>
      {view.categories.length === 0 ? <Muted>Nothing recorded in this range yet.</Muted> : (
        <View testID="category-breakdown">
          {view.categories.map((c) => (
            <View key={c.category} style={{ marginVertical: 4 }} accessible accessibilityLabel={`${c.category}: ${gbp(c.pence)}, ${c.sharePct} percent`}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text>{c.category}</Text><Text>{gbp(c.pence)} ({c.sharePct}%)</Text></View>
              <View style={{ height: 8, borderRadius: 4, overflow: 'hidden' }}><View style={{ height: 8, width: `${Math.max(2, c.sharePct)}%`, backgroundColor: '#b4451f', borderRadius: 4 }} /></View>
            </View>
          ))}
          <Muted>&ldquo;Uncategorised&rdquo; is spend we could not tell: unmatched receipt lines, bags, or entries without a category.</Muted>
        </View>
      )}
      {view.shops.length > 0 && (
        <View style={{ marginTop: 8 }} testID="shop-breakdown">
          <Muted>By shop</Muted>
          {view.shops.map((s) => <View key={s.shop} style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text>{s.shop} ({s.trips})</Text><Text>{gbp(s.pence)}</Text></View>)}
        </View>
      )}

      {view.unlinked.length > 0 && (
        <View testID="unlinked-retailers">
          <Text style={styles.heading} accessibilityRole="header">Match receipts to your shops</Text>
          <Muted>Confirm which store each receipt shop is, so their prices are compared as one shop.</Muted>
          {view.unlinked.map((u) => (
            <View key={u.key} style={{ marginVertical: 6 }}>
              <Text style={{ fontWeight: '600' }}>{u.retailer} ({u.receipts} receipt{u.receipts === 1 ? '' : 's'})</Text>
              {u.suggestion ? (
                <Button title={`Yes, it is ${u.suggestion.name}`} variant="secondary" disabled={busy} testID={`link-${u.key}`}
                  onPress={() => void run(() => linkRetailer(api, householdId, u.retailer, u.suggestion!.id), `Linked to ${u.suggestion!.name}.`)} />
              ) : view.stores.length > 0 ? (
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }} accessibilityLabel={`Which store is ${u.retailer}?`}>
                  {view.stores.map((s) => (
                    <Pressable key={s.id} accessibilityRole="button" accessibilityLabel={`Link ${u.retailer} to ${s.name}`} disabled={busy}
                      onPress={() => void run(() => linkRetailer(api, householdId, u.retailer, s.id), `Linked to ${s.name}.`)}
                      style={{ minHeight: MIN_TAP, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 24, borderWidth: 2, borderColor: '#9e9e9e' }} testID={`link-${u.key}-${s.id}`}>
                      <Text>{s.name}</Text>
                    </Pressable>
                  ))}
                </View>
              ) : <Muted>Add your shops on the web (Settings, Stores) first.</Muted>}
            </View>
          ))}
        </View>
      )}

      <Text style={styles.heading} accessibilityRole="header">Add spending without a receipt</Text>
      <View testID="add-spend-form">
        <TextInput style={styles.input} value={date} onChangeText={setDate} placeholder="Date (YYYY-MM-DD)" accessibilityLabel="Date" testID="spend-date" autoCapitalize="none" />
        <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder="Amount in pounds, e.g. 12.50" accessibilityLabel="Amount in pounds" keyboardType="decimal-pad" testID="spend-amount" />
        <TextInput style={styles.input} value={shop} onChangeText={setShop} placeholder="Shop (optional)" accessibilityLabel="Shop" maxLength={80} testID="spend-shop" />
        <TextInput style={styles.input} value={note} onChangeText={setNote} placeholder="Note (optional)" accessibilityLabel="Note" maxLength={200} testID="spend-note" />
        <Muted>Category</Muted>
        <View accessibilityRole="radiogroup" accessibilityLabel="Category" style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <Chip label="Not sure" selected={category === null} onPress={() => setCategory(null)} />
          {view.categoryChoices.map((c) => <Chip key={c} label={c} selected={category === c} onPress={() => setCategory(c)} />)}
        </View>
        <Button title="Add spending" onPress={submit} disabled={busy} testID="add-spend" />
      </View>
      <ErrorText message={actionError} />
      {message ? <Muted accessibilityLiveRegion="polite" testID="spending-message">{message}</Muted> : null}

      <Text style={styles.heading} accessibilityRole="header">Recent</Text>
      {view.recent.length === 0 ? <Muted>No spending recorded yet.</Muted> : view.recent.map((r) => (
        <View key={r.id} style={styles.row} testID="spend-row">
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '600' }}>{r.shop ?? 'Shop not recorded'}</Text>
            <Muted>{r.date} · {r.source === 'receipt' ? 'Receipt' : 'Entered by hand'}{r.category ? ` · ${r.category}` : ''}{r.note ? ` · ${r.note}` : ''}</Muted>
          </View>
          <Text>{gbp(r.totalPence)}</Text>
          {r.source === 'manual' && (
            <Pressable accessibilityRole="button" accessibilityLabel={`Delete the ${gbp(r.totalPence)} entry from ${r.date}`} disabled={busy}
              onPress={() => void run(() => deleteSpend(api, householdId, r.id), 'Removed.')}
              style={{ minWidth: MIN_TAP, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center' }} testID={`delete-${r.id}`}>
              <Text style={styles.pending}>Delete</Text>
            </Pressable>
          )}
        </View>
      ))}
      <Button title="Share spending as CSV" variant="secondary" disabled={busy} testID="share-csv"
        onPress={() => void run(() => shareSpendCsv(api, householdId, 52, csvDeps), 'CSV ready to share.')} />

      {view.notes.map((n) => <Muted key={n}>{n}</Muted>)}
      {view.usedScanDate > 0 ? <Muted>{view.usedScanDate} receipt(s) have no printed date, so the scan day is used.</Muted> : null}
    </ScrollView>
  );
}

export default function SpendingScreen() {
  return <ServerScreen>{(api, householdId) => <SpendingBody api={api} householdId={householdId} />}</ServerScreen>;
}
