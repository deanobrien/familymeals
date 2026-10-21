import React, { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { dateShort, dayShort } from '@/lib/plan/dates';
import { MEAL_LABEL, type BatchView, type BusyApplied, type LeftoverSuggestion, type SlotRef } from '@/lib/plan/types';
import { Button, MIN_TAP, Muted, Text, useStyles } from '../ui';
import { Chip, ChipRow, Section, Stepper } from './parts';

export function busyText(d: { skip: boolean; minutesAvailable: number | null }): string {
  const free = d.minutesAvailable === null ? '' : ` (about ${d.minutesAvailable} min free)`;
  return d.skip ? `Dinner skipped${free}` : `Busy${free}`;
}

const SOURCE: Record<string, string> = { manual: 'you marked it', device: 'phone calendar', ics: 'calendar link' };

/** Chips for the busy evenings a plan will honour, with where each came from (never an event title). */
export function BusyChips({ busy }: { busy: readonly BusyApplied[] }) {
  if (busy.length === 0) return null;
  return (
    <Section title="Busy evenings" testID="busy-chips">
      <ChipRow>
        {busy.map((d) => (
          <Chip key={d.date} label={`${dayShort(d.date)} ${dateShort(d.date)}: ${busyText(d)} (${d.sources.map((s) => SOURCE[s] ?? s).join(', ')})`} />
        ))}
      </ChipRow>
      <Muted>Busy evenings get a quick meal; an evening with almost no free time skips dinner. Change them with the Busy buttons on the week, or in Settings, Calendar.</Muted>
    </Section>
  );
}

/** Which stored meal could go in which empty slot this week. */
export function LeftoverSuggestions({ suggestions, onPlace }: { suggestions: readonly LeftoverSuggestion[]; onPlace: (s: LeftoverSuggestion) => void }) {
  if (suggestions.length === 0) return null;
  return (
    <Section title="Use what is already cooked" testID="leftover-suggestions">
      {suggestions.map((s) => (
        <View key={`${s.batchId}|${s.date}|${s.mealType}`} style={{ marginBottom: 8 }}>
          <Text style={{ fontWeight: '600' }}>{s.label}</Text>
          <Muted>{`${dayShort(s.date)} ${dateShort(s.date)} · ${s.reason}`}</Muted>
          <Button title="Add to plan" variant="secondary" onPress={() => onPlace(s)} accessibilityLabel={`Add ${s.label} to ${dayShort(s.date)}`} testID={`suggest-${s.batchId}-${s.date}`} />
        </View>
      ))}
      <Muted>No shopping is needed for these. The portions leave your fridge / freezer list when you mark the meal eaten.</Muted>
    </Section>
  );
}

/** Pick a stored meal for a slot: any batch with portions still free. */
export function LeftoverPicker({ slot, batches, onPick, onBack }: { slot: SlotRef; batches: readonly BatchView[]; onPick: (b: BatchView, portions: number) => void; onBack: () => void }) {
  const styles = useStyles();
  const usable = batches.filter((b) => b.portionsFree > 0);
  const [choice, setChoice] = useState<BatchView | null>(null);
  const [portions, setPortions] = useState(2);
  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled" testID="leftover-picker">
      <Text style={styles.title} accessibilityRole="header">Leftover or freezer meal</Text>
      <Muted>{`${MEAL_LABEL[slot.mealType]}, ${dayShort(slot.date)} ${dateShort(slot.date)}`}</Muted>
      {usable.length === 0 ? <Muted>Nothing stored yet. Mark a meal cooked with "Cook x2" or add one in the Pantry.</Muted> : null}
      {usable.map((b) => (
        <Pressable
          key={b.id}
          testID={`stored-${b.id}`}
          accessibilityRole="button"
          accessibilityLabel={`Choose ${b.title}`}
          accessibilityState={{ selected: choice?.id === b.id }}
          onPress={() => { setChoice(b); setPortions(Math.min(2, b.portionsFree)); }}
          style={[styles.row, { minHeight: MIN_TAP }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '600' }}>{`${b.storedIn === 'freezer' ? 'Freezer meal' : 'Leftovers'}: ${b.title}`}</Text>
            <Muted>{`${b.portionsFree} portion${b.portionsFree === 1 ? '' : 's'} free · ${b.useByLabel}`}</Muted>
          </View>
        </Pressable>
      ))}
      {choice ? (
        <View>
          <Stepper label="Portions" value={portions} min={1} max={choice.portionsFree} onChange={setPortions} />
          <Button title={`Put ${choice.title} in this slot`} onPress={() => onPick(choice, portions)} testID="stored-place" />
        </View>
      ) : null}
      <Button title="Back" variant="secondary" onPress={onBack} testID="stored-back" />
    </ScrollView>
  );
}
