import React, { useEffect, useState } from 'react';
import { ScrollView } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { ACCOUNT_ERROR_MESSAGES } from '@/lib/accountErrors';
import { INVITE_TOKEN_RE } from '@/lib/inviteLink';
import { setPendingNext } from '@/lib/pendingNext';
import { useAction } from './account/parts';
import { Button, ErrorText, Loading, Muted, Text, useStyles } from './ui';

/**
 * `familyrecipes://invite/<token>` or `https://<web host>/invite/<token>` (web: /invite/[token]). Signed in: one button calls
 * `accept_invitation`. Signed out: the invitation is remembered (for an hour, on this device) while the person signs in or
 * creates an account, then it resumes here. The token comes from the route, is validated, and is never logged.
 */
export default function InviteAcceptScreen() {
  const { ds, setHouseholdId } = useApp();
  const router = useRouter();
  const styles = useStyles();
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const raw = Array.isArray(params.token) ? params.token[0] : params.token;
  const token = (raw ?? '').toLowerCase();
  const valid = INVITE_TOKEN_RE.test(token);
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (!valid) return;
    let alive = true;
    ds.getSession().then(
      (s) => alive && setSignedIn(!!s),
      () => alive && setSignedIn(false),
    );
    return () => {
      alive = false;
    };
  }, [ds, valid]);

  if (!valid) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }} style={styles.screen}>
        <Text style={styles.title} accessibilityRole="header">
          Invitation not valid
        </Text>
        <Text testID="invite-invalid">{ACCOUNT_ERROR_MESSAGES.invitation_invalid}</Text>
        <Button title="Go to sign in" variant="secondary" onPress={() => router.replace('/sign-in')} testID="to-sign-in" />
      </ScrollView>
    );
  }
  if (signedIn === null) return <Loading label="Checking your sign-in" />;

  async function accept() {
    const res = await run(() => ds.account.acceptInvitation(token));
    if (res) {
      setHouseholdId(res.householdId);
      router.replace('/recipes');
    }
  }

  async function goSignedOut(target: '/sign-in' | '/sign-up') {
    await setPendingNext(`/invite/${token}`);
    router.replace(target);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} style={styles.screen}>
      <Text style={styles.title} accessibilityRole="header">
        Join a household
      </Text>
      <ErrorText message={error} />
      {signedIn ? (
        <>
          <Text>You have been invited to join a household on Family Recipes.</Text>
          <Button title={busy ? 'Joining...' : 'Accept invitation'} onPress={accept} disabled={busy} testID="accept-invite" />
        </>
      ) : (
        <>
          <Text>Sign in or create an account to accept this invitation.</Text>
          <Muted>We will bring you back here afterwards.</Muted>
          <Button title="Sign in" onPress={() => void goSignedOut('/sign-in')} testID="invite-sign-in" />
          <Button title="Create an account" variant="secondary" onPress={() => void goSignedOut('/sign-up')} testID="invite-sign-up" />
        </>
      )}
    </ScrollView>
  );
}
