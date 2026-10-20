import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { createImportClient, type ExtractionOutcome, type ImportClient } from '@/lib/importApi';
import { extractUrlFromSharedText } from '@/lib/shareUrl';
import ImportReviewScreen from './ImportReviewScreen';
import { Button, EmptyState, ErrorText, Loading, Muted, Text, useStyles } from './ui';
import { Field } from './widgets';

const INTRO =
  'Check the recipe below. It was read from the web page, and the link to the original page is kept with it. Anything marked needs a look before you save, and the dietary label is worked out from the ingredients and is not verified.';

/**
 * Recipe from a web link (web: Import a recipe > From a web link). The SERVER fetches the page (SSRF-guarded), reads its
 * schema.org recipe data (AI only when there is none) and returns the same draft a photo import does, so the review screen
 * is shared. Opened by the "Share to Family Recipes" Android share intent with `?url=...&auto=1`, or by hand from Capture.
 */
export default function ImportLinkScreen({ importClient }: { importClient?: ImportClient }) {
  const { ds, householdId } = useApp();
  const styles = useStyles();
  const router = useRouter();
  const params = useLocalSearchParams<{ url?: string; auto?: string }>();
  const client = useMemo(
    () => importClient ?? createImportClient({ baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL, getToken: () => ds.getAccessToken() }),
    [importClient, ds],
  );
  const [text, setText] = useState(typeof params.url === 'string' ? params.url : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<ExtractionOutcome | null>(null);
  const autoDone = useRef<string | null>(null);

  async function read(raw: string) {
    if (!householdId) return;
    const url = extractUrlFromSharedText(raw);
    if (!url) {
      setError('That does not look like a web address. It should start with http:// or https://.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setOutcome(await client.importFromUrl(householdId, url));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that page');
    } finally {
      setBusy(false);
    }
  }

  // A shared link starts reading straight away (once per distinct link): sharing to the app is the user's request.
  useEffect(() => {
    const shared = typeof params.url === 'string' ? params.url : '';
    if (params.auto === '1' && shared && householdId && autoDone.current !== shared) {
      autoDone.current = shared;
      setText(shared);
      void read(shared);
    }
  }, [params.url, params.auto, householdId]);

  if (!householdId) return <EmptyState title="Pick a household first." />;
  if (busy) return <Loading label="Reading the page. This can take a few seconds" />;

  if (outcome) {
    return (
      <ImportReviewScreen
        outcome={outcome}
        client={client}
        intro={INTRO}
        noteFrom="the page"
        backLabel="Back to the link"
        doneLabel="Import another link"
        onDone={() => {
          setOutcome(null);
          setText('');
        }}
        onBack={() => setOutcome(null)}
      />
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">
        Recipe from a web link
      </Text>
      <Muted>
        Paste a link to one recipe page, or share a page from your browser to Family Recipes. We read the recipe from that page, you check it, and it is saved with a link back to the original.
      </Muted>
      <Field
        label="Web address"
        value={text}
        onChangeText={setText}
        keyboardType="url"
        placeholder="https://"
        testID="link-url"
      />
      <ErrorText message={error} />
      <Button title="Read recipe from link" onPress={() => void read(text)} disabled={!text.trim()} testID="link-read" />
      <Muted>
        For your own household&rsquo;s use. One page at a time; recipes stay credited to their author and site. Some sites block automatic reading: use a photo or screenshot instead.
      </Muted>
      <Button title="Back" variant="secondary" onPress={() => router.back()} testID="link-back" />
    </ScrollView>
  );
}
