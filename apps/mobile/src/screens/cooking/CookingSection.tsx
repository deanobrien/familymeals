import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { cookedLabel, ratingLabel } from '@fr/engine/cooking';
import type { RecipeCooking, RecipesApi } from '@/lib/recipesApi';
import { Button, ErrorText, Muted, Text, useStyles } from '../ui';
import { Section } from '../widgets';
import { MarkCookedForm } from './MarkCookedForm';

/** Recipe screen: household rating, last cooked, your rating, history with notes, mark as cooked, don't-suggest. */
export function CookingSection({
  recipes,
  householdId,
  recipeId,
  servings,
  averageRating,
  cooking: initial,
  onChanged,
}: {
  recipes: RecipesApi;
  householdId: string;
  recipeId: string;
  servings: number;
  averageRating: number | null;
  cooking: RecipeCooking | null;
  /** Something was saved: the screen reloads the recipe so the household rating is current. */
  onChanged?: () => void;
}) {
  const styles = useStyles();
  const [cooking, setCooking] = useState<RecipeCooking | null>(initial);
  const [open, setOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  useEffect(() => setCooking(initial), [initial]);

  const toggleNever = async () => {
    if (!cooking) return;
    setError(null);
    try {
      setCooking(await recipes.setDontSuggest(householdId, recipeId, !cooking.dontSuggest));
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update. Please try again.');
    }
  };

  return (
    <View testID="cooking-section">
      <Text style={styles.heading} accessibilityRole="header">
        Cooking
      </Text>
      <Text testID="cooked-summary">
        {cookedLabel(cooking, now)}
        {averageRating != null ? ` · Household rating ${ratingLabel(averageRating)}` : ''}
        {cooking?.myRating != null ? ` · You rated it ${cooking.myRating}/5` : ''}
      </Text>
      {flash ? (
        <Muted accessibilityRole="alert" testID="cooked-flash">
          {flash}
        </Muted>
      ) : null}
      <ErrorText message={error} />
      {open ? (
        <Section>
          <MarkCookedForm
            recipes={recipes}
            householdId={householdId}
            recipeId={recipeId}
            servings={servings}
            currentRating={cooking?.myRating ?? null}
            onCancel={() => setOpen(false)}
            onSaved={(c) => {
              setCooking(c);
              setOpen(false);
              setFlash('Saved. Thanks, that helps the planner.');
              onChanged?.();
            }}
          />
        </Section>
      ) : (
        <View>
          <Button
            title="Mark as cooked"
            onPress={() => {
              setOpen(true);
              setFlash(null);
            }}
            testID="mark-cooked"
          />
          {cooking ? (
            <Button
              title={cooking.dontSuggest ? 'Planner skips this (undo)' : "Don't suggest again"}
              variant="secondary"
              onPress={() => void toggleNever()}
              testID="dont-suggest"
            />
          ) : null}
        </View>
      )}
      {cooking && cooking.dontSuggestCount > 0 && !cooking.dontSuggest ? (
        <Muted>
          {cooking.dontSuggestCount} household member{cooking.dontSuggestCount === 1 ? '' : 's'} asked the planner not to suggest this.
        </Muted>
      ) : null}
      {cooking && cooking.history.length > 0 ? (
        <View testID="cook-history" style={{ marginTop: 6 }}>
          {cooking.history.map((h) => (
            <View key={h.id} style={styles.row} accessible>
              <View style={{ flex: 1 }}>
                <Text>
                  {new Date(h.cookedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })} · {h.servings} serving{h.servings === 1 ? '' : 's'} ·{' '}
                  {h.cookedBy ?? 'Someone'}
                  {h.rating != null ? ` · ${'★'.repeat(h.rating)}` : ''}
                </Text>
                {h.note ? (
                  <Muted>
                    &ldquo;{h.note.text}&rdquo; {h.note.isPrivate ? '(private)' : '(household)'}
                  </Muted>
                ) : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
