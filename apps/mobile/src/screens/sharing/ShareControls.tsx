import React, { useState } from 'react';
import { Share, Switch, View } from 'react-native';
import { EXPIRY_CHOICES, buildShareUrl, type CreateShareInput, type ShareSummary, type SharingClient } from '@/lib/sharingApi';
import type { ServerApi } from '@/lib/serverApi';
import { Button, ErrorText, Muted, Text } from '../ui';
import { Chip, ChipWrap } from '../widgets';

/** Open Android's share sheet with the link (the person picks the app and the contact). */
export async function shareLink(title: string, url: string): Promise<void> {
  await Share.share({ message: `${title}: ${url}`, title });
}

interface NewLink {
  url: string;
  title: string;
  expiresAt: string | null;
}

/**
 * Create a link and hand it to the system share sheet (P3-A, D420). The link is shown once, right after it is made: only its hash
 * is stored on the server, so it cannot be fetched again. `base` says what is shared (a recipe, or a named collection).
 */
export function CreateShare({ client, api, base, label, onCreated, share = shareLink }: {
  client: SharingClient;
  api: ServerApi;
  base: Pick<CreateShareInput, 'scope' | 'recipeIds' | 'collection' | 'title'>;
  label: string;
  onCreated?: () => void;
  share?: (title: string, url: string) => Promise<void>;
}) {
  const [days, setDays] = useState<number | null>(30);
  const [pub, setPub] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<NewLink | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await client.create({ ...base, expiresInDays: days, publicPreview: pub });
      const url = buildShareUrl(api.webUrl('') ?? '', r.token);
      setLink({ url, title: label, expiresAt: r.expiresAt });
      onCreated?.();
      await share(label, url).catch(() => undefined);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The link could not be made.');
    } finally {
      setBusy(false);
    }
  };

  if (link) {
    return (
      <View testID="new-share-link">
        <Text style={{ fontWeight: '600' }}>Link ready</Text>
        <Muted>{`Anyone with it can read ${link.title} and save a copy; it ${link.expiresAt ? `stops working on ${new Date(link.expiresAt).toLocaleDateString('en-GB')}` : 'does not expire'}. Switch it off any time. This is the only time the link is shown.`}</Muted>
        <Text selectable testID="share-link-text">{link.url}</Text>
        <Button title="Share again" onPress={() => void share(link.title, link.url).catch(() => undefined)} testID="share-again" />
        <Button title="Done" variant="secondary" onPress={() => setLink(null)} testID="share-done" />
      </View>
    );
  }
  return (
    <View testID="create-share-form">
      <Text style={{ fontWeight: '600' }}>Link works for</Text>
      <ChipWrap>
        {EXPIRY_CHOICES.map((c) => (
          <Chip key={c.label} label={c.label} selected={days === c.days} onPress={() => setDays(c.days)} testID={`expiry-${c.days ?? 'never'}`} />
        ))}
      </ChipWrap>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 6 }}>
        <Switch value={pub} onValueChange={setPub} accessibilityLabel="Let people see it without signing in" testID="public-preview" />
        <View style={{ flex: 1 }}><Text>Let people see it without signing in (text only, no photos)</Text></View>
      </View>
      <ErrorText message={error} />
      <Button title={busy ? 'Making the link...' : 'Create link and share'} onPress={() => void create()} disabled={busy} testID="create-share" />
    </View>
  );
}

const when = (iso: string | null): string => (iso ? new Date(iso).toLocaleDateString('en-GB') : 'never');

export function ShareList({ client, shares, onChanged }: { client: SharingClient; shares: ShareSummary[]; onChanged: () => void }) {
  const [confirm, setConfirm] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const revoke = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await client.revoke(id);
      setConfirm(null);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The link could not be switched off.');
    } finally {
      setBusy(false);
    }
  };
  if (shares.length === 0) return <Muted testID="no-shares">No links yet.</Muted>;
  return (
    <View testID="share-list">
      <ErrorText message={error} />
      {shares.map((s) => (
        <View key={s.id} testID={`share-${s.id}`} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(128,128,128,0.3)' }}>
          <Text style={{ fontWeight: '600' }}>{s.scope === 'collection' ? (s.title ?? 'Collection') : (s.recipes[0]?.title ?? 'Recipe')}</Text>
          <Muted>{`${s.scope === 'collection' ? `${s.recipes.length} recipe${s.recipes.length === 1 ? '' : 's'} · ` : ''}${s.status === 'revoked' ? 'switched off' : s.expiresAt ? `${s.status === 'expired' ? 'expired' : 'expires'} ${when(s.expiresAt)}` : 'no expiry'}${s.publicPreview ? ' · readable without signing in' : ''}`}</Muted>
          <Muted>{`Opened by ${s.openedBy} ${s.openedBy === 1 ? 'person' : 'people'} · ${s.saved} saved`}</Muted>
          {s.status === 'active' ? (
            confirm === s.id ? (
              <View>
                <Button title="Yes, switch off" onPress={() => void revoke(s.id)} disabled={busy} testID={`confirm-revoke-${s.id}`} />
                <Button title="Keep it" variant="secondary" onPress={() => setConfirm(null)} />
              </View>
            ) : (
              <Button title="Switch off" variant="secondary" onPress={() => setConfirm(s.id)} accessibilityLabel={`Switch off the link for ${s.title ?? s.recipes[0]?.title ?? 'this recipe'}`} testID={`revoke-${s.id}`} />
            )
          ) : null}
        </View>
      ))}
    </View>
  );
}
