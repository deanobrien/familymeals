import React, { useState } from 'react';
import { Pressable, ScrollView } from 'react-native';
import { dateShort, dayShort } from '@/lib/plan/dates';
import { slotKey } from '@/lib/plan/ops';
import { MEAL_LABEL, type PlanEntry, type SlotRef } from '@/lib/plan/types';
import { Button, MIN_TAP, Muted, Text, useStyles } from '../ui';
import { Field, Stepper } from './parts';

export interface SlotEditorProps {
  slot: SlotRef;
  entry: PlanEntry;
  title: string;
  allSlots: SlotRef[];
  onServings: (n: number) => void;
  onSwap: () => void;
  onKind: (k: 'eating_out' | 'leftovers') => void;
  onNote: (t: string) => void;
  onMove: (to: SlotRef, mode: 'move' | 'duplicate') => void;
  onRemove: () => void;
  onBack: () => void;
}

const targetLabel = (s: SlotRef) => `${dayShort(s.date)} ${dateShort(s.date)}, ${MEAL_LABEL[s.mealType]}`;

/** Edit one slot: servings, swap, eating out / leftovers, note, move or duplicate to another slot, clear. */
export default function SlotEditor(p: SlotEditorProps) {
  const styles = useStyles();
  const [note, setNote] = useState(p.entry.note ?? '');
  const [moving, setMoving] = useState<'move' | 'duplicate' | null>(null);
  const targets = p.allSlots.filter((s) => slotKey(s) !== slotKey(p.slot));

  if (moving) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.title} accessibilityRole="header">{moving === 'move' ? 'Move to' : 'Duplicate to'}</Text>
        <Muted>{moving === 'move' ? 'If the target already has a meal, the two swap.' : 'The meal stays where it is and is copied.'}</Muted>
        {targets.map((s) => (
          <Pressable
            key={slotKey(s)}
            testID={`target-${slotKey(s)}`}
            accessibilityRole="button"
            accessibilityLabel={targetLabel(s)}
            onPress={() => p.onMove(s, moving)}
            style={[styles.row, { minHeight: MIN_TAP }]}
          >
            <Text>{targetLabel(s)}</Text>
          </Pressable>
        ))}
        <Button title="Cancel" variant="secondary" onPress={() => setMoving(null)} testID="move-cancel" />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">{p.title}</Text>
      <Muted>{`${MEAL_LABEL[p.slot.mealType]}, ${dayShort(p.slot.date)} ${dateShort(p.slot.date)}`}</Muted>
      {p.entry.kind === 'recipe' ? <Stepper label="Servings" value={p.entry.servings} min={1} max={99} onChange={p.onServings} /> : null}
      <Button title={p.entry.kind === 'recipe' ? 'Swap recipe' : 'Choose a recipe'} variant="secondary" onPress={p.onSwap} testID="slot-swap" />
      {p.entry.kind !== 'eating_out' ? <Button title="Mark eating out" variant="secondary" onPress={() => p.onKind('eating_out')} testID="slot-eating-out" /> : null}
      {p.entry.kind !== 'leftovers' ? <Button title="Mark leftovers" variant="secondary" onPress={() => p.onKind('leftovers')} testID="slot-leftovers" /> : null}
      <Field label="Note" value={note} onChangeText={setNote} maxLength={200} testID="slot-note" />
      <Button title="Save note" variant="secondary" onPress={() => p.onNote(note)} testID="slot-save-note" />
      {targets.length > 0 ? (
        <>
          <Button title="Move to another slot" variant="secondary" onPress={() => setMoving('move')} testID="slot-move" />
          <Button title="Duplicate to another slot" variant="secondary" onPress={() => setMoving('duplicate')} testID="slot-duplicate" />
        </>
      ) : null}
      <Button title="Remove from plan" variant="secondary" onPress={p.onRemove} testID="slot-remove" accessibilityHint="Clears this slot" />
      <Button title="Done" onPress={p.onBack} testID="slot-done" />
    </ScrollView>
  );
}
