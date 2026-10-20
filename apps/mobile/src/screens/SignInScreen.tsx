import React, { useState } from 'react';
import { TextInput } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { AccountError, messageOf } from '@/lib/accountErrors';
import { takePendingNext } from '@/lib/pendingNext';
import { Notice } from './account/parts';
import { Button, Centered, ErrorText, Text, useStyles, useTheme } from './ui';

export default function SignInScreen() {
  const { ds } = useApp();
  const router = useRouter();
  const params = useLocalSearchParams<{ deleted?: string }>();
  const styles = useStyles();
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unconfirmed, setUnconfirmed] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    setNotice(null);
    setUnconfirmed(false);
    try {
      await ds.signIn(email.trim(), password);
      // A pending invitation (an invite link opened while signed out) resumes here.
      router.replace((await takePendingNext()) ?? '/households');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
      setUnconfirmed(e instanceof AccountError && e.code === 'email_not_confirmed');
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    setBusy(true);
    setError(null);
    try {
      await ds.account.resendConfirmation(email);
      setUnconfirmed(false);
      // Same answer for unknown, pending and confirmed addresses (no enumeration).
      setNotice('If that address needs confirming, we have sent a new confirmation email.');
    } catch (e) {
      setError(messageOf(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Centered>
      <Text style={styles.title} accessibilityRole="header">
        Family Recipes
      </Text>
      {params.deleted === '1' ? (
        <Notice message="Your account deletion is scheduled. You have been signed out; it is removed at the next clean-up." testID="deleted-notice" />
      ) : null}
      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={theme.muted}
        accessibilityLabel="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={theme.muted}
        accessibilityLabel="Password"
        secureTextEntry
        autoComplete="password"
        textContentType="password"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
      />
      <ErrorText message={error} />
      <Notice message={notice} testID="resent-notice" />
      <Button title={busy ? 'Signing in...' : 'Sign in'} onPress={submit} disabled={busy} testID="sign-in" />
      {unconfirmed ? <Button title="Resend confirmation email" variant="secondary" onPress={resend} disabled={busy} testID="resend-confirmation" /> : null}
      <Button title="Create an account" variant="secondary" onPress={() => router.push('/sign-up')} testID="go-sign-up" />
      <Button title="Forgot your password?" variant="secondary" onPress={() => router.push('/forgot-password')} testID="go-forgot" />
    </Centered>
  );
}
