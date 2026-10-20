import React from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { MIN_TAP, Muted, Text, useStyles } from './ui';

/** Entries of the "More" tab (keeps the bottom bar at four items; other lanes add their rows here). */
export const MORE_ENTRIES: ReadonlyArray<{ key: string; title: string; hint: string; href: string }> = [
  { key: 'plan', title: 'Meal planner', hint: 'Plan the week, or describe it and review a proposal', href: '/plan' },
  { key: 'pantry', title: 'Pantry', hint: 'What you have in, expiry dates, use what you have', href: '/pantry' },
  { key: 'pantry-scan', title: 'Scan groceries', hint: 'Photos or barcodes into your pantry', href: '/pantry/scan' },
  { key: 'receipts', title: 'Receipts', hint: 'Scan a till receipt and tick off your list', href: '/receipts' },
  { key: 'list-scan', title: 'Scan a handwritten list', hint: 'Photograph a paper list into your shopping list', href: '/shopping-scan' },
  { key: 'households', title: 'Households', hint: 'Switch household', href: '/households' },
];

export default function MoreScreen({ entries = MORE_ENTRIES }: { entries?: typeof MORE_ENTRIES }) {
  const router = useRouter();
  const styles = useStyles();
  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title} accessibilityRole="header">
        More
      </Text>
      {entries.map((e) => (
        <Pressable
          key={e.key}
          accessibilityRole="button"
          accessibilityLabel={e.title}
          accessibilityHint={e.hint}
          testID={`more-${e.key}`}
          onPress={() => router.push(e.href as never)}
          style={{ minHeight: MIN_TAP, justifyContent: 'center', paddingVertical: 10 }}
        >
          <View>
            <Text style={{ fontWeight: '600' }}>{e.title}</Text>
            <Muted>{e.hint}</Muted>
          </View>
        </Pressable>
      ))}
    </ScrollView>
  );
}
