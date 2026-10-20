import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, Text as RNText, TextInput, View, type TextInputProps } from 'react-native';
import { useRouter } from 'expo-router';
import { useApp } from '@/data/AppContext';
import type { HouseholdSummary } from '@/data/accountSource';
import { messageOf } from '@/lib/accountErrors';
import { daysLeft, formatDate } from '@/lib/accountForms';
import { Button, ErrorText, MIN_TAP, Muted, Text, useStyles, useTheme } from '../ui';

/** Labelled text input with an inline error (the account forms are all label + field + error). */
export function Field({
  label,
  error,
  hint,
  testID,
  ...input
}: TextInputProps & { label: string; error?: string | null | undefined; hint?: string; testID?: string }) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <View>
      <Text style={{ fontWeight: '600', marginBottom: 4 }}>{label}</Text>
      <TextInput
        style={[styles.input, { marginBottom: error || hint ? 4 : 12 }]}
        placeholderTextColor={theme.muted}
        accessibilityLabel={label}
        testID={testID}
        {...input}
      />
      {error ? <ErrorText message={error} /> : hint ? <Muted style={{ marginBottom: 12 }}>{hint}</Muted> : null}
    </View>
  );
}

/** Polite status line (a saved / sent / scheduled outcome). */
export function Notice({ message, testID }: { message?: string | null; testID?: string }) {
  const styles = useStyles();
  if (!message) return null;
  return (
    <View style={styles.banner} accessibilityRole="alert" accessibilityLiveRegion="polite" testID={testID ?? 'notice'}>
      <Text>{message}</Text>
    </View>
  );
}

export function Checkbox({ label, checked, onChange, testID }: { label: string; checked: boolean; onChange: (v: boolean) => void; testID?: string }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityState={{ checked }}
      testID={testID}
      onPress={() => onChange(!checked)}
      style={{ flexDirection: 'row', alignItems: 'center', minHeight: MIN_TAP, gap: 10 }}
    >
      <View
        style={{
          width: 24,
          height: 24,
          borderWidth: 2,
          borderRadius: 4,
          borderColor: theme.primary,
          backgroundColor: checked ? theme.primary : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {checked ? <RNText style={{ color: theme.primaryText, fontWeight: '700' }}>✓</RNText> : null}
      </View>
      <Text style={{ flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

/** A small single-choice selector (radio buttons side by side) for role / expiry / units. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  testID,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
  testID?: string;
}) {
  const theme = useTheme();
  return (
    <View style={{ marginBottom: 12 }} accessibilityRole="radiogroup" accessibilityLabel={label} testID={testID}>
      <Text style={{ fontWeight: '600', marginBottom: 4 }}>{label}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {options.map((o) => {
          const selected = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityLabel={o.label}
              accessibilityState={{ selected }}
              testID={testID ? `${testID}-${o.value}` : undefined}
              onPress={() => onChange(o.value)}
              style={{
                minHeight: MIN_TAP,
                paddingHorizontal: 14,
                borderRadius: 8,
                borderWidth: 1,
                borderColor: theme.primary,
                backgroundColor: selected ? theme.primary : 'transparent',
                justifyContent: 'center',
              }}
            >
              <RNText style={{ color: selected ? theme.primaryText : theme.primary, fontWeight: '600' }}>{o.label}</RNText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  const styles = useStyles();
  return (
    <RNText accessibilityRole="header" style={styles.heading}>
      {children}
    </RNText>
  );
}

export function Card({ children, testID }: { children: React.ReactNode; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={[styles.banner, { marginBottom: 12 }]} testID={testID}>
      {children}
    </View>
  );
}

/** A tappable row (>= 48dp) that navigates or acts. */
export function Row({ title, subtitle, onPress, testID, danger }: { title: string; subtitle?: string; onPress: () => void; testID?: string; danger?: boolean }) {
  const styles = useStyles();
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title}
      testID={testID}
      onPress={onPress}
      style={styles.row}
    >
      <View style={{ flex: 1 }}>
        <Text style={danger ? { color: theme.danger, fontWeight: '600' } : undefined}>{title}</Text>
        {subtitle ? <Muted>{subtitle}</Muted> : null}
      </View>
      <Muted>›</Muted>
    </Pressable>
  );
}

/** Yes/no confirmation. Resolves true only when the destructive button is pressed. */
export function confirm(title: string, message: string, confirmLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: confirmLabel, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

/**
 * Runs an async account action once at a time: `busy` while it runs, `error` = the fixed text of the thrown AccountError.
 * Returns the action's result, or `undefined` on failure.
 */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      if (alive.current) setError(messageOf(e));
      return undefined;
    } finally {
      if (alive.current) setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}

/** The signed-in user's memberships, reloadable (also after a reconnect: `syncVersion`). */
export function useMemberships() {
  const { ds, syncVersion } = useApp();
  const [memberships, setMemberships] = useState<HouseholdSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setMemberships(await ds.account.listMemberships());
      setError(null);
    } catch (e) {
      setError(messageOf(e));
    }
  }, [ds]);
  useEffect(() => {
    void reload();
  }, [reload, syncVersion]);
  return { memberships, error, reload };
}

/** The active household's summary (role, status, purge date), reloadable. */
export function useActiveHousehold() {
  const { householdId } = useApp();
  const m = useMemberships();
  const household = m.memberships?.find((h) => h.id === householdId) ?? null;
  return { ...m, householdId, household };
}

/** Read-only banner during the 14-day deletion grace (owner decision D). Owners get the cancel button. */
export function ReadOnlyBanner({ household, onCancel, busy }: { household: HouseholdSummary; onCancel: () => void; busy?: boolean }) {
  const styles = useStyles();
  if (household.status !== 'pending_deletion') return null;
  const when = household.purgeAfter;
  const days = when ? daysLeft(when) : null;
  return (
    <View style={styles.banner} accessibilityRole="alert" testID="read-only-banner">
      <Text style={{ fontWeight: '600' }}>This household is pending deletion and is read-only.</Text>
      <Muted>
        {when
          ? `${household.name} will be permanently deleted on ${formatDate(when)} (${days} ${days === 1 ? 'day' : 'days'} left). `
          : ''}
        You can still view and export your data.
      </Muted>
      {household.role === 'owner' ? (
        <Button title="Cancel deletion" variant="secondary" onPress={onCancel} disabled={!!busy} testID="cancel-household-deletion" />
      ) : (
        <Muted>Only an owner can cancel the deletion.</Muted>
      )}
    </View>
  );
}

/** Back to the household picker (used when no household is active, e.g. after a cold start). */
export function NoHousehold() {
  const router = useRouter();
  const styles = useStyles();
  return (
    <View style={styles.centered}>
      <Text style={{ textAlign: 'center', marginBottom: 12 }}>Choose a household first.</Text>
      <Button title="Choose a household" onPress={() => router.replace('/households')} testID="choose-household" />
    </View>
  );
}
