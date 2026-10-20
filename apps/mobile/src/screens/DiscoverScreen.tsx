import React, { useEffect, useMemo, useState } from 'react';
import { Image, Linking, ScrollView, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { createImportClient, summariseDraft, type ExtractionOutcome, type ImportClient } from '@/lib/importApi';
import type { DiscoverCard, DiscoverFilterOptions, DiscoverOutcome } from '@/lib/recipesApi';
import ImportReviewScreen from './ImportReviewScreen';
import { Button, EmptyState, ErrorText, Loading, Muted, Text, useStyles, useTheme } from './ui';
import { Badge, OptionRow, Section } from './widgets';

const DIET_LABEL: Record<DiscoverCard['diet'], string> = {
  meat: 'Meat (or not checked)',
  fish: 'Fish',
  vegetarian: 'Vegetarian (unverified)',
  vegan: 'Vegan (unverified)',
  unknown: 'Not checked',
};

/** Same wording as the web consent notice (apps/web/lib/consent/notice.ts): a count only, no health detail. */
export function consentNoticeText(withheld: number): string | null {
  const n = Math.max(0, Math.floor(withheld));
  if (!(n > 0)) return null;
  return `${n === 1 ? "1 allergy exclusion isn't" : `${n} allergy exclusions aren't`} being applied because consent hasn't been given`;
}

/**
 * Discover recipes from TheMealDB (web: /recipes/discover). Search and the household's exclusion filtering happen on the
 * server (`/api/discover/*`, D333); a recipe is only saved after the same full review screen as a photo import.
 */
export default function DiscoverScreen({ importClient }: { importClient?: ImportClient }) {
  const { ds, recipes, householdId } = useApp();
  const router = useRouter();
  const styles = useStyles();
  const t = useTheme();
  const client = useMemo(
    () => importClient ?? createImportClient({ baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL, getToken: () => ds.getAccessToken() }),
    [importClient, ds],
  );
  const [options, setOptions] = useState<DiscoverFilterOptions | null>(null);
  const [q, setQ] = useState('');
  const [area, setArea] = useState<string | undefined>();
  const [category, setCategory] = useState<string | undefined>();
  const [ingredient, setIngredient] = useState('');
  const [result, setResult] = useState<DiscoverOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [review, setReview] = useState<ExtractionOutcome | null>(null);

  useEffect(() => {
    if (!householdId) return;
    recipes.discoverFilters(householdId).then(setOptions, () => setOptions({ categories: [], areas: [], sourceLabel: '', withheld: 0 }));
  }, [recipes, householdId]);

  if (!householdId) return <EmptyState title="Pick a household first." />;

  async function search(filters: { q?: string; area?: string; category?: string; ingredient?: string }) {
    if (!householdId) return;
    setBusy(true);
    setError(null);
    setOpen(null);
    try {
      setResult(await recipes.discoverSearch(householdId, filters));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : 'Could not search for recipes');
    } finally {
      setBusy(false);
    }
  }

  async function save(id: string) {
    if (!householdId) return;
    setBusy(true);
    setError(null);
    try {
      const r = await recipes.discoverDraft(householdId, id);
      if (!r.ok) return setError(r.message);
      setReview({ uploadId: r.uploadId, draft: r.draft, summary: summariseDraft(r.draft), existing: r.existing });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the review');
    } finally {
      setBusy(false);
    }
  }

  if (review) {
    return (
      <ImportReviewScreen
        outcome={review}
        client={client}
        intro="Check the recipe below. The source and the original text are kept with it. The dietary label is worked out from the ingredients and is not verified, so please check it. Anything marked needs a look before you save."
        backLabel="Back to results"
        doneLabel="Back to my recipes"
        onBack={() => setReview(null)}
        onDone={() => router.replace('/(tabs)/recipes')}
      />
    );
  }

  if (busy && !result) return <Loading label="Looking for recipes" />;

  const notice = options ? consentNoticeText(options.withheld) : null;

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled" testID="discover">
      <Text style={styles.title} accessibilityRole="header">
        Discover recipes
      </Text>
      {notice && (
        <Section testID="consent-notice">
          <Text accessibilityRole="alert">{notice}.</Text>
          <Button title="Review in Settings" variant="secondary" onPress={() => router.push('/(tabs)/settings')} testID="consent-review" />
        </Section>
      )}
      <Muted>Find new recipes to try. Nothing is added until you review and save it.</Muted>
      <TextInput
        accessibilityLabel="Search recipes"
        placeholder="e.g. salmon, curry, pancakes"
        placeholderTextColor={t.muted}
        value={q}
        onChangeText={setQ}
        maxLength={80}
        returnKeyType="search"
        onSubmitEditing={() => void search({ q, ...(area ? { area } : {}), ...(category ? { category } : {}), ingredient })}
        style={styles.input}
        testID="discover-q"
      />
      {options && options.areas.length > 0 && (
        <OptionRow label="Cuisine" testID="discover-area" value={area} options={options.areas.map((a) => ({ value: a, label: a }))} onChange={setArea} anyLabel="Any cuisine" />
      )}
      {options && options.categories.length > 0 && (
        <OptionRow label="Category" testID="discover-category" value={category} options={options.categories.map((c) => ({ value: c, label: c }))} onChange={setCategory} anyLabel="Any category" />
      )}
      <TextInput
        accessibilityLabel="Main ingredient"
        placeholder="Main ingredient, e.g. chicken"
        placeholderTextColor={t.muted}
        value={ingredient}
        onChangeText={setIngredient}
        maxLength={60}
        style={styles.input}
        testID="discover-ingredient"
      />
      <Button
        title={busy ? 'Searching...' : 'Search'}
        disabled={busy}
        testID="discover-search"
        onPress={() => void search({ q, ...(area ? { area } : {}), ...(category ? { category } : {}), ingredient })}
      />
      <Button
        title="Surprise me"
        variant="secondary"
        disabled={busy}
        testID="discover-surprise"
        onPress={() => {
          // Picks a random category the person can still review; never saves anything by itself.
          const pool = options?.categories.length ? options.categories : ['Chicken'];
          const pick = pool[Math.floor(Math.random() * pool.length)]!;
          setCategory(pick);
          void search({ category: pick });
        }}
      />
      <Muted testID="discover-source">
        Source: {options?.sourceLabel || 'the recipe source'}. Recipes that contain anything your household excludes are never shown.
      </Muted>
      <ErrorText message={error ?? (result && !result.ok ? result.message : null)} />

      {result?.ok && (
        <View testID="discover-results">
          {result.cards.length === 0 && (
            <Muted testID="discover-empty">No recipes to show.{result.withheld > 0 ? '' : ' Try different words or another filter.'}</Muted>
          )}
          {result.withheld > 0 && (
            <Muted testID="discover-withheld">
              {result.withheld} recipe{result.withheld === 1 ? '' : 's'} hidden because{' '}
              {result.exclusionsActive ? 'they contain something your household excludes or an ingredient we cannot check against your exclusions' : 'of your filters'}
              {result.withheldUnverifiable > 0 ? ` (${result.withheldUnverifiable} only because they could not be checked)` : ''}.
            </Muted>
          )}
          {result.cards.map((c) => (
            <Section key={c.id} testID={`discover-card-${c.id}`}>
              {c.imageUrl ? <Image source={{ uri: c.imageUrl }} accessibilityLabel={`${c.title} photo`} style={{ width: '100%', height: 160, borderRadius: 8 }} resizeMode="cover" /> : null}
              <Text style={{ fontWeight: '700', fontSize: 18 }}>{c.title}</Text>
              <Muted>{[c.area, c.category].filter(Boolean).join(' · ')}</Muted>
              <View style={{ flexDirection: 'row' }}>
                <Badge label={DIET_LABEL[c.diet]} tone="warn" />
              </View>
              <Muted testID={`card-attribution-${c.id}`}>Source: {c.attribution.publisher}</Muted>
              <Button
                title={open === c.id ? 'Hide preview' : 'Preview'}
                accessibilityLabel={`${open === c.id ? 'Hide preview of' : 'Preview'} ${c.title}`}
                variant="secondary"
                onPress={() => setOpen(open === c.id ? null : c.id)}
                testID={`preview-${c.id}`}
              />
              {open === c.id && (
                <View testID="discover-preview">
                  <Muted>
                    Diet label: {DIET_LABEL[c.diet]}. {c.dietNote} Check it yourself before relying on it.
                  </Muted>
                  <Text style={styles.heading}>Ingredients</Text>
                  {c.ingredients.map((i, n) => (
                    <Text key={`${i.name}-${n}`}>- {[i.measure, i.name].filter(Boolean).join(' ')}</Text>
                  ))}
                  <Text style={styles.heading}>Method</Text>
                  {c.steps.map((s, n) => (
                    <Text key={n} style={{ marginBottom: 6 }}>
                      {n + 1}. {s}
                    </Text>
                  ))}
                  <Muted onPress={() => void Linking.openURL(c.attribution.url)} accessibilityRole="link">
                    Source: {c.attribution.publisher} ({c.attribution.url})
                  </Muted>
                  {c.youtubeUrl ? (
                    <Muted onPress={() => void Linking.openURL(c.youtubeUrl!)} accessibilityRole="link">
                      Video: {c.youtubeUrl}
                    </Muted>
                  ) : null}
                  {c.creativeCommons ? <Muted>Image licence: {c.creativeCommons}</Muted> : null}
                </View>
              )}
              <Button
                title="Save to my recipes"
                accessibilityLabel={`Save ${c.title} to my recipes`}
                onPress={() => void save(c.id)}
                disabled={busy}
                testID={`save-${c.id}`}
              />
            </Section>
          ))}
          <Muted>Recipes and images from {result.sourceLabel || 'the recipe source'}. You review every recipe before it is saved.</Muted>
        </View>
      )}
    </ScrollView>
  );
}
