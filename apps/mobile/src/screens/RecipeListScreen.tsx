import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Recipe } from '@/viewModels';
import { useApp } from '@/data/AppContext';
import { EmptyState, ErrorState, Loading, Muted, Text, useStyles } from './ui';

export default function RecipeListScreen() {
  const { ds, householdId } = useApp();
  const router = useRouter();
  const styles = useStyles();
  const [recipes, setRecipes] = useState<Recipe[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!householdId) return;
    setError(null);
    try {
      setRecipes(await ds.listRecipes(householdId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load recipes');
    }
  }, [ds, householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!householdId) return <EmptyState title="Pick a household first." />;
  if (error && !recipes) return <ErrorState message={error} onRetry={load} />;
  if (!recipes) return <Loading label="Loading recipes" />;

  return (
    <View style={styles.screen}>
      <FlatList
        data={recipes}
        keyExtractor={(r) => r.id}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await load();
              setRefreshing(false);
            }}
          />
        }
        ListEmptyComponent={
          <EmptyState title="No recipes yet." hint="Capture one from the Capture tab." />
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.title}, serves ${item.servings}`}
            style={styles.row}
            onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: item.id } })}
          >
            <Text style={{ flex: 1, paddingRight: 8 }}>{item.title}</Text>
            <Muted>Serves {item.servings}</Muted>
          </Pressable>
        )}
      />
    </View>
  );
}
