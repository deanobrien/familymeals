import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { isEmail, isNewPassword, MIN_PASSWORD } from '@/lib/accountForms';
import { takePendingNext } from '@/lib/pendingNext';
import { Field, Notice, useAction } from './account/parts';
import { Button, ErrorText, Muted, Text, useStyles } from './ui';

/** Email + password (>= 10 characters). The confirmation email's link opens `familyrecipes://auth/callback`. */
export default function SignUpScreen() {
  const { ds } = useApp();
  const router = useRouter();
  const styles = useStyles();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [sent, setSent] = useState(false);
  const [resent, setResent] = useState(false);
  const { busy, error, run } = useAction();

  async function submit() {
    const errs: { email?: string; password?: string } = {};
    if (!isEmail(email)) errs.email = 'Enter a valid email address';
    if (!isNewPassword(password)) errs.password = `Choose a password of at least ${MIN_PASSWORD} characters`;
    setFieldErrors(errs);
    if (errs.email || errs.password) return;
    const res = await run(() => ds.account.signUp(email, password));
    if (!res) return;
    // With email confirmation off there is a session already: straight on to onboarding.
    if (res.signedIn) router.replace((await takePendingNext()) ?? '/household/new');
    else setSent(true);
  }

  async function resend() {
    const ok = await run(async () => {
      await ds.account.resendConfirmation(email);
      return true;
    });
    if (ok) setResent(true);
  }

  if (sent) {
    return (
      <ScrollView contentContainerStyle={{ padding: 16 }} style={styles.screen}>
        <Text style={styles.title} accessibilityRole="header">
          Check your email
        </Text>
        <Text testID="sign-up-sent">
          If that address can be used, we have sent a confirmation email. Open the link on this phone to finish creating your account.
        </Text>
        <Muted style={{ marginTop: 8 }}>
          If the link does not open the app (for example you opened it on a computer), your email is still confirmed: come back here and sign in with your
          password.
        </Muted>
        <ErrorText message={error} />
        <Notice message={resent ? 'We have sent another confirmation email.' : null} testID="resent-notice" />
        <Button title="Resend confirmation email" variant="secondary" onPress={resend} disabled={busy} testID="resend-confirmation" />
        <Button title="Back to sign in" onPress={() => router.replace('/sign-in')} testID="back-to-sign-in" />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} style={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">
        Create an account
      </Text>
      <Field
        label="Email"
        value={email}
        onChangeText={setEmail}
        error={fieldErrors.email}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        textContentType="emailAddress"
        testID="sign-up-email"
      />
      <Field
        label="Password"
        value={password}
        onChangeText={setPassword}
        error={fieldErrors.password}
        hint={`At least ${MIN_PASSWORD} characters.`}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        onSubmitEditing={submit}
        testID="sign-up-password"
      />
      <ErrorText message={error} />
      <Button title={busy ? 'Creating account...' : 'Create account'} onPress={submit} disabled={busy} testID="sign-up-submit" />
      <Button title="I already have an account" variant="secondary" onPress={() => router.replace('/sign-in')} testID="go-sign-in" />
    </ScrollView>
  );
}
