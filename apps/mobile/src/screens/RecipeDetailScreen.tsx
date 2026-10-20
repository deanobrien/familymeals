import React, { useCallback, useRef, useState } from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { formatMinutes } from '@/lib/calcFormat';
import type { RecipeDetailData } from '@/lib/recipesApi';
import { loadServingsOverride, resolveInitialServings, saveServingsOverride, scaledAmount, servingsOverrideKey, MAX_SERVINGS } from '@/lib/servings';
import { CostPanel, NutritionPanel } from './RecipePanels';
import { Button, EmptyState, ErrorState, ErrorText, Loading, Muted, Text, useStyles } from './ui';
import { Badge, RecipeImage, Section, Stepper } from './widgets';

export default function RecipeDetailScreen() {
  const { ds, recipes, householdId } = useApp();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const styles = useStyles();
  const [data, setData] = useState<RecipeDetailData | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [servings, setServingsState] = useState<number | null>(null);
  const [stored, setStored] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showOriginal, setShowOriginal] = useState(false);
  const overrideKey = useRef<string | null>(null);

  const load = useCallback(() => {
    if (!id || !householdId) return;
    setError(null);
    (async () => {
      const [detail, session] = await Promise.all([recipes.get(householdId, id), ds.getSession()]);
      const key = servingsOverrideKey(householdId, session?.userId ?? 'anonymous', id);
      overrideKey.current = key;
      const override = detail ? await loadServingsOverride(key) : undefined;
      setData(detail);
      if (detail) {
        // The cook's own number wins; otherwise the household default, never the recipe's own servings.
        setServingsState((cur) => cur ?? resolveInitialServings(detail.householdServings, override));
        setStored(override !== undefined);
      }
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not load recipe'));
  }, [recipes, ds, id, householdId]);

  useFocusEffect(load);

  if (error) return <ErrorState message={error} onRetry={load} />;
  if (data === undefined || (data && servings === null)) return <Loading label="Loading recipe" />;
  if (data === null) return <EmptyState title="Recipe not found." hint="It may have been deleted or archived." />;

  const { recipe, calc } = data;
  const wanted = servings ?? recipe.servings;
  const householdDefault = resolveInitialServings(data.householdServings);
  const factor = recipe.servings > 0 ? wanted / recipe.servings : 1;
  const totalTime = recipe.prepMinutes == null && recipe.cookMinutes == null ? null : (recipe.prepMinutes ?? 0) + (recipe.cookMinutes ?? 0);

  const setServings = (n: number, remember = true) => {
    setServingsState(n);
    setStored(remember);
    if (overrideKey.current) void saveServingsOverride(overrideKey.current, remember ? n : null);
  };

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    try {
      return await fn();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'That did not work. Please try again.');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  const favourite = async () => {
    if (!householdId) return;
    const fav = await run(() => recipes.toggleFavourite(householdId, recipe.id));
    if (fav !== undefined) setData((d) => (d ? { ...d, recipe: { ...d.recipe, favourite: fav } } : d));
  };

  const remove = async () => {
    if (!householdId) return;
    const done = await run(async () => {
      await recipes.remove(householdId, recipe.id);
      return true;
    });
    if (done) router.back();
    else setConfirmDelete(false);
  };

  const rematch = async () => {
    if (!householdId) return;
    const res = await run(() => recipes.rematch(householdId, recipe.id));
    if (!res) return;
    if (!res.ok) return setActionError(res.message);
    const left = res.summary.ambiguous + res.summary.unmatched;
    setNotice(`Linked ${res.summary.linked} ingredient${res.summary.linked === 1 ? '' : 's'}${left > 0 ? `; ${left} still need a choice` : ''}.`);
    load();
  };

  // The in-app planner (P0-C) opens with this recipe waiting for a slot (D353).
  const addToPlan = () => router.push({ pathname: '/plan', params: { add: recipe.id } });

  const edit = () => router.push({ pathname: '/recipe/edit/[id]', params: { id: recipe.id } });

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <RecipeImage imageUrl={recipe.imageUrl} size={320} height={180} label={`${recipe.title} photo`} />
      <Text style={[styles.title, { marginTop: 12 }]} accessibilityRole="header" testID="recipe-title">
        {recipe.title}
      </Text>
      {recipe.description ? <Text>{recipe.description}</Text> : null}
      <Muted>Source: {recipe.sourceAttribution || recipe.sourceUrl || 'Not recorded'}</Muted>
      {recipe.sourceUrl ? (
        <Muted onPress={() => void Linking.openURL(recipe.sourceUrl)} accessibilityRole="link">
          {recipe.sourceUrl}
        </Muted>
      ) : null}
      <Muted testID="recipe-times">
        Prep {recipe.prepMinutes != null ? formatMinutes(recipe.prepMinutes) : 'Unknown'} · Cook {recipe.cookMinutes != null ? formatMinutes(recipe.cookMinutes) : 'Unknown'}
        {totalTime != null ? ` · Total ${formatMinutes(totalTime)}` : ''}
        {recipe.rating != null ? ` · Rating ${recipe.rating}/5` : ''}
      </Muted>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginVertical: 6 }}>
        <Badge label={recipe.diet} tone="good" />
        {recipe.cuisine ? <Badge label={recipe.cuisine} /> : null}
        <Badge label={recipe.mealType} />
        {recipe.tags.map((t) => (
          <Badge key={t} label={t} />
        ))}
      </View>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <View style={{ minWidth: 140, flexGrow: 1 }}>
          <Button
            title={recipe.favourite ? 'Favourited' : 'Favourite'}
            accessibilityLabel={recipe.favourite ? 'Remove from favourites' : 'Add to favourites'}
            variant={recipe.favourite ? 'primary' : 'secondary'}
            onPress={favourite}
            disabled={busy}
            testID="favourite"
          />
        </View>
        <View style={{ minWidth: 140, flexGrow: 1 }}>
          <Button title="Add to plan" variant="secondary" onPress={addToPlan} testID="add-to-plan" />
        </View>
        <View style={{ minWidth: 140, flexGrow: 1 }}>
          <Button title="Edit" variant="secondary" onPress={edit} testID="edit-recipe" />
        </View>
        <View style={{ minWidth: 140, flexGrow: 1 }}>
          <Button title="Duplicate" variant="secondary" onPress={() => router.push({ pathname: '/recipe/new', params: { from: recipe.id } })} testID="duplicate-recipe" />
        </View>
        <View style={{ minWidth: 140, flexGrow: 1 }}>
          <Button title="Delete" variant="secondary" onPress={() => setConfirmDelete(true)} disabled={busy} testID="delete-recipe" />
        </View>
      </View>
      {confirmDelete && (
        <Section testID="confirm-delete">
          <Text style={{ fontWeight: '600' }}>Delete &quot;{recipe.title}&quot;?</Text>
          <Muted>This removes the recipe from your library (it is archived, not shared with anyone).</Muted>
          <Button title="Delete recipe" onPress={remove} disabled={busy} testID="confirm-delete-yes" />
          <Button title="Keep it" variant="secondary" onPress={() => setConfirmDelete(false)} testID="confirm-delete-no" />
        </Section>
      )}
      <ErrorText message={actionError} />
      {notice ? (
        <Muted accessibilityRole="alert" testID="notice">
          {notice}
        </Muted>
      ) : null}

      <Text style={styles.heading} accessibilityRole="header">
        Ingredients
      </Text>
      <Stepper label="Servings" value={wanted} min={1} max={MAX_SERVINGS} onChange={(n) => setServings(n)} testID="servings" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
        {wanted !== householdDefault && (
          <View style={{ flexGrow: 1 }}>
            <Button title={`Reset to household (${householdDefault})`} variant="secondary" onPress={() => setServings(householdDefault, false)} testID="servings-reset" />
          </View>
        )}
        {wanted !== recipe.servings && (
          <View style={{ flexGrow: 1 }}>
            <Button title={`Original (${recipe.servings})`} variant="secondary" onPress={() => setServings(recipe.servings)} testID="servings-original" />
          </View>
        )}
      </View>
      <Muted testID="servings-note">
        Recipe serves {recipe.servings} · showing for {wanted}
        {wanted === householdDefault && !stored ? ' (your household)' : ''}
      </Muted>
      {wanted !== recipe.servings && (
        <Muted accessibilityRole="alert">Amounts scaled for {wanted} servings and rounded for easy measuring. Pinches and to-taste items are unchanged.</Muted>
      )}
      {recipe.ingredients.length === 0 && <Muted>No ingredients recorded.</Muted>}
      {[...recipe.ingredients]
        .sort((a, b) => a.order - b.order)
        .map((ing) => {
          const qty = scaledAmount(ing.quantity, recipe.servings, wanted);
          return (
            <View key={ing.id} style={styles.row} accessible accessibilityLabel={`${ing.name} ${qty}`.trim()}>
              <Text style={{ flex: 1, paddingRight: 8 }}>
                {ing.name}
                {ing.preparation ? `, ${ing.preparation}` : ''}
                {ing.optional ? ' (optional)' : ''}
              </Text>
              <Muted testID="ingredient-qty">{qty}</Muted>
            </View>
          );
        })}
      {data.unlinkedCount > 0 && (
        <Section testID="unlinked-notice">
          <Muted accessibilityRole="alert">
            {data.unlinkedCount} of {recipe.ingredients.length} ingredients {data.unlinkedCount === 1 ? 'is' : 'are'} not linked to the ingredient list, so{' '}
            {data.unlinkedCount === 1 ? 'it is' : 'they are'} left out of cost and nutrition.
          </Muted>
          <Button title="Re-match ingredients" variant="secondary" onPress={rematch} disabled={busy} testID="rematch-recipe" />
          <Button title="Choose matches" variant="secondary" onPress={edit} testID="choose-matches" />
        </Section>
      )}

      <Text style={styles.heading} accessibilityRole="header">
        Method
      </Text>
      {recipe.steps.length === 0 && <Muted>No method recorded.</Muted>}
      {recipe.steps.map((s, i) => (
        <Text key={s.id} style={{ marginBottom: 8 }}>
          {i + 1}. {s.text}
        </Text>
      ))}

      <CostPanel cost={calc.cost} servings={wanted} factor={factor} />
      <NutritionPanel nutrition={calc.nutrition} servings={wanted} printed={recipe.printedNutrition ?? null} />

      {recipe.printedAllergens && recipe.printedAllergens.length > 0 && (
        <Muted testID="printed-allergens">
          Allergens printed on the card: {recipe.printedAllergens.join(', ')} (as printed; check the packaging)
        </Muted>
      )}

      {recipe.originalText ? (
        <View>
          <Button title={`${showOriginal ? 'Hide' : 'Show'} original recipe text`} variant="secondary" onPress={() => setShowOriginal((s) => !s)} testID="toggle-original" />
          {showOriginal && <Text testID="original-text">{recipe.originalText}</Text>}
        </View>
      ) : null}
    </ScrollView>
  );
}
