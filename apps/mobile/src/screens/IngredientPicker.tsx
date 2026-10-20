import React, { useEffect, useRef, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';
import type { ServerApi } from '@/lib/serverApi';
import { ErrorText, MIN_TAP, Muted, Text, useStyles, useTheme } from './ui';

export interface IngredientHit {
  id: string;
  name: string;
  category: string;
}

/** GET /api/pantry/ingredients (canonical catalogue search; never fuzzy-applies anything). */
export async function searchIngredients(api: ServerApi, householdId: string, q: string): Promise<IngredientHit[]> {
  const body = await api.get<{ hits?: unknown }>('/api/pantry/ingredients', { q, householdId });
  return (Array.isArray(body.hits) ? body.hits : []).filter(
    (h): h is IngredientHit => !!h && typeof (h as IngredientHit).id === 'string' && typeof (h as IngredientHit).name === 'string',
  );
}

/**
 * Type-ahead over the canonical ingredient catalogue. Calls `onPick` with the chosen hit. Test ids: `${testIdPrefix}-input`,
 * `${testIdPrefix}-hit` (one per result).
 */
export default function IngredientPicker({
  api,
  householdId,
  onPick,
  placeholder = 'Search ingredients',
  testIdPrefix = 'ingredient',
  initialQuery = '',
  debounceMs = 250,
}: {
  api: ServerApi;
  householdId: string;
  onPick: (hit: IngredientHit) => void;
  placeholder?: string;
  testIdPrefix?: string;
  initialQuery?: string;
  debounceMs?: number;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const [q, setQ] = useState(initialQuery);
  const [hits, setHits] = useState<IngredientHit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) {
      setHits([]);
      return undefined;
    }
    const mine = ++seq.current;
    const t = setTimeout(() => {
      searchIngredients(api, householdId, text)
        .then((h) => {
          if (mine === seq.current) {
            setHits(h.slice(0, 8));
            setError(null);
          }
        })
        .catch((e: unknown) => {
          if (mine === seq.current) setError(e instanceof Error ? e.message : 'Search failed');
        });
    }, debounceMs);
    return () => clearTimeout(t);
  }, [q, api, householdId, debounceMs]);

  return (
    <View>
      <TextInput
        style={styles.input}
        placeholder={placeholder}
        placeholderTextColor={theme.muted}
        accessibilityLabel={placeholder}
        value={q}
        onChangeText={setQ}
        autoCapitalize="none"
        testID={`${testIdPrefix}-input`}
      />
      <ErrorText message={error} />
      {hits.map((h) => (
        <Pressable
          key={h.id}
          accessibilityRole="button"
          accessibilityLabel={`Use ${h.name}`}
          testID={`${testIdPrefix}-hit`}
          onPress={() => {
            onPick(h);
            setQ('');
            setHits([]);
          }}
          style={{ minHeight: MIN_TAP, justifyContent: 'center', paddingVertical: 6 }}
        >
          <Text>{h.name}</Text>
          <Muted>{h.category}</Muted>
        </Pressable>
      ))}
    </View>
  );
}
