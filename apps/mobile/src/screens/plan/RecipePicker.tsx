import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { dateShort, dayShort } from '@/lib/plan/dates';
import { formatPence } from '@/lib/plan/ops';
import { MEAL_LABEL, type RecipeLite, type SlotRef } from '@/lib/plan/types';
import { Button, EmptyState, MIN_TAP, Muted, Text, useStyles } from '../ui';
import { Field } from './parts';

/**
 * Searchable list of the household's recipes. A recipe that hits a hard exclusion is shown disabled with the reason, so
 * it can never be planned from here (the server refuses it as well).
 */
export default function RecipePicker({ slot, mode, recipes, onPick, onBack }: { slot: SlotRef; mode: 'add' | 'swap'; recipes: RecipeLite[]; onPick: (r: RecipeLite) => void; onBack: () => void }) {
  const styles = useStyles();
  const [q, setQ] = useState('');
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return recipes
      .filter((r) => !needle || r.title.toLowerCase().includes(needle) || r.tags.some((t) => t.toLowerCase().includes(needle)))
      .sort((a, b) => Number(b.mealTypes.includes(slot.mealType)) - Number(a.mealTypes.includes(slot.mealType)) || a.title.localeCompare(b.title));
  }, [recipes, q, slot.mealType]);

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">{mode === 'swap' ? 'Swap recipe' : 'Add a recipe'}</Text>
      <Muted>{`${MEAL_LABEL[slot.mealType]}, ${dayShort(slot.date)} ${dateShort(slot.date)}`}</Muted>
      <Field label="Search recipes" value={q} onChangeText={setQ} placeholder="Search your recipes" testID="recipe-search" />
      {list.length === 0 ? <EmptyState title="No saved recipes match that search." /> : null}
      {list.map((r) => {
        const blocked = r.excludedBy.length > 0;
        const detail = [
          r.dietCategory ?? 'recipe',
          r.totalMinutes ? `${r.totalMinutes} min` : '',
          r.costPerServingPence == null ? 'uncosted' : `${r.costPartial ? 'at least ' : ''}${formatPence(r.costPerServingPence)} per serving (estimate)`,
          !r.mealTypes.includes(slot.mealType) ? `not usually ${MEAL_LABEL[slot.mealType].toLowerCase()}` : '',
        ].filter(Boolean).join(' · ');
        return (
          <Pressable
            key={r.id}
            testID={`pick-${r.id}`}
            accessibilityRole="button"
            accessibilityLabel={`Select ${r.title}`}
            accessibilityHint={blocked ? `Not available: contains ${r.excludedBy.join(', ')}` : undefined}
            accessibilityState={{ disabled: blocked }}
            disabled={blocked}
            onPress={() => onPick(r)}
            style={[styles.row, { opacity: blocked ? 0.55 : 1, minHeight: MIN_TAP }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontWeight: '600' }}>{r.title}</Text>
              <Muted>{detail}</Muted>
              {blocked ? <Muted testID={`blocked-${r.id}`}>{`Excluded: contains ${r.excludedBy.join(', ')}`}</Muted> : null}
            </View>
          </Pressable>
        );
      })}
      <Button title="Back" variant="secondary" onPress={onBack} testID="picker-back" />
    </ScrollView>
  );
}
