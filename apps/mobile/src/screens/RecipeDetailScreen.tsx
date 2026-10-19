import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import type { NutrientKey } from '@fr/domain';
import type { Recipe } from '@/viewModels';
import { useApp } from '@/data/AppContext';
import { NUTRIENT_LABELS, formatNutrient, formatQuantity } from '@/lib/format';
import { ErrorText, styles } from './ui';

/** Always show these rows so a missing value reads "Unknown" rather than being hidden or shown as 0. */
const SHOWN: NutrientKey[] = ['energy_kcal', 'protein', 'carbohydrate', 'fat', 'saturates', 'fibre', 'salt'];

export default function RecipeDetailScreen() {
  const { ds } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [recipe, setRecipe] = useState<Recipe | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    ds.getRecipe(id).then(setRecipe, (e: unknown) =>
      setError(e instanceof Error ? e.message : 'Could not load recipe'),
    );
  }, [ds, id]);

  if (error) return <ErrorText message={error} />;
  if (recipe === undefined) return <ActivityIndicator accessibilityLabel="Loading" />;
  if (recipe === null) return <Text style={styles.muted}>Recipe not found.</Text>;

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title}>{recipe.title}</Text>
      <Text style={styles.muted}>Serves {recipe.servings}</Text>

      <Text style={styles.heading}>Ingredients</Text>
      {[...recipe.ingredients]
        .sort((a, b) => a.order - b.order)
        .map((ing) => (
          <View key={ing.id} style={styles.row}>
            <Text>
              {ing.name}
              {ing.preparation ? `, ${ing.preparation}` : ''}
              {ing.optional ? ' (optional)' : ''}
            </Text>
            <Text style={styles.muted}>{formatQuantity(ing.quantity)}</Text>
          </View>
        ))}

      <Text style={styles.heading}>Method</Text>
      {recipe.steps.map((s, i) => (
        <Text key={i} style={{ marginBottom: 6 }}>
          {i + 1}. {s}
        </Text>
      ))}

      <Text style={styles.heading}>Nutrition per serving</Text>
      {SHOWN.map((key) => (
        <View key={key} style={styles.row}>
          <Text>{NUTRIENT_LABELS[key]}</Text>
          <Text testID={`nutrition-${key}`}>
            {formatNutrient(recipe.nutrition.find((n) => n.nutrient === key))}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}
