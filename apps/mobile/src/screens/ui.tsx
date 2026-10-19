import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text as RNText,
  useColorScheme,
  View,
  type TextProps,
} from 'react-native';

/** Minimum touch target (dp). Android guidance is 48dp. */
export const MIN_TAP = 48;

export const palette = {
  light: {
    bg: '#ffffff',
    surface: '#f3f5f3',
    text: '#14181a',
    muted: '#555d60',
    border: '#c5cbc8',
    primary: '#1b5e20',
    primaryText: '#ffffff',
    danger: '#b00020',
    warn: '#8a4b00',
    toast: '#323232',
    toastText: '#ffffff',
  },
  dark: {
    bg: '#101312',
    surface: '#1b201e',
    text: '#eef1ef',
    muted: '#aab2ae',
    border: '#3b4440',
    primary: '#7bd47f',
    primaryText: '#08240b',
    danger: '#ff8a80',
    warn: '#ffcc80',
    toast: '#e8ece9',
    toastText: '#141a16',
  },
} as const;

export type Theme = { [K in keyof (typeof palette)['light']]: string };

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? palette.dark : palette.light;
}

function makeStyles(t: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, padding: 16, backgroundColor: t.bg },
    centered: { flex: 1, padding: 16, justifyContent: 'center', backgroundColor: t.bg },
    title: { fontSize: 24, fontWeight: '700', marginBottom: 12, color: t.text },
    heading: { fontSize: 18, fontWeight: '600', marginTop: 16, marginBottom: 6, color: t.text },
    text: { color: t.text, fontSize: 16 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      minHeight: MIN_TAP + 8,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.border,
    },
    muted: { color: t.muted, fontSize: 14 },
    input: {
      borderWidth: 1,
      borderColor: t.border,
      borderRadius: 8,
      padding: 12,
      minHeight: MIN_TAP,
      marginBottom: 12,
      color: t.text,
      backgroundColor: t.surface,
      fontSize: 16,
    },
    button: {
      backgroundColor: t.primary,
      minHeight: MIN_TAP,
      paddingHorizontal: 16,
      borderRadius: 8,
      alignItems: 'center',
      justifyContent: 'center',
      marginVertical: 6,
    },
    buttonSecondary: {
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderColor: t.primary,
    },
    buttonText: { color: t.primaryText, fontWeight: '600', fontSize: 16 },
    buttonTextSecondary: { color: t.primary, fontWeight: '600', fontSize: 16 },
    disabled: { opacity: 0.5 },
    error: { color: t.danger, marginBottom: 8, fontSize: 15 },
    pending: { color: t.warn, fontSize: 13 },
    banner: {
      backgroundColor: t.surface,
      borderRadius: 8,
      padding: 12,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: t.border,
    },
    toast: {
      position: 'absolute',
      left: 16,
      right: 16,
      bottom: 24,
      backgroundColor: t.toast,
      borderRadius: 8,
      padding: 14,
      minHeight: MIN_TAP,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    toastText: { color: t.toastText, flex: 1, fontSize: 15 },
    empty: { alignItems: 'center', padding: 24 },
  });
}

export type Styles = ReturnType<typeof makeStyles>;

export function useStyles(): Styles {
  const t = useTheme();
  return useMemo(() => makeStyles(t), [t]);
}

/** Text that follows the colour scheme (plain RN Text is always black). */
export function Text(props: TextProps) {
  const styles = useStyles();
  return <RNText {...props} style={[styles.text, props.style]} />;
}

export function Muted(props: TextProps) {
  const styles = useStyles();
  return <RNText {...props} style={[styles.muted, props.style]} />;
}

export function Button({
  title,
  onPress,
  disabled,
  testID,
  variant = 'primary',
  accessibilityLabel,
  accessibilityHint,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  variant?: 'primary' | 'secondary';
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  const styles = useStyles();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      {...(accessibilityHint ? { accessibilityHint } : {})}
      accessibilityState={{ disabled: !!disabled }}
      testID={testID}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, variant === 'secondary' && styles.buttonSecondary, disabled && styles.disabled]}
    >
      <RNText style={variant === 'secondary' ? styles.buttonTextSecondary : styles.buttonText}>{title}</RNText>
    </Pressable>
  );
}

export function ErrorText({ message }: { message?: string | null }) {
  const styles = useStyles();
  if (!message) return null;
  return (
    <RNText accessibilityRole="alert" style={styles.error}>
      {message}
    </RNText>
  );
}

export function Centered({ children }: { children: React.ReactNode }) {
  const styles = useStyles();
  return <View style={styles.centered}>{children}</View>;
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  const styles = useStyles();
  const t = useTheme();
  return (
    <View style={styles.centered} accessible accessibilityLabel={label} accessibilityRole="progressbar">
      <ActivityIndicator size="large" color={t.primary} accessibilityLabel="Loading" />
      <Muted style={{ textAlign: 'center', marginTop: 8 }}>{label}...</Muted>
    </View>
  );
}

export function EmptyState({ title, hint, children }: { title: string; hint?: string; children?: React.ReactNode }) {
  const styles = useStyles();
  return (
    <View style={styles.empty} accessible accessibilityLabel={hint ? `${title}. ${hint}` : title}>
      <Text style={{ fontWeight: '600', textAlign: 'center' }}>{title}</Text>
      {hint ? <Muted style={{ textAlign: 'center', marginTop: 4 }}>{hint}</Muted> : null}
      {children}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const styles = useStyles();
  return (
    <View style={styles.centered}>
      <ErrorText message={message} />
      {onRetry ? <Button title="Try again" onPress={onRetry} testID="retry" /> : null}
    </View>
  );
}

/** Dismissible toast (used for sync conflicts). `role=alert` so TalkBack announces it. */
export function Toast({ message, onDismiss }: { message: string | null; onDismiss: () => void }) {
  const styles = useStyles();
  if (!message) return null;
  return (
    <View style={styles.toast} accessibilityRole="alert" accessibilityLiveRegion="assertive" testID="toast">
      <RNText style={styles.toastText}>{message}</RNText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss message"
        onPress={onDismiss}
        style={{ minWidth: MIN_TAP, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
        testID="toast-dismiss"
      >
        <RNText style={[styles.toastText, { flex: 0, fontWeight: '700' }]}>OK</RNText>
      </Pressable>
    </View>
  );
}
