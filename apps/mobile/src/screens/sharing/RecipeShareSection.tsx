import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import { useApp } from '@/data/AppContext';
import { useServerApi } from '@/data/ServerApiContext';
import { createSharingClient, type ShareSummary, type SharingClient } from '@/lib/sharingApi';
import { Button, Muted, Text, useStyles } from '../ui';
import { Section } from '../widgets';
import { CreateShare, ShareList } from './ShareControls';

/**
 * "Share this recipe with another household" on the recipe screen (P3-A, D420). Collapsed by default: sharing is a deliberate act.
 * Shown only where the app has a server (mock/demo mode has nowhere to send a link).
 */
export default function RecipeShareSection({ recipeId, recipeTitle, client: injected }: { recipeId: string; recipeTitle: string; client?: SharingClient }) {
  const api = useServerApi();
  const { householdId } = useApp();
  const styles = useStyles();
  const client = useMemo(() => injected ?? (householdId ? createSharingClient(api, householdId) : null), [injected, api, householdId]);
  const [open, setOpen] = useState(false);
  const [shares, setShares] = useState<ShareSummary[]>([]);
  const load = useCallback(async () => {
    if (!client) return;
    try {
      setShares((await client.list()).filter((s) => s.scope === 'recipe' && s.recipes.some((r) => r.id === recipeId)));
    } catch {
      setShares([]);
    }
  }, [client, recipeId]);
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  if (!client || (!injected && !api.configured)) return null;
  if (!open) return <Button title="Share this recipe" variant="secondary" onPress={() => setOpen(true)} testID="share-recipe" />;
  return (
    <Section testID="share-section">
      <Text style={styles.heading} accessibilityRole="header">Share with another household</Text>
      <Muted>Send a link to a friend or relative. They can read this recipe and save their own copy. Your notes, ratings and cooking history are never shared, and you can switch the link off at any time.</Muted>
      <CreateShare client={client} api={api} base={{ scope: 'recipe', recipeIds: [recipeId] }} label={`"${recipeTitle}"`} onCreated={() => void load()} />
      <Text style={{ fontWeight: '600', marginTop: 8 }}>Links for this recipe</Text>
      <ShareList client={client} shares={shares} onChanged={() => void load()} />
      <View style={{ height: 4 }} />
      <Button title="Close" variant="secondary" onPress={() => setOpen(false)} testID="share-close" />
    </Section>
  );
}
