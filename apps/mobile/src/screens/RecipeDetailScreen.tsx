import React, { useCallback, useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { NutrientKey } from '@fr/domain';
import type { Recipe } from '@/viewModels';
import { useApp } from '@/data/AppContext';
import { NUTRIENT_LABELS, formatNutrient, formatQuantity } from '@/lib/format';
import { EmptyState, ErrorState, Loading, Muted, Text, useStyles } from './ui';

/** Always show these rows so a missing value reads "Unknown" rather than being hidden or shown as 0. */
const SHOWN: NutrientKey[] = ['energy_kcal', 'protein', 'carbohydrate', 'fat', 'saturates', 'fibre', 'salt'];

export default function RecipeDetailScreen() {
  const { ds } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const styles = useStyles();
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!id) return;
    setError(null);
    ds.getRecipe(id).then(setRecipe, (e: unknown) =>
      setError(e instanceof Error ? e.message : 'Could not load recipe'),
    );
  }, [ds, id]);

  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (recipe === undefined) return <Loading label="Loading recipe" />;
  if (recipe === null) return <EmptyState title="Recipe not found." hint="It may have been deleted or archived." />;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title} accessibilityRole="header">
        {recipe.title}
      </Text>
      <Muted>Serves {recipe.servings}</Muted>

      <Text style={styles.heading} accessibilityRole="header">
        Ingredients
      </Text>
      {recipe.ingredients.length === 0 && <Muted>No ingredients recorded.</Muted>}
      {[...recipe.ingredients]
        .sort((a, b) => a.order - b.order)
        .map((ing) => {
          const qty = formatQuantity(ing.quantity);
          return (
            <View key={ing.id} style={styles.row} accessible accessibilityLabel={`${ing.name} ${qty}`.trim()}>
              <Text style={{ flex: 1, paddingRight: 8 }}>
                {ing.name}
                {ing.preparation ? `, ${ing.preparation}` : ''}
                {ing.optional ? ' (optional)' : ''}
              </Text>
              <Muted>{qty}</Muted>
            </View>
          );
        })}

      <Text style={styles.heading} accessibilityRole="header">
        Method
      </Text>
      {recipe.steps.length === 0 && <Muted>No method recorded.</Muted>}
      {recipe.steps.map((s, i) => (
        <Text key={i} style={{ marginBottom: 8 }}>
          {i + 1}. {s}
        </Text>
      ))}

      <Text style={styles.heading} accessibilityRole="header">
        Nutrition per serving
      </Text>
      {SHOWN.map((key) => (
        <View key={key} style={styles.row}>
          <Text>{NUTRIENT_LABELS[key]}</Text>
          <Text testID={`nutrition-${key}`}>{formatNutrient(recipe.nutrition.find((n) => n.nutrient === key))}</Text>
        </View>
      ))}
    </ScrollView>
  );
}
