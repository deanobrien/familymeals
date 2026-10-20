// Minimum pantry stock on Android (PR1, D280-D289): the Running-low panel, the minimums list, the "Set minimum" form and the
// below-minimum banner for the shopping screen. All rules live on the server; this file renders what /api/pantry returns.
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Switch, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  UNIT_OPTIONS, addRestock, fetchRestockBanner, minimumError, parseQuantity,
  type MinimumPayload, type MinimumView, type RestockBannerModel, type RestockSuggestionView, type RestockViewModel,
} from '@/lib/pantryApi';
import type { ServerApi } from '@/lib/serverApi';
import IngredientPicker, { type IngredientHit } from '../IngredientPicker';
import { Button, ErrorText, MIN_TAP, Muted, Text, useStyles, useTheme } from '../ui';
import { Chip, ChipRow, Section } from './shared';

/* ---------- number stepper ---------- */
function Stepper({ label, value, onChange, testID }: { label: string; value: string; onChange: (v: string) => void; testID: string }) {
  const styles = useStyles();
  const theme = useTheme();
  const bump = (d: number) => onChange(String(Math.max(0, (parseQuantity(value) ?? 0) + d)));
  return (
    <View>
      <Muted>{label}</Muted>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${label}`} onPress={() => bump(-1)} testID={`${testID}-dec`}
          style={{ minWidth: MIN_TAP, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 24, fontWeight: '700' }}>-</Text>
        </Pressable>
        <TextInput style={[styles.input, { flex: 1, textAlign: 'center' }]} value={value} onChangeText={onChange} keyboardType="decimal-pad"
          placeholderTextColor={theme.muted} accessibilityLabel={label} testID={testID} />
        <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${label}`} onPress={() => bump(1)} testID={`${testID}-inc`}
          style={{ minWidth: MIN_TAP, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontSize: 24, fontWeight: '700' }}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/* ---------- Set / edit one minimum ---------- */
export default function MinimumForm({
  api, householdId, fixed, existing, defaultUnit, busy, onSubmit, onCancel, onRemove,
}: {
  api?: ServerApi;
  householdId?: string;
  /** A pantry row / existing minimum fixes the ingredient; without it the form asks (picker or free text). */
  fixed?: { name: string; ingredientId?: string };
  existing?: MinimumView;
  defaultUnit?: string;
  busy?: boolean;
  onSubmit: (p: MinimumPayload) => void;
  onCancel: () => void;
  onRemove?: () => void;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const [picked, setPicked] = useState<IngredientHit | null>(null);
  const [name, setName] = useState('');
  const [min, setMin] = useState(existing ? String(existing.minValue) : '');
  const [unit, setUnit] = useState(existing?.unit ?? defaultUnit ?? 'item');
  const [restockTo, setRestockTo] = useState(existing?.restockToValue !== undefined ? String(existing.restockToValue) : '');
  const [packValue, setPackValue] = useState(existing?.pack ? String(existing.pack.value) : '');
  const [packUnit, setPackUnit] = useState(existing?.pack?.unit ?? 'g');
  const [error, setError] = useState<string | null>(null);
  const title = fixed?.name ?? existing?.name ?? 'a minimum';

  function submit() {
    if (!fixed && !existing && !picked && !name.trim()) return setError('Choose an ingredient or type a name.');
    const m = parseQuantity(min);
    const r = restockTo.trim() ? parseQuantity(restockTo) : null;
    const p = packValue.trim() ? parseQuantity(packValue) : null;
    if (restockTo.trim() && r === null) return setError('Enter restock-to as a number, or leave it empty.');
    if (packValue.trim() && p === null) return setError('Enter the pack size as a number, or leave it empty.');
    const bad = minimumError(m, r, p);
    if (bad) return setError(bad);
    setError(null);
    const target = fixed ?? (existing ? { name: existing.name, ...(existing.ingredientId ? { ingredientId: existing.ingredientId } : {}) } : null);
    onSubmit({
      unit, min: m as number, restockTo: r, packValue: p, packUnit: p === null ? null : packUnit,
      ...(target ? { name: target.name, ...(target.ingredientId ? { ingredientId: target.ingredientId } : {}) }
        : picked ? { ingredientId: picked.id, name: picked.name } : { name: name.trim() }),
    });
  }

  return (
    <View style={styles.banner} testID="minimum-form">
      <Text style={{ fontWeight: '600', marginBottom: 6 }} accessibilityRole="header">
        {fixed || existing ? `Minimum for ${title}` : 'Add a minimum'}
      </Text>
      {!fixed && !existing && api && householdId ? (
        picked ? (
          <View style={{ marginBottom: 8 }}>
            <Text>Ingredient: {picked.name}</Text>
            <Button title="Choose a different ingredient" variant="secondary" onPress={() => setPicked(null)} testID="min-unpick" />
          </View>
        ) : (
          <View>
            <IngredientPicker api={api} householdId={householdId} onPick={setPicked} testIdPrefix="min-ingredient" />
            <Muted style={{ marginBottom: 4 }}>Not in the list? Type a name instead.</Muted>
            <TextInput style={styles.input} value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={theme.muted}
              accessibilityLabel="Item name" testID="min-name" maxLength={80} />
          </View>
        )
      ) : null}
      <Stepper label="Minimum to keep" value={min} onChange={setMin} testID="min-value" />
      <ChipRow>
        {UNIT_OPTIONS.map((u) => (
          <Chip key={u} label={u} selected={unit === u} onPress={() => setUnit(u)} testID={`min-unit-${u}`} accessibilityLabel={`Unit ${u}`} />
        ))}
      </ChipRow>
      <Stepper label="Restock to (optional)" value={restockTo} onChange={setRestockTo} testID="min-restock" />
      <Muted>Leave empty to top up to the minimum.</Muted>
      <Stepper label="Pack size (optional)" value={packValue} onChange={setPackValue} testID="min-pack" />
      {packValue.trim() ? (
        <ChipRow>
          {UNIT_OPTIONS.map((u) => (
            <Chip key={u} label={u} selected={packUnit === u} onPress={() => setPackUnit(u)} testID={`min-pack-unit-${u}`} accessibilityLabel={`Pack unit ${u}`} />
          ))}
        </ChipRow>
      ) : null}
      <ErrorText message={error} />
      <Button title="Save minimum" onPress={submit} disabled={busy} testID="min-save" />
      {onRemove ? <Button title="Remove minimum" variant="secondary" onPress={onRemove} disabled={busy} testID="min-remove" /> : null}
      <Button title="Cancel" variant="secondary" onPress={onCancel} testID="min-cancel" />
    </View>
  );
}

/* ---------- Running low ---------- */
function SuggestionCard({ s, busy, onAdd, onSnooze }: { s: RestockSuggestionView; busy: boolean; onAdd: (id: string) => void; onSnooze: (id: string) => void }) {
  const styles = useStyles();
  return (
    <View style={styles.banner} testID={`low-${s.parId}`}>
      <Text style={{ fontWeight: '600' }}>{s.name}</Text>
      <Muted>{s.explanation}</Muted>
      {s.notes.length > 0 ? <Muted>{s.notes.join('. ')}</Muted> : null}
      {s.checkQuantity ? <Text style={{ fontWeight: '600' }}>Check the quantity</Text> : null}
      <Button title={`Add ${s.quantityLabel}`} accessibilityLabel={`Add ${s.quantityLabel} ${s.name} to the shopping list`} disabled={busy} testID={`low-add-${s.parId}`} onPress={() => onAdd(s.parId)} />
      <Button title="Snooze 7 days" variant="secondary" accessibilityLabel={`Snooze ${s.name} for 7 days`} disabled={busy} testID={`low-snooze-${s.parId}`} onPress={() => onSnooze(s.parId)} />
    </View>
  );
}

export function RunningLowPanel({
  restock, busy, onAdd, onAddAll, onSnooze,
}: {
  restock: RestockViewModel;
  busy: boolean;
  onAdd: (parId: string) => void;
  onAddAll: () => void;
  onSnooze: (parId: string) => void;
}) {
  const { suggestions, willRunLow } = restock;
  return (
    <Section title={`Running low${suggestions.length > 0 ? ` (${suggestions.length})` : ''}`} testID="running-low-panel">
      {suggestions.length === 0 ? (
        <Muted>
          {restock.pars.length === 0
            ? 'Set a minimum on any item below (for example 6 tins of tomatoes) and we will suggest what to add to your shopping list when you run low.'
            : 'Nothing is below its minimum.'}
          {restock.snoozedCount > 0 ? ` ${restock.snoozedCount} snoozed.` : ''}
        </Muted>
      ) : (
        <>
          {suggestions.map((s) => <SuggestionCard key={s.parId} s={s} busy={busy} onAdd={onAdd} onSnooze={onSnooze} />)}
          {suggestions.length > 1 ? <Button title="Add all to shopping list" disabled={busy} testID="low-add-all" onPress={onAddAll} /> : null}
        </>
      )}
      {willRunLow.length > 0 ? (
        <View testID="will-run-low">
          <Text accessibilityRole="header" style={{ fontWeight: '700', marginTop: 8 }}>Will run low after this week&apos;s plan</Text>
          {willRunLow.map((s) => <SuggestionCard key={s.parId} s={s} busy={busy} onAdd={onAdd} onSnooze={onSnooze} />)}
        </View>
      ) : null}
    </Section>
  );
}

/* ---------- Minimums list + household setting ---------- */
export function MinimumsPanel({
  api, householdId, restock, busy, onSave, onRemove, onAutoAdd,
}: {
  api: ServerApi;
  householdId: string;
  restock: RestockViewModel;
  busy: boolean;
  onSave: (p: MinimumPayload) => void;
  onRemove: (id: string) => void;
  onAutoAdd: (on: boolean) => void;
}) {
  const styles = useStyles();
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  return (
    <Section title="Your minimums" testID="minimums-panel">
      {restock.pars.length === 0 ? <Muted>No minimums yet. Use &quot;Set minimum&quot; on an item, or add one for something you have run out of.</Muted> : null}
      {restock.pars.map((p) =>
        editingId === p.id ? (
          <MinimumForm key={p.id} existing={p} fixed={{ name: p.name, ...(p.ingredientId ? { ingredientId: p.ingredientId } : {}) }} busy={busy}
            onSubmit={(v) => { setEditingId(null); onSave(v); }} onCancel={() => setEditingId(null)} onRemove={() => { setEditingId(null); onRemove(p.id); }} />
        ) : (
          <View key={p.id} style={styles.row} testID={`minimum-${p.id}`}>
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600' }}>{p.name}</Text>
              <Muted>{p.label}</Muted>
              <Muted>{p.status}</Muted>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Change ${p.name} minimum`} testID={`minimum-edit-${p.id}`}
              onPress={() => { setAdding(false); setEditingId(p.id); }} style={{ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: 'center', paddingHorizontal: 12 }}>
              <Text style={{ fontWeight: '700' }}>Edit</Text>
            </Pressable>
          </View>
        ),
      )}
      {adding ? (
        <MinimumForm api={api} householdId={householdId} busy={busy} onSubmit={(v) => { setAdding(false); onSave(v); }} onCancel={() => setAdding(false)} />
      ) : (
        <Button title="Add a minimum" variant="secondary" testID="minimum-add" onPress={() => { setEditingId(null); setAdding(true); }} />
      )}
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text>Automatically add restock items to the shopping list</Text>
          <Muted>Off by default: below-minimum items are only suggested.</Muted>
        </View>
        <Switch value={restock.settings.autoAdd} disabled={busy} onValueChange={onAutoAdd}
          accessibilityLabel="Automatically add restock items to the shopping list" testID="restock-auto" />
      </View>
    </Section>
  );
}

/* ---------- Banner for the shopping screen ---------- */
export function RestockBannerCard({
  api, householdId, version, onAdded,
}: {
  api: ServerApi;
  householdId: string;
  /** Changes when the list changed elsewhere, so the suggestions are re-read. */
  version?: number;
  onAdded?: () => void;
}) {
  const styles = useStyles();
  const router = useRouter();
  const [banner, setBanner] = useState<RestockBannerModel | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBanner(await fetchRestockBanner(api, householdId));
    } catch {
      setBanner(null); // the banner is a convenience: never block the list
    }
  }, [api, householdId]);
  useEffect(() => {
    void load();
  }, [load, version]);

  async function addAll() {
    setBusy(true);
    setError(null);
    try {
      setMessage(await addRestock(api, householdId));
      onAdded?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
    await load();
    setBusy(false);
  }

  if (message && (!banner || banner.items.length === 0)) {
    return <View style={styles.banner} accessibilityRole="alert" testID="restock-done"><Text>{message}</Text></View>;
  }
  if (!banner || banner.items.length === 0 || dismissed === banner.signature) return null;
  const n = banner.items.length;
  return (
    <View style={styles.banner} testID="restock-banner" accessibilityLabel="Restock suggestions">
      <Text style={{ fontWeight: '700' }} accessibilityRole="header">{n} item{n === 1 ? '' : 's'} below your minimum</Text>
      <Text>Add {banner.items.map((i) => `${i.quantityLabel} ${i.name}`).join(', ')}</Text>
      {banner.items.some((i) => i.checkQuantity) ? <Muted>Some quantities need a check: open the pantry to review them.</Muted> : null}
      <ErrorText message={error} />
      <Button title={n === 1 ? 'Add to shopping list' : 'Add all to shopping list'} disabled={busy} testID="restock-add-all" onPress={() => void addAll()} />
      <Button title="Choose items" variant="secondary" testID="restock-choose" onPress={() => router.push('/pantry')} />
      <Button title="Dismiss" variant="secondary" accessibilityLabel="Dismiss restock suggestions" testID="restock-dismiss" onPress={() => setDismissed(banner.signature)} />
    </View>
  );
}
