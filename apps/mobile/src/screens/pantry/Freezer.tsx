import React, { useState } from 'react';
import { View } from 'react-native';
import { localToday, type LeftoversClient } from '@/lib/leftoversApi';
import type { BatchView } from '@/lib/plan/types';
import { Button, ErrorText, Muted, Text } from '../ui';
import { Field } from '../widgets';
import { Chip, ChipRow, Section } from './shared';

function BatchRow({ b, client, busy, run }: { b: BatchView; client: LeftoversClient; busy: boolean; run: (fn: () => Promise<unknown>) => void }) {
  return (
    <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(128,128,128,0.3)' }} testID={`batch-${b.id}`}>
      <Text style={{ fontWeight: '600' }}>{b.title}</Text>
      <Muted>{`${b.portionsLeft} of ${b.portionsMade} portion${b.portionsMade === 1 ? '' : 's'} left${b.portionsPlanned > 0 ? ` · ${b.portionsPlanned} planned` : ''}`}</Muted>
      <Muted testID={`batch-useby-${b.id}`}>{b.status === 'past_use_by' ? `Past use-by (${b.useByLabel})` : b.status === 'use_soon' ? `${b.useByLabel} - soon` : b.useByLabel}</Muted>
      <ChipRow>
        <Button title="Ate 1" variant="secondary" disabled={busy} onPress={() => run(() => client.eat(b.id, 1, `tap-${b.id}-${Date.now()}`))} accessibilityLabel={`Ate one portion of ${b.title}`} testID={`ate-${b.id}`} />
        <Button title="Threw 1 away" variant="secondary" disabled={busy} onPress={() => run(() => client.discard(b.id, 1, `tap-${b.id}-${Date.now()}`))} accessibilityLabel={`Threw away one portion of ${b.title}`} testID={`discard-${b.id}`} />
        {b.storedIn === 'fridge' && b.status !== 'past_use_by' ? (
          <Button title="Move to freezer" variant="secondary" disabled={busy} onPress={() => run(() => client.freeze(b.id, localToday()))} accessibilityLabel={`Move ${b.title} to the freezer`} testID={`freeze-${b.id}`} />
        ) : null}
        <Button title="Remove" variant="secondary" disabled={busy} onPress={() => run(() => client.remove(b.id))} accessibilityLabel={`Remove ${b.title} from the list`} testID={`remove-${b.id}`} />
      </ChipRow>
    </View>
  );
}

/** Leftovers and freezer inventory (P2-C): batches from "Cook x2" or added by hand; portions come from the server ledger. */
export default function FreezerPanel({ client, batches, onChanged }: { client: LeftoversClient; batches: BatchView[]; onChanged: () => void }) {
  const [title, setTitle] = useState('');
  const [portions, setPortions] = useState('4');
  const [storedIn, setStoredIn] = useState<'fridge' | 'freezer'>('freezer');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = (fn: () => Promise<unknown>) => {
    void (async () => {
      setBusy(true);
      setError(null);
      try {
        await fn();
        onChanged();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      } finally {
        setBusy(false);
      }
    })();
  };

  const fridge = batches.filter((b) => b.storedIn === 'fridge');
  const freezer = batches.filter((b) => b.storedIn === 'freezer');
  return (
    <Section title="Leftovers and freezer" testID="freezer-panel">
      <Muted>Cooked extra? Mark a meal cooked with "Cook x2" and the spare portions land here, ready for a busy evening in the planner. Fridge leftovers are good for 2 days, freezer meals for 3 months.</Muted>
      {batches.length === 0 ? <Muted testID="no-stored">Nothing stored right now.</Muted> : null}
      {fridge.length > 0 ? (
        <View testID="fridge-list">
          <Text style={{ fontWeight: '700', marginTop: 6 }}>Fridge</Text>
          {fridge.map((b) => <BatchRow key={b.id} b={b} client={client} busy={busy} run={run} />)}
        </View>
      ) : null}
      {freezer.length > 0 ? (
        <View testID="freezer-list">
          <Text style={{ fontWeight: '700', marginTop: 6 }}>{`Freezer (${freezer.reduce((n, b) => n + b.portionsLeft, 0)} portions)`}</Text>
          {freezer.map((b) => <BatchRow key={b.id} b={b} client={client} busy={busy} run={run} />)}
        </View>
      ) : null}
      <Text style={{ fontWeight: '700', marginTop: 10 }}>Add a freezer or fridge meal</Text>
      <Field label="Meal" value={title} onChangeText={setTitle} placeholder="e.g. Chilli" testID="stored-title" />
      <Field label="Portions" value={portions} onChangeText={setPortions} keyboardType="numeric" testID="stored-portions" />
      <ChipRow>
        <Chip label="Freezer (3 months)" selected={storedIn === 'freezer'} onPress={() => setStoredIn('freezer')} testID="stored-freezer" />
        <Chip label="Fridge (2 days)" selected={storedIn === 'fridge'} onPress={() => setStoredIn('fridge')} testID="stored-fridge" />
      </ChipRow>
      <ErrorText message={error} />
      <Button
        title="Add"
        variant="secondary"
        disabled={busy || !title.trim()}
        onPress={() => run(async () => { await client.add({ title: title.trim(), portions: Number(portions), storedIn, today: localToday() }); setTitle(''); })}
        testID="stored-add"
      />
    </Section>
  );
}
