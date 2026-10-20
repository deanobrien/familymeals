import React, { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { useServerApi } from '@/data/ServerApiContext';
import { addMissingToList, fetchMakeNow, type MakeNowView } from '@/lib/makeNowApi';
import { consentNoticeText } from '@/lib/planApi';
import type { ServerApi } from '@/lib/serverApi';
import { Button, ErrorText, Muted, Text, useStyles } from './ui';

/**
 * "What can I make now?" (P1-B, D375), the same server suggestions as web Home and Pantry: ranked by pantry coverage with
 * expiring stock weighted up, allergy exclusions applied by the server (with consent), "add missing to shopping list" idempotent.
 * `compact` is the Recipes-tab card (top few + "See all"); the Pantry screen shows the full list.
 */
export function MakeNowSection({
  api, householdId, limit = 6, compact = false, onAdded,
}: { api: ServerApi; householdId: string; limit?: number; compact?: boolean; onAdded?: (message: string) => void }) {
  const styles = useStyles();
  const router = useRouter();
  const [view, setView] = useState<MakeNowView | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    fetchMakeNow(api, householdId, limit).then(setView, () => setView(null)); // an add-on: the screen works without it
  }, [api, householdId, limit]);
  useEffect(load, [load]);

  async function addMissing(recipeId: string) {
    setBusy(recipeId);
    setError(null);
    try {
      const r = await addMissingToList(api, householdId, recipeId);
      setMessage(r.message);
      onAdded?.(r.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add to the shopping list');
    } finally {
      setBusy(null);
    }
  }

  if (view === undefined) return compact ? null : <Muted>Looking at your pantry...</Muted>;
  if (view === null) return null;
  if (compact && view.items.length === 0) return null;
  const consent = consentNoticeText(view.withheldExclusions);
  const shown = compact ? view.items.slice(0, 3) : view.items;

  return (
    <View style={[styles.banner, { marginVertical: 8 }]} testID="make-now">
      <Text style={{ fontWeight: '700', marginBottom: 6 }} accessibilityRole="header">What can I make now?</Text>
      {consent ? <Muted testID="make-now-consent">{consent}</Muted> : null}
      {view.items.length === 0 ? (
        <Muted testID="make-now-empty">
          {view.pantryEmpty ? 'Add some stock to your pantry and we will suggest what you can cook.' : 'Nothing in your library is close to what you have in right now.'}
          {view.hiddenByAllergy > 0 ? ` ${view.hiddenByAllergy} recipe${view.hiddenByAllergy === 1 ? ' was' : 's were'} left out because of your household's allergy list.` : ''}
        </Muted>
      ) : null}
      {shown.map((r) => (
        <View key={r.recipeId} style={{ marginTop: 8 }} testID={`make-now-${r.recipeId}`}>
          <Text
            style={{ fontWeight: '600' }}
            accessibilityRole="link"
            onPress={() => router.push({ pathname: '/recipe/[id]', params: { id: r.recipeId } })}
          >
            {r.title}
          </Text>
          <Muted>{r.makeable ? 'Ready to cook' : r.headline}{r.makeable && r.usesExpiring ? ', uses stock expiring soon' : ''}</Muted>
          {!compact && r.missing.length > 0 ? (
            <>
              <Muted testID={`make-now-missing-${r.recipeId}`}>
                Still needed: {r.missing.map((m) => (m.quantityLabel ? `${m.name} (${m.quantityLabel})` : m.name)).join(', ')}
              </Muted>
              <Button
                title="Add missing to shopping list"
                accessibilityLabel={`Add missing items for ${r.title} to the shopping list`}
                variant="secondary"
                disabled={busy === r.recipeId}
                onPress={() => void addMissing(r.recipeId)}
                testID={`make-now-add-${r.recipeId}`}
              />
            </>
          ) : null}
        </View>
      ))}
      {!compact && view.hiddenByAllergy > 0 && view.items.length > 0 ? (
        <Muted testID="make-now-hidden">{`${view.hiddenByAllergy} recipe${view.hiddenByAllergy === 1 ? '' : 's'} left out because of your household's allergy list.`}</Muted>
      ) : null}
      {message ? <Muted testID="make-now-message" accessibilityLiveRegion="polite">{message}</Muted> : null}
      <ErrorText message={error} />
      {compact ? <Button title="See all in Pantry" variant="secondary" onPress={() => router.push('/pantry')} testID="make-now-see-all" /> : null}
    </View>
  );
}

/** The Recipes-tab card: nothing at all without a server, a household, or any suggestion. */
export function MakeNowHome() {
  const api = useServerApi();
  const { householdId } = useApp();
  if (!householdId || !api.configured) return null;
  return <MakeNowSection api={api} householdId={householdId} compact limit={3} />;
}
