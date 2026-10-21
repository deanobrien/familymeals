import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView } from 'react-native';
import { ServerScreen } from '@/data/ServerApiContext';
import { createSharingClient, type ShareSummary, type SharingClient } from '@/lib/sharingApi';
import type { ServerApi } from '@/lib/serverApi';
import { ErrorState, Loading, Muted, Text, useStyles } from '../ui';
import { Chip, ChipWrap, Section } from '../widgets';
import { CreateShare, ShareList } from './ShareControls';

const COLLECTIONS = [
  { value: 'favourites', label: 'Our favourites' },
  { value: 'quick', label: 'Quick meals' },
  { value: 'budget', label: 'Budget meals' },
  { value: 'vegetarian', label: 'Vegetarian meals' },
] as const;

export function SharedLinksBody({ api, householdId, client: injected }: { api: ServerApi; householdId: string; client?: SharingClient }) {
  const styles = useStyles();
  const client = useMemo(() => injected ?? createSharingClient(api, householdId), [injected, api, householdId]);
  const [shares, setShares] = useState<ShareSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [collection, setCollection] = useState<(typeof COLLECTIONS)[number]>(COLLECTIONS[0]);
  const load = useCallback(async () => {
    setError(null);
    try {
      setShares(await client.list());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your links could not be loaded.');
    }
  }, [client]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error && !shares) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!shares) return <Loading label="Loading your links" />;
  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">Shared recipes</Text>
      <Muted>Give a recipe, or a whole collection, to another household with a link. They read it and save their own copy. Your notes, ratings and cooking history are never shared, and a link can be switched off at any time. To share one recipe, open it and use &quot;Share this recipe&quot;.</Muted>
      <Text style={styles.heading} accessibilityRole="header">Share a collection</Text>
      <Section testID="share-collection">
        <ChipWrap>
          {COLLECTIONS.map((c) => (
            <Chip key={c.value} label={c.label} selected={collection.value === c.value} onPress={() => setCollection(c)} testID={`collection-${c.value}`} />
          ))}
        </ChipWrap>
        <Muted>Shares the recipes in it right now (up to 50).</Muted>
        <CreateShare key={collection.value} client={client} api={api} base={{ scope: 'collection', collection: collection.value, title: collection.label }} label={collection.label} onCreated={() => void load()} />
      </Section>
      <Text style={styles.heading} accessibilityRole="header">Your links</Text>
      <ShareList client={client} shares={shares} onChanged={() => void load()} />
    </ScrollView>
  );
}

export default function SharedLinksScreen() {
  return <ServerScreen>{(api, householdId) => <SharedLinksBody api={api} householdId={householdId} />}</ServerScreen>;
}
