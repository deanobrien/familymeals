import React, { useState } from 'react';
import { TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import { Button, Centered, ErrorText, Text, useStyles, useTheme } from './ui';

export default function SignInScreen() {
  const { ds } = useApp();
  const router = useRouter();
  const styles = useStyles();
  const theme = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await ds.signIn(email.trim(), password);
      router.replace('/households');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Centered>
      <Text style={styles.title} accessibilityRole="header">
        Family Recipes
      </Text>
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
      <Button title={busy ? 'Signing in...' : 'Sign in'} onPress={submit} disabled={busy} testID="sign-in" />
    </Centered>
  );
}
