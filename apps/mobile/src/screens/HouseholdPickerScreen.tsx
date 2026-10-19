import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Household } from '@/viewModels';
import { useApp } from '@/data/AppContext';
import { ErrorText, styles } from './ui';

export default function HouseholdPickerScreen() {
  const { ds, setHouseholdId } = useApp();
  const router = useRouter();
  const [households, setHouseholds] = useState<Household[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    ds.listHouseholds().then(setHouseholds, (e: unknown) =>
      setError(e instanceof Error ? e.message : 'Could not load households'),
    );
  }, [ds]);

  if (error) return <ErrorText message={error} />;
  if (!households) return <ActivityIndicator accessibilityLabel="Loading" />;

  return (
    <View style={styles.screen}>
      <Text style={styles.title}>Choose a household</Text>
      <FlatList
        data={households}
        keyExtractor={(h) => h.id}
        ListEmptyComponent={<Text style={styles.muted}>You are not in a household yet.</Text>}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            style={styles.row}
            onPress={() => {
              setHouseholdId(item.id);
              router.replace('/recipes');
            }}
          >
            <Text>{item.name}</Text>
            <Text style={styles.muted}>{item.memberCount} members</Text>
          </Pressable>
        )}
      />
    </View>
  );
}
