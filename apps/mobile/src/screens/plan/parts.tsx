import React from 'react';
import { Pressable, TextInput, View } from 'react-native';
import { Button, MIN_TAP, Muted, Text, useStyles, useTheme } from '../ui';

/** A removable / toggleable pill. 48dp tall so it is a real tap target. */
export function Chip({
  label, onPress, onRemove, removeLabel, locked, selected, testID, accessibilityLabel,
}: {
  label: string; accessibilityLabel?: string; onPress?: () => void; onRemove?: () => void; removeLabel?: string; locked?: boolean; selected?: boolean; testID?: string;
}) {
  const t = useTheme();
  const border = selected ? t.primary : t.border;
  return (
    <View
      testID={testID}
      style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: border, borderRadius: 24, backgroundColor: selected ? t.surface : 'transparent', marginRight: 8, marginBottom: 8, minHeight: MIN_TAP }}
    >
      <Pressable
        accessibilityRole={onPress ? 'button' : 'text'}
        accessibilityLabel={accessibilityLabel ?? (locked ? `${label} (locked)` : label)}
        {...(onPress ? { accessibilityState: { selected: !!selected } } : {})}
        disabled={!onPress}
        onPress={onPress}
        style={{ minHeight: MIN_TAP, justifyContent: 'center', paddingLeft: 14, paddingRight: onRemove ? 4 : 14 }}
      >
        <Text>{label}{locked ? ' (locked)' : ''}</Text>
      </Pressable>
      {onRemove ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={removeLabel ?? `Remove ${label}`}
          onPress={onRemove}
          style={{ minWidth: MIN_TAP, minHeight: MIN_TAP, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text>x</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{children}</View>;
}

/** Labelled text input. */
export function Field({
  label, value, onChangeText, placeholder, keyboardType, multiline, maxLength, testID,
}: {
  label: string; value: string; onChangeText: (t: string) => void; placeholder?: string; keyboardType?: 'default' | 'numeric' | 'decimal-pad'; multiline?: boolean; maxLength?: number; testID?: string;
}) {
  const styles = useStyles();
  const t = useTheme();
  return (
    <View>
      <Muted>{label}</Muted>
      <TextInput
        accessibilityLabel={label}
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={t.muted}
        keyboardType={keyboardType ?? 'default'}
        multiline={multiline}
        {...(maxLength ? { maxLength } : {})}
        style={[styles.input, multiline ? { minHeight: 96, textAlignVertical: 'top' } : null]}
      />
    </View>
  );
}

/** - value + with 48dp buttons. */
export function Stepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  const t = useTheme();
  const btn = { minWidth: MIN_TAP, minHeight: MIN_TAP, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: t.primary, borderRadius: 8 };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 6 }}>
      <Text>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Decrease ${label}`} accessibilityState={{ disabled: value <= min }} disabled={value <= min} onPress={() => onChange(Math.max(min, value - 1))} style={btn}>
          <Text>-</Text>
        </Pressable>
        <Text accessibilityLabel={`${label}: ${value}`} style={{ minWidth: 40, textAlign: 'center', fontWeight: '700' }}>{value}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`Increase ${label}`} accessibilityState={{ disabled: value >= max }} disabled={value >= max} onPress={() => onChange(Math.min(max, value + 1))} style={btn}>
          <Text>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

/** A bordered group with a heading (used for the sections of the planner). */
export function Section({ title, children, testID }: { title: string; children: React.ReactNode; testID?: string }) {
  const styles = useStyles();
  return (
    <View testID={testID} style={styles.banner}>
      <Text style={{ fontWeight: '700', marginBottom: 6 }} accessibilityRole="header">{title}</Text>
      {children}
    </View>
  );
}

/** Message banner: errors are announced (alert); info is a status. Lists server `violations` when given. */
export function Notice({ tone, text, items, testID, children }: { tone: 'info' | 'error'; text: string; items?: string[]; testID?: string; children?: React.ReactNode }) {
  const styles = useStyles();
  const t = useTheme();
  return (
    <View testID={testID} accessibilityRole={tone === 'error' ? 'alert' : 'summary'} style={[styles.banner, tone === 'error' ? { borderColor: t.danger } : null]}>
      <Text style={tone === 'error' ? { color: t.danger } : undefined}>{text}</Text>
      {items?.map((i) => <Muted key={i}>{`- ${i}`}</Muted>)}
      {children}
    </View>
  );
}

export { Button };
