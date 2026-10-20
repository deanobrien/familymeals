import { useEffect, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import { Redirect, useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { ErrorState, Loading } from '@/screens/ui';

/**
 * Landing route for `familyrecipes://auth/callback` (confirmation / recovery links). The tokens or code in the URL are
 * handed to the data source, which establishes the session; then on to the household picker.
 */
export default function AuthCallback() {
  const { ds } = useApp();
  const router = useRouter();
  const url = Linking.useLinkingURL();
  const [state, setState] = useState<'working' | 'done' | { error: string }>('working');
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!url || handled.current === url) return;
    handled.current = url;
    if (!ds.completeAuthLink) {
      setState({ error: 'This build cannot finish sign-in from a link. Sign in with your email and password.' });
      return;
    }
    ds.completeAuthLink(url).then(
      (s) => setState(s ? 'done' : { error: 'That link did not contain a sign-in. Try signing in with your email and password.' }),
      (e: unknown) => setState({ error: e instanceof Error ? e.message : 'That link could not be used.' }),
    );
  }, [ds, url]);

  if (state === 'done') return <Redirect href="/households" />;
  if (typeof state === 'object') return <ErrorState message={state.error} onRetry={() => router.replace('/sign-in')} />;
  return <Loading label="Signing you in" />;
}
