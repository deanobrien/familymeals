import React, { useState } from 'react';
import { Switch, TextInput, View } from 'react-native';
import {
  expiryError, parseQuantity, planLeftovers,
  type LeftoverPlanView, type PantrySettings, type PendingView, type PurchaseMode, type SuggestionView,
} from '@/lib/pantryApi';
import type { ServerApi } from '@/lib/serverApi';
import { Button, ErrorText, Muted, Text, useStyles, useTheme } from '../ui';
import { Chip, ChipRow, Section } from './shared';

/** Purchases waiting for the shopper's say-so (suggest mode): accept with an optional expiry, or dismiss. */
export function AdjustmentsPanel({
  pending, busy, onAccept, onDismiss,
}: {
  pending: PendingView[];
  busy: boolean;
  onAccept: (eventId: string, expiry?: string) => void;
  onDismiss: (eventId: string) => void;
}) {
  if (pending.length === 0) return null;
  return (
    <Section title={`Bought recently (${pending.length})`} testID="pending-panel">
      <Muted>Add these to your pantry?</Muted>
      {pending.map((p) => (
        <PendingRow key={p.eventId} p={p} busy={busy} onAccept={onAccept} onDismiss={onDismiss} />
      ))}
    </Section>
  );
}

function PendingRow({ p, busy, onAccept, onDismiss }: { p: PendingView; busy: boolean; onAccept: (id: string, expiry?: string) => void; onDismiss: (id: string) => void }) {
  const styles = useStyles();
  const theme = useTheme();
  const [expiry, setExpiry] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <View style={styles.banner} testID={`pending-${p.eventId}`}>
      <Text style={{ fontWeight: '600' }}>{p.name}, {p.quantityLabel}</Text>
      {p.reason ? <Muted>{p.reason}</Muted> : null}
      <TextInput
        style={[styles.input, { marginTop: 8 }]} value={expiry} onChangeText={setExpiry} placeholder="Expiry (YYYY-MM-DD), optional"
        placeholderTextColor={theme.muted} accessibilityLabel={`Expiry date for ${p.name}, optional`} testID={`pending-expiry-${p.eventId}`}
        autoCapitalize="none" keyboardType="numbers-and-punctuation" maxLength={10}
      />
      <ErrorText message={error} />
      <Button
        title="Add to pantry" accessibilityLabel={`Add ${p.name} to pantry`} disabled={busy} testID={`accept-${p.eventId}`}
        onPress={() => {
          const bad = expiryError(expiry);
          if (bad) return setError(bad);
          setError(null);
          onAccept(p.eventId, expiry.trim() || undefined);
        }}
      />
      <Button title="Dismiss" variant="secondary" accessibilityLabel={`Dismiss ${p.name}`} disabled={busy} testID={`dismiss-${p.eventId}`} onPress={() => onDismiss(p.eventId)} />
    </View>
  );
}

const MODES: Array<{ mode: PurchaseMode; label: string; hint: string }> = [
  { mode: 'off', label: 'Off', hint: 'Shopping does not change your pantry.' },
  { mode: 'suggest', label: 'Suggest', hint: 'You choose which purchases to add.' },
  { mode: 'auto', label: 'Auto', hint: 'Exact purchases are added automatically.' },
];

/** Post-purchase mode and the "check this is still here" threshold. */
export function SettingsPanel({ settings, busy, onSave }: { settings: PantrySettings; busy: boolean; onSave: (s: PantrySettings) => void }) {
  const styles = useStyles();
  const theme = useTheme();
  const [mode, setMode] = useState<PurchaseMode>(settings.purchaseMode);
  const [days, setDays] = useState(String(settings.staleAfterDays));
  const [error, setError] = useState<string | null>(null);
  const dirty = mode !== settings.purchaseMode || days.trim() !== String(settings.staleAfterDays);
  return (
    <Section title="Pantry settings" testID="settings-panel">
      <Text>After I shop</Text>
      <ChipRow>
        {MODES.map((m) => (
          <Chip key={m.mode} label={m.label} selected={mode === m.mode} onPress={() => setMode(m.mode)} testID={`mode-${m.mode}`} accessibilityLabel={`${m.label}. ${m.hint}`} />
        ))}
      </ChipRow>
      <Muted style={{ marginBottom: 8 }}>{MODES.find((m) => m.mode === mode)?.hint}</Muted>
      <Text>Ask me to re-check an item after (days)</Text>
      <TextInput
        style={[styles.input, { marginTop: 6 }]} value={days} onChangeText={setDays} keyboardType="number-pad"
        placeholderTextColor={theme.muted} accessibilityLabel="Stale after days" testID="stale-days" maxLength={3}
      />
      <ErrorText message={error} />
      <Button
        title="Save settings" disabled={busy || !dirty} testID="settings-save"
        onPress={() => {
          const n = parseQuantity(days);
          if (n === null || !Number.isInteger(n) || n < 1 || n > 730) return setError('Enter a whole number of days between 1 and 730.');
          setError(null);
          onSave({ purchaseMode: mode, staleAfterDays: n });
        }}
      />
    </Section>
  );
}

/** "Use what I have": recipes ranked by how much of them the pantry already covers. */
export function SuggestionsPanel({ suggestions, onOpen }: { suggestions: SuggestionView[]; onOpen: (recipeId: string) => void }) {
  const styles = useStyles();
  if (suggestions.length === 0) return null;
  return (
    <Section title="Use what I have" testID="suggestions-panel">
      {suggestions.map((s) => (
        <View key={s.recipeId} style={styles.banner} testID={`suggestion-${s.recipeId}`}>
          <Button title={s.title} variant="secondary" accessibilityLabel={`Open ${s.title}`} accessibilityHint="Opens the recipe" onPress={() => onOpen(s.recipeId)} testID={`open-${s.recipeId}`} />
          <Text style={{ fontWeight: '600' }}>{s.coveragePct}% covered</Text>
          {s.headline ? <Muted>{s.headline}</Muted> : null}
          {s.covered.length ? <Muted>Have: {s.covered.join(', ')}</Muted> : null}
          {s.missing.length ? <Muted>Missing: {s.missing.join(', ')}</Muted> : null}
        </View>
      ))}
    </Section>
  );
}

function LeftoverCard({ l }: { l: LeftoverPlanView }) {
  const styles = useStyles();
  return (
    <View style={styles.banner} testID={`leftover-${l.key}`}>
      <Text style={{ fontWeight: '600' }}>{l.title}</Text>
      <Muted>{l.summary}</Muted>
      {l.suggestions.map((s) => <Muted key={s}>- {s}</Muted>)}
      {l.advice.map((a) => <Muted key={a}>{a}</Muted>)}
    </View>
  );
}

/** Current batches plus an ad-hoc planner for something cooked today (not a mutation: nothing is saved). */
export function LeftoversPanel({ leftovers, api, householdId }: { leftovers: LeftoverPlanView[]; api: ServerApi; householdId: string }) {
  const styles = useStyles();
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [cooked, setCooked] = useState('');
  const [eaten, setEaten] = useState('0');
  const [keep, setKeep] = useState('');
  const [freezable, setFreezable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plan, setPlan] = useState<LeftoverPlanView | null>(null);

  async function submit() {
    const c = parseQuantity(cooked);
    const e = parseQuantity(eaten);
    const k = keep.trim() ? parseQuantity(keep) : undefined;
    if (!title.trim()) return setError('Name the meal.');
    if (c === null || e === null || !Number.isInteger(c) || !Number.isInteger(e) || c < 0 || e < 0) return setError('Portions must be whole numbers.');
    if (e > c) return setError('You cannot have eaten more than you cooked.');
    if (k === null || (k !== undefined && (!Number.isInteger(k) || k < 1))) return setError('Keep days must be a whole number.');
    setError(null);
    setBusy(true);
    try {
      setPlan(await planLeftovers(api, householdId, { title: title.trim(), portionsCooked: c, portionsEaten: e, ...(k ? { keepDays: k } : {}), ...(freezable ? { freezable: true } : {}) }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not plan leftovers');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Leftovers" testID="leftovers-panel">
      {leftovers.map((l) => <LeftoverCard key={l.key} l={l} />)}
      {leftovers.length === 0 ? <Muted>No leftovers tracked right now.</Muted> : null}
      <Button title={open ? 'Hide planner' : 'Plan leftovers'} variant="secondary" onPress={() => setOpen((o) => !o)} testID="leftovers-toggle" accessibilityHint="Works out when to eat what you cooked" />
      {open ? (
        <View style={styles.banner} testID="leftovers-form">
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="What did you cook?" placeholderTextColor={theme.muted} accessibilityLabel="Meal name" testID="lo-title" maxLength={80} />
          <TextInput style={styles.input} value={cooked} onChangeText={setCooked} keyboardType="number-pad" placeholder="Portions cooked" placeholderTextColor={theme.muted} accessibilityLabel="Portions cooked" testID="lo-cooked" maxLength={3} />
          <TextInput style={styles.input} value={eaten} onChangeText={setEaten} keyboardType="number-pad" placeholder="Portions eaten" placeholderTextColor={theme.muted} accessibilityLabel="Portions eaten" testID="lo-eaten" maxLength={3} />
          <TextInput style={styles.input} value={keep} onChangeText={setKeep} keyboardType="number-pad" placeholder="Keeps for (days), optional" placeholderTextColor={theme.muted} accessibilityLabel="Keeps for days, optional" testID="lo-keep" maxLength={2} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, marginBottom: 8 }}>
            <Text>Can be frozen</Text>
            <Switch value={freezable} onValueChange={setFreezable} accessibilityLabel="Can be frozen" testID="lo-freezable" />
          </View>
          <ErrorText message={error} />
          <Button title="Work it out" onPress={() => void submit()} disabled={busy} testID="lo-submit" />
          {plan ? <LeftoverCard l={plan} /> : null}
        </View>
      ) : null}
    </Section>
  );
}
