import React, { useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import type { ExtractionOutcome, ImportClient } from '@/lib/importApi';
import { Button, ErrorText, Loading, Muted, Text, useStyles } from './ui';

/**
 * Read-only review of what the server extracted. Editing (matching ingredients, fixing quantities) is a web
 * job: when anything blocks saving, or the user wants to tweak, "Finish on web" opens the import page there.
 */
export default function ImportReviewScreen({
  outcome,
  client,
  onDone,
  onBack,
}: {
  outcome: ExtractionOutcome;
  client: ImportClient;
  onDone: () => void;
  onBack: () => void;
}) {
  const styles = useStyles();
  const { summary } = outcome;
  const [saving, setSaving] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const blocking = summary.issues.filter((i) => i.blocking);
  const webImport = client.webUrl('/recipes/import');

  async function save() {
    setSaving(true);
    setError(null);
    try {
      setSavedId((await client.save(outcome)).id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save the recipe');
    } finally {
      setSaving(false);
    }
  }

  if (saving) return <Loading label="Saving recipe" />;

  if (savedId) {
    const open = client.webUrl(`/recipes/${savedId}`);
    return (
      <View style={styles.centered}>
        <Text style={styles.title} accessibilityRole="header">
          Recipe saved
        </Text>
        <Text testID="saved-title">{summary.title}</Text>
        {open && <Button title="Open on web" variant="secondary" onPress={() => void Linking.openURL(open)} testID="open-web" />}
        <Button title="Capture another" onPress={onDone} testID="capture-another" />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.title} accessibilityRole="header" testID="review-title">
        {summary.title}
      </Text>
      <Muted>{summary.servings ? `Serves ${summary.servings}` : 'Servings not found'}</Muted>

      {outcome.existing.length > 0 && (
        <View style={styles.banner} testID="duplicate-warning">
          <Text>Looks similar to: {outcome.existing.map((e) => e.title).join(', ')}</Text>
        </View>
      )}

      {blocking.length > 0 && (
        <View style={styles.banner} accessibilityRole="alert" testID="blocking-issues">
          <Text style={{ fontWeight: '600' }}>This recipe needs a little more work before it can be saved:</Text>
          {blocking.map((i, k) => (
            <Text key={k}>- {i.message}</Text>
          ))}
        </View>
      )}
      {summary.warnings.map((w, k) => (
        <Muted key={k}>{w}</Muted>
      ))}

      <Text style={styles.heading} accessibilityRole="header">
        Ingredients ({summary.ingredients.length})
      </Text>
      {summary.ingredients.map((i, k) => (
        <View key={k} style={styles.row} accessible accessibilityLabel={`${i.text}${i.needsCheck ? ', please check' : ''}`}>
          <Text style={{ flex: 1 }}>{i.text}</Text>
          {i.needsCheck && <Text style={styles.pending}>Check</Text>}
        </View>
      ))}

      <Text style={styles.heading} accessibilityRole="header">
        Method ({summary.steps.length})
      </Text>
      {summary.steps.map((s, k) => (
        <Text key={k} style={{ marginBottom: 8 }}>
          {k + 1}. {s}
        </Text>
      ))}

      <ErrorText message={error} />
      <Button title="Save recipe" onPress={save} disabled={blocking.length > 0} testID="save-recipe" />
      {webImport && (
        <Button
          title="Finish on web"
          variant="secondary"
          accessibilityHint="Opens the full editor in your browser"
          onPress={() => void Linking.openURL(webImport)}
          testID="finish-on-web"
        />
      )}
      <Button title="Back to photos" variant="secondary" onPress={onBack} testID="back-to-photos" />
    </ScrollView>
  );
}
