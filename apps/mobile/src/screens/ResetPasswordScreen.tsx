import React, { useState } from 'react';
import { ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { isNewPassword, MIN_PASSWORD } from '@/lib/accountForms';
import { Field, useAction } from './account/parts';
import { Button, ErrorText, Text, useStyles } from './ui';

/** Choose a new password after a recovery link (the link established a session for it). */
export default function ResetPasswordScreen() {
  const { ds } = useApp();
  const router = useRouter();
  const styles = useStyles();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const { busy, error, run } = useAction();

  async function submit() {
    const errs: { password?: string; confirm?: string } = {};
    if (!isNewPassword(password)) errs.password = `Choose a password of at least ${MIN_PASSWORD} characters`;
    else if (confirm !== password) errs.confirm = 'The two passwords do not match';
    setErrors(errs);
    if (errs.password || errs.confirm) return;
    const ok = await run(async () => {
      await ds.account.updatePassword(password);
      return true;
    });
    if (ok) router.replace('/households');
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16 }} style={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">
        Choose a new password
      </Text>
      <Field
        label="New password"
        value={password}
        onChangeText={setPassword}
        error={errors.password}
        hint={`At least ${MIN_PASSWORD} characters.`}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        testID="reset-password"
      />
      <Field
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        error={errors.confirm}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        onSubmitEditing={submit}
        testID="reset-confirm"
      />
      <ErrorText message={error} />
      <Button title={busy ? 'Saving...' : 'Save new password'} onPress={submit} disabled={busy} testID="reset-submit" />
      <Button title="Back to sign in" variant="secondary" onPress={() => router.replace('/sign-in')} testID="back-to-sign-in" />
    </ScrollView>
  );
}
