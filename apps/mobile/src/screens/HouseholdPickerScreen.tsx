import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Household } from '@/viewModels';
import { useApp } from '@/data/AppContext';
import { EmptyState, ErrorState, Loading, Muted, Text, useStyles } from './ui';

export default function HouseholdPickerScreen() {
  const { ds, setHouseholdId } = useApp();
  const router = useRouter();
  const styles = useStyles();
  const [households, setHouseholds] = useState<Household[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    ds.listHouseholds().then(setHouseholds, (e: unknown) =>
      setError(e instanceof Error ? e.message : 'Could not load households'),
    );
  }, [ds]);

  useEffect(load, [load]);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (!households) return <Loading label="Loading households" />;

  return (
    <View style={styles.screen}>
      <Text style={styles.title} accessibilityRole="header">
        Choose a household
      </Text>
      <FlatList
        data={households}
        keyExtractor={(h) => h.id}
        ListEmptyComponent={
          <EmptyState title="You are not in a household yet." hint="Ask a household owner to invite you, or create one on the web." />
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${item.name}, ${item.memberCount} members`}
            style={styles.row}
            onPress={() => {
              setHouseholdId(item.id);
              router.replace('/recipes');
            }}
          >
            <Text>{item.name}</Text>
            <Muted>{item.memberCount} members</Muted>
          </Pressable>
        )}
      />
    </View>
  );
}
