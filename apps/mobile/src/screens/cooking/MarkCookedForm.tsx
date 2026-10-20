import React, { useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import type { MarkCookedInput, RecipeCooking, RecipesApi } from '@/lib/recipesApi';
import { MAX_SERVINGS } from '@/lib/servings';
import { MIN_TAP, Button, ErrorText, Muted, Text, useTheme } from '../ui';
import { Chip, ChipWrap, Field, Stepper } from '../widgets';

/** "Mark as cooked": servings, a 1-5 rating, a private (default) or household note, and "don't suggest again". */
export function MarkCookedForm({
  recipes,
  householdId,
  recipeId,
  servings: initial,
  currentRating,
  onSaved,
  onCancel,
}: {
  recipes: RecipesApi;
  householdId: string;
  recipeId: string;
  servings: number;
  currentRating: number | null;
  onSaved: (cooking: RecipeCooking) => void;
  onCancel?: () => void;
}) {
  const t = useTheme();
  const [servings, setServings] = useState(initial);
  const [rating, setRating] = useState<number | null>(currentRating);
  const [note, setNote] = useState('');
  const [isPrivate, setPrivate] = useState(true);
  const [never, setNever] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const input: MarkCookedInput = { servings, rating, note: note.trim() || null, notePrivate: isPrivate };
      const r = await recipes.markCooked(householdId, recipeId, input);
      if (!r.ok) {
        setError(Object.values(r.fieldErrors)[0] ?? r.message);
        return;
      }
      let cooking = r.cooking;
      if (never) cooking = await recipes.setDontSuggest(householdId, recipeId, true);
      onSaved(cooking);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View testID="mark-cooked-form">
      <Text style={{ fontWeight: '600', fontSize: 18, marginBottom: 6 }}>How did it go?</Text>
      <Stepper label="Servings cooked" value={servings} min={1} max={MAX_SERVINGS} onChange={setServings} testID="cooked-servings" />
      <Muted style={{ marginTop: 10 }}>Your rating</Muted>
      <View style={{ flexDirection: 'row' }} accessibilityRole="radiogroup">
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            testID={`rate-${n}`}
            accessibilityRole="radio"
            accessibilityLabel={`${n} star${n === 1 ? '' : 's'}`}
            accessibilityState={{ selected: rating === n }}
            onPress={() => setRating(rating === n ? null : n)}
            style={{ width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
          >
            <RNText style={{ fontSize: 30, color: t.primary }}>{rating !== null && n <= rating ? '★' : '☆'}</RNText>
          </Pressable>
        ))}
      </View>
      <Field label="Note for next time (optional)" value={note} onChangeText={setNote} placeholder="Less chilli next time" multiline testID="cook-note" />
      <Muted>Who can see the note</Muted>
      <ChipWrap>
        <Chip label="Only me" selected={isPrivate} onPress={() => setPrivate(true)} testID="note-private" />
        <Chip label="My household" selected={!isPrivate} onPress={() => setPrivate(false)} testID="note-household" />
      </ChipWrap>
      <Chip label="Don't suggest this recipe again" selected={never} onPress={() => setNever((v) => !v)} testID="never-suggest" />
      <ErrorText message={error} />
      <Button title={busy ? 'Saving...' : 'Save'} onPress={() => void save()} disabled={busy} testID="save-cooked" />
      {onCancel ? <Button title="Not now" variant="secondary" onPress={onCancel} disabled={busy} testID="cancel-cooked" /> : null}
    </View>
  );
}
