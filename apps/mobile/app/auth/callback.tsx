import { useEffect, useRef, useState } from 'react';
import * as Linking from 'expo-linking';
import { Redirect, useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { takePendingNext } from '@/lib/pendingNext';
import { Button, Centered, ErrorText, Loading } from '@/screens/ui';

/**
 * Landing route for `familyrecipes://auth/callback` (confirmation / recovery links). The tokens or code in the URL are
 * handed to the data source, which establishes the session; then on to a pending invitation, the password-reset screen (a
 * recovery link) or the household picker. Expired / already-used links (some email scanners open links first) get the
 * same plain explanation as the web, with a way to ask for a new link.
 */
export default function AuthCallback() {
  const { ds } = useApp();
  const router = useRouter();
  const url = Linking.useLinkingURL();
  const [state, setState] = useState<{ to: string } | { error: string } | null>(null);
  const handled = useRef<string | null>(null);

  useEffect(() => {
    if (!url || handled.current === url) return;
    handled.current = url;
    if (!ds.completeAuthLink) {
      setState({ error: 'This build cannot finish sign-in from a link. Sign in with your email and password.' });
      return;
    }
    ds.completeAuthLink(url).then(
      async (s) => {
        if (!s) {
          setState({ error: 'That link did not contain a sign-in. Try signing in with your email and password.' });
          return;
        }
        if (s.recovery) {
          setState({ to: '/reset-password' });
          return;
        }
        setState({ to: (await takePendingNext()) ?? '/households' });
      },
      (e: unknown) => setState({ error: e instanceof Error ? e.message : 'That link could not be used.' }),
    );
  }, [ds, url]);

  if (state && 'to' in state) return <Redirect href={state.to as '/households'} />;
  if (state && 'error' in state) {
    return (
      <Centered>
        <ErrorText message={state.error} />
        <Button title="Go to sign in" onPress={() => router.replace('/sign-in')} testID="to-sign-in" />
        <Button title="Send a new reset link" variant="secondary" onPress={() => router.replace('/forgot-password')} testID="to-forgot" />
      </Centered>
    );
  }
  return <Loading label="Signing you in" />;
}
