import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { useServerApi } from '@/data/ServerApiContext';
import { setPendingNext } from '@/lib/pendingNext';
import { SHARE_TOKEN_RE, createSharingClient, type SharePreview, type SharedRecipe, type SharingClient } from '@/lib/sharingApi';
import type { ServerApi } from '@/lib/serverApi';
import { Button, EmptyState, ErrorText, Loading, Muted, Text, useStyles } from '../ui';
import { Badge, Section } from '../widgets';

const NOT_AVAILABLE = 'This link is not available. It may have expired or been switched off.';

/** A share photo: loads through the bearer-protected share image route (a signed URL behind a redirect). */
export function ShareImage({ api, path, label }: { api: ServerApi; path: string | null; label: string }) {
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  useEffect(() => {
    let live = true;
    const uri = path ? api.webUrl(path) : null;
    if (!uri) return;
    api.authHeaders().then((headers) => live && setSource({ uri, headers }), () => undefined);
    return () => {
      live = false;
    };
  }, [api, path]);
  if (!source) return null;
  return <Image source={source} accessibilityLabel={label} style={{ width: '100%', height: 180, borderRadius: 8 }} resizeMode="cover" testID="share-image" />;
}

function RecipeCard({ r, api, canSave, saving, saved, onSave, onOpen }: {
  r: SharedRecipe; api: ServerApi; canSave: boolean; saving: boolean; saved: string | null; onSave: () => void; onOpen: (id: string) => void;
}) {
  const styles = useStyles();
  return (
    <Section testID={`shared-recipe-${r.id}`}>
      <Text style={styles.heading} accessibilityRole="header">{r.title}</Text>
      <ShareImage api={api} path={r.imagePath} label={`${r.title} photo`} />
      {r.description ? <Text>{r.description}</Text> : null}
      <Muted>
        {`Serves ${r.servings}${r.prepMinutes != null ? ` · prep ${r.prepMinutes} min` : ''}${r.cookMinutes != null ? ` · cook ${r.cookMinutes} min` : ''}`}
        {r.sourceAttribution ? ` · ${r.sourceAttribution}` : ''}
      </Muted>
      <Text style={{ fontWeight: '600', marginTop: 8 }}>Ingredients</Text>
      {r.ingredients.map((i, n) => (
        <Text key={n}>{`• ${i.text}${i.optional ? ' (optional)' : ''}`}</Text>
      ))}
      <Text style={{ fontWeight: '600', marginTop: 8 }}>Method</Text>
      {r.steps.map((s, n) => (
        <Text key={n}>{`${n + 1}. ${s}`}</Text>
      ))}
      {saved ? (
        <View>
          <Text testID="share-saved">Saved to your household.</Text>
          <Button title="Open my copy" variant="secondary" onPress={() => onOpen(saved)} testID={`open-copy-${r.id}`} />
        </View>
      ) : canSave ? (
        <Button title={saving ? 'Saving...' : 'Save a copy to my household'} onPress={onSave} disabled={saving} testID={`save-copy-${r.id}`} />
      ) : null}
    </Section>
  );
}

/**
 * `familyrecipes://s/<token>` or `https://<web host>/s/<token>` (web: /s/[token]). Shows the read-only preview and, for a
 * signed-in person from another household, "Save a copy to my household". Signed out: a minimal preview and a sign-in prompt
 * (the link is remembered for an hour while the person signs in). The token comes from the route, is validated, and is never logged.
 * Unknown, expired and revoked links all read the same.
 */
export function ShareLinkBody({ token, client: injected }: { token: string; client?: SharingClient }) {
  const api = useServerApi();
  const { householdId, ds } = useApp();
  const router = useRouter();
  const styles = useStyles();
  const client = useMemo(() => injected ?? createSharingClient(api, householdId), [injected, api, householdId]);
  const [preview, setPreview] = useState<SharePreview | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await client.preview(token);
      setPreview(r.preview);
      setSignedIn(r.signedIn);
    } catch (e) {
      const code = (e as { code?: string; status?: number } | null)?.status;
      setError(code === 429 ? 'Too many tries. Please wait a few minutes and try again.' : e instanceof Error ? e.message : 'The link could not be opened.');
    }
  }, [client, token]);
  useEffect(() => {
    void load();
  }, [load]);

  const toSignIn = async (target: '/sign-in' | '/sign-up') => {
    await setPendingNext(`/s/${token}`);
    router.replace(target);
  };

  if (error) return <EmptyState title="Could not open this link" hint={error} />;
  if (!preview) return <Loading label="Opening the link" />;
  if (preview.kind === 'invalid') {
    return (
      <View style={{ padding: 16 }}>
        <Text style={styles.title} accessibilityRole="header">This link is not available</Text>
        <Text testID="share-unavailable">{NOT_AVAILABLE}</Text>
      </View>
    );
  }

  const prompt = (
    <View>
      <Text testID="share-sign-in">Sign in or create an account to read it in full and save a copy to your household.</Text>
      <Muted>We will bring you back here afterwards.</Muted>
      <Button title="Sign in" onPress={() => void toSignIn('/sign-in')} testID="share-sign-in-button" />
      <Button title="Create an account" variant="secondary" onPress={() => void toSignIn('/sign-up')} testID="share-sign-up-button" />
    </View>
  );

  if (preview.kind === 'minimal') {
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }} style={styles.screen}>
        <Text style={styles.title} accessibilityRole="header" testID="share-title">{preview.title ?? 'A shared recipe'}</Text>
        <Text>{`${preview.sharedBy ? `${preview.sharedBy}'s household` : 'Another household'} has shared ${preview.scope === 'collection' ? `${preview.recipeCount} recipe${preview.recipeCount === 1 ? '' : 's'}` : 'a recipe'} with you on Family Recipes.`}</Text>
        {prompt}
      </ScrollView>
    );
  }

  const canSave = signedIn && preview.signedIn && !preview.own && !!householdId;
  async function save(recipeId: string) {
    setSaving(recipeId);
    setSaveError(null);
    try {
      const r = await client.save(token, recipeId);
      setSaved((s) => ({ ...s, [recipeId]: r.recipeId }));
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'The copy could not be saved.');
    } finally {
      setSaving(null);
    }
  }
  const title = preview.scope === 'collection' ? (preview.title ?? 'Shared recipes') : (preview.recipes[0]?.title ?? 'A shared recipe');
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} style={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header" testID="share-title">{title}</Text>
      <View style={{ flexDirection: 'row' }}><Badge label={preview.attribution} tone="good" /></View>
      {preview.expiresAt ? <Muted>{`This link stops working on ${new Date(preview.expiresAt).toLocaleDateString('en-GB')}.`}</Muted> : null}
      {!preview.signedIn ? prompt : null}
      {preview.own ? <Text>This is a link your own household made, so these recipes are already yours.</Text> : null}
      {signedIn && !preview.own && !householdId ? <Muted>Pick a household first to save a copy.</Muted> : null}
      <ErrorText message={saveError} />
      {preview.recipes.map((r) => (
        <RecipeCard
          key={r.id} r={r} api={api} canSave={canSave} saving={saving === r.id} saved={saved[r.id] ?? null} onSave={() => void save(r.id)}
          onOpen={(id) => router.push({ pathname: '/recipe/[id]', params: { id } })}
        />
      ))}
    </ScrollView>
  );
}

export default function ShareLinkScreen() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const raw = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = (raw ?? '').toLowerCase();
  const styles = useStyles();
  const api = useServerApi();
  if (!SHARE_TOKEN_RE.test(token)) {
    return (
      <View style={{ padding: 16 }}>
        <Text style={styles.title} accessibilityRole="header">This link is not available</Text>
        <Text testID="share-unavailable">{NOT_AVAILABLE}</Text>
      </View>
    );
  }
  if (!api.configured) {
    return <EmptyState title="This needs the Family Recipes server." hint="The app is running on built-in demo data. Set EXPO_PUBLIC_API_BASE_URL (and Supabase sign-in) to open shared recipes." />;
  }
  return <ShareLinkBody token={token} />;
}
