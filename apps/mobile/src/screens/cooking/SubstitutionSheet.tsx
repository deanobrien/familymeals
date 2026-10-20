import React, { useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import type { CookSwap } from '@fr/engine/cooking';
import type { RecipesApi, SubstitutionResult } from '@/lib/recipesApi';
import { Button, ErrorText, Muted, Text } from '../ui';
import { Section } from '../widgets';

/**
 * "Out of X?": AI suggestions the server has already re-checked against the household's allergies and exclusions (anything
 * excluded or unverifiable never arrives here). Applying is temporary (cook mode) or saves a COPY as a variant.
 */
export function SubstitutionSheet({
  recipes,
  householdId,
  recipeId,
  line,
  existingSwaps = [],
  onApply,
  onCookWith,
  onClose,
}: {
  recipes: RecipesApi;
  householdId: string;
  recipeId: string;
  line: { id: string; name: string };
  existingSwaps?: CookSwap[];
  /** Cook mode: use it for this session only. */
  onApply?: (swap: CookSwap) => void;
  /** Recipe screen: open cook mode with this swap. */
  onCookWith?: (swap: CookSwap) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [result, setResult] = useState<SubstitutionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{ id: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setResult(null);
    recipes
      .suggestSubstitutions(householdId, recipeId, line.id)
      .then((r) => live && setResult(r))
      .catch((e: unknown) => live && setResult({ ok: false, message: e instanceof Error ? e.message : 'Suggestions are not available right now.' }));
    return () => {
      live = false;
    };
  }, [recipes, householdId, recipeId, line.id]);

  const swapOf = (s: { substitute: string; quantityGuidance: string }): CookSwap => ({ lineId: line.id, name: s.substitute, guidance: s.quantityGuidance });

  const saveVariant = async (swap: CookSwap) => {
    setBusy(true);
    setError(null);
    try {
      const swaps = [...existingSwaps.filter((e) => e.lineId !== swap.lineId), swap].map((s) => ({ lineId: s.lineId, name: s.name, ...(s.guidance ? { guidance: s.guidance } : {}) }));
      const r = await recipes.saveVariant(householdId, recipeId, swaps);
      if (r.ok) setSaved({ id: r.id, title: r.title });
      else setError(r.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The variant could not be saved.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section testID="substitution-sheet">
      <Text style={{ fontWeight: '600', fontSize: 17 }}>Out of {line.name}?</Text>
      {result === null ? <Muted accessibilityRole="progressbar">Looking for substitutes...</Muted> : null}
      {result && !result.ok ? <ErrorText message={result.message} /> : null}
      {result && result.ok ? (
        <>
          {result.suggestions.length === 0 ? (
            <Muted testID="no-substitutes">
              No safe substitute found for {line.name}.{result.withheld > 0 ? ' Suggestions that clash with your household exclusions were left out.' : ''}
            </Muted>
          ) : null}
          {result.suggestions.map((s) => (
            <View key={s.substitute} testID="substitute" style={{ marginTop: 8 }}>
              <Text style={{ fontWeight: '600' }}>{s.substitute}</Text>
              <Text>{s.quantityGuidance}</Text>
              <Muted>{s.effect}</Muted>
              {onApply ? (
                <Button
                  title="Use for this cook"
                  onPress={() => {
                    onApply(swapOf(s));
                    onClose();
                  }}
                  testID={`use-${s.substitute}`}
                />
              ) : null}
              {onCookWith ? <Button title="Cook with this swap" variant="secondary" onPress={() => onCookWith(swapOf(s))} testID={`cook-with-${s.substitute}`} /> : null}
              <Button title="Save as variant" variant="secondary" disabled={busy} onPress={() => void saveVariant(swapOf(s))} testID={`variant-${s.substitute}`} />
            </View>
          ))}
          {result.withheld > 0 && result.suggestions.length > 0 ? (
            <Muted testID="withheld-note">
              {result.withheld} other suggestion{result.withheld === 1 ? ' was' : 's were'} left out because of your household exclusions
              {result.withheldUnverifiable > 0 ? ` (${result.withheldUnverifiable} could not be checked)` : ''}.
            </Muted>
          ) : null}
          <Muted>Suggestions are from AI and checked against your household exclusions, but always read the pack. The original recipe is never changed.</Muted>
        </>
      ) : null}
      <ErrorText message={error} />
      {saved ? (
        <View testID="variant-saved">
          <Text>Saved as &quot;{saved.title}&quot;. The original is unchanged.</Text>
          <Button title="Open the variant" variant="secondary" onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: saved.id } })} testID="open-variant" />
        </View>
      ) : null}
      <Button title="Close" variant="secondary" onPress={onClose} testID="close-substitutes" />
    </Section>
  );
}
