import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { isEmail } from '@/lib/accountForms';
import { Field, Notice, useAction } from './account/parts';
import { Button, ErrorText, Muted, Text, useStyles } from './ui';

/** Request a password-reset email. The answer is identical for known and unknown addresses (threat A5). */
export default function ForgotPasswordScreen() {
  const { ds } = useApp();
  const router = useRouter();
  const styles = useStyles();
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const { busy, error, run } = useAction();

  async function submit() {
    if (!isEmail(email)) {
      setFieldError('Enter a valid email address');
      return;
    }
    setFieldError(null);
    const ok = await run(async () => {
      await ds.account.requestPasswordReset(email);
      return true;
    });
    if (ok) setSent(true);
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} style={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">
        Reset your password
      </Text>
      {sent ? (
        <>
          <Notice message="If that address has an account, we have sent a link to reset the password. Open it on this phone." testID="reset-sent" />
          <Muted>The link works once and expires after a short time. Request another if it does not.</Muted>
        </>
      ) : (
        <>
          <Muted style={{ marginBottom: 12 }}>Enter the email address you signed up with and we will email you a reset link.</Muted>
          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            error={fieldError}
            autoCapitalize="none"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            onSubmitEditing={submit}
            testID="forgot-email"
          />
          <ErrorText message={error} />
          <Button title={busy ? 'Sending...' : 'Send reset link'} onPress={submit} disabled={busy} testID="forgot-submit" />
        </>
      )}
      <Button title="Back to sign in" variant="secondary" onPress={() => router.replace('/sign-in')} testID="back-to-sign-in" />
    </ScrollView>
  );
}
