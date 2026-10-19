import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Recipe } from '@/viewModels';
import { useApp } from '@/data/AppContext';
import { ErrorText, styles } from './ui';

export default function RecipeListScreen() {
  const { ds, householdId } = useApp();
  const router = useRouter();
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!householdId) return;
    ds.listRecipes(householdId).then(setRecipes, (e: unknown) =>
      setError(e instanceof Error ? e.message : 'Could not load recipes'),
    );
  }, [ds, householdId]);

  if (!householdId) return <Text style={styles.muted}>Pick a household first.</Text>;
  if (error) return <ErrorText message={error} />;
  if (!recipes) return <ActivityIndicator accessibilityLabel="Loading" />;

  return (
    <View style={styles.screen}>
      <FlatList
        data={recipes}
        keyExtractor={(r) => r.id}
        ListEmptyComponent={<Text style={styles.muted}>No recipes yet. Capture one from the Capture tab.</Text>}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            style={styles.row}
            onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: item.id } })}
          >
            <Text>{item.title}</Text>
            <Text style={styles.muted}>Serves {item.servings}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
