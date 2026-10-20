import React, { useEffect, useState } from 'react';
import { Image, Pressable, Text as RNText, TextInput, View, type KeyboardTypeOptions } from 'react-native';
import { useApp } from '@/data/AppContext';
import { MIN_TAP, Muted, Text, useStyles, useTheme } from './ui';

/** Small shared form/list widgets for the recipe screens (48dp targets, labelled for TalkBack). */

export function Chip({
  label,
  selected,
  onPress,
  testID,
  accessibilityLabel,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected: !!selected }}
      testID={testID}
      onPress={onPress}
      style={{
        minHeight: 40,
        paddingHorizontal: 14,
        justifyContent: 'center',
        borderRadius: 20,
        borderWidth: 1,
        borderColor: selected ? t.primary : t.border,
        backgroundColor: selected ? t.primary : 'transparent',
        marginRight: 8,
        marginBottom: 8,
      }}
    >
      <RNText style={{ color: selected ? t.primaryText : t.text, fontSize: 14 }}>{label}</RNText>
    </Pressable>
  );
}

export function ChipWrap({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 4 }}>{children}</View>;
}

/** Single choice from a short list, shown as chips ("Any" clears it). */
export function OptionRow<T extends string | number>({
  label,
  options,
  value,
  onChange,
  anyLabel = 'Any',
  testID,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T | undefined;
  onChange: (v: T | undefined) => void;
  anyLabel?: string | null;
  testID?: string;
}) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} testID={testID} style={{ marginBottom: 8 }}>
      <Muted>{label}</Muted>
      <ChipWrap>
        {anyLabel !== null && <Chip label={anyLabel} selected={value === undefined} onPress={() => onChange(undefined)} accessibilityLabel={`${label}: ${anyLabel}`} />}
        {options.map((o) => (
          <Chip
            key={String(o.value)}
            label={o.label}
            selected={value === o.value}
            testID={testID ? `${testID}-${o.value}` : undefined}
            accessibilityLabel={`${label}: ${o.label}`}
            onPress={() => onChange(value === o.value && anyLabel !== null ? undefined : o.value)}
          />
        ))}
      </ChipWrap>
    </View>
  );
}

export function Field({
  label,
  value,
  onChangeText,
  placeholder,
  multiline,
  keyboardType,
  error,
  testID,
  editable = true,
  hint,
  onBlur,
}: {
  label: string;
  value: string;
  onChangeText: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  error?: string | undefined;
  testID?: string;
  editable?: boolean;
  hint?: string;
  onBlur?: () => void;
}) {
  const styles = useStyles();
  const t = useTheme();
  return (
    <View style={{ marginBottom: 4 }}>
      <Muted>{label}</Muted>
      <TextInput
        accessibilityLabel={label}
        placeholder={placeholder ?? label}
        placeholderTextColor={t.muted}
        value={value}
        onChangeText={onChangeText}
        onBlur={onBlur}
        multiline={multiline}
        editable={editable}
        keyboardType={keyboardType}
        testID={testID}
        style={[styles.input, multiline && { minHeight: 80, textAlignVertical: 'top' }, !editable && { opacity: 0.6 }]}
      />
      {hint ? <Muted style={{ marginTop: -8, marginBottom: 8 }}>{hint}</Muted> : null}
      {error ? (
        <RNText accessibilityRole="alert" style={[styles.error, { marginTop: -8 }]}>
          {error}
        </RNText>
      ) : null}
    </View>
  );
}

/** Text field that keeps what the person typed (including trailing spaces) while committing the value upward as they type. */
export function CommitField({
  label,
  value,
  onCommit,
  multiline,
  testID,
  hint,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  testID?: string;
  hint?: string;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => {
    setLocal((cur) => (cur.trim() === value ? cur : value));
  }, [value]);
  return (
    <Field
      label={label}
      value={local}
      multiline={multiline}
      testID={testID}
      {...(hint ? { hint } : {})}
      onChangeText={(v) => {
        setLocal(v);
        onCommit(v);
      }}
    />
  );
}

/** Numeric field that keeps what was typed and commits only valid numbers. */
export function NumberField({
  label,
  value,
  onCommit,
  testID,
  error,
  integer,
}: {
  label: string;
  value: number | undefined;
  onCommit: (n: number | undefined) => void;
  testID?: string;
  error?: string | undefined;
  integer?: boolean;
}) {
  const [local, setLocal] = useState(value === undefined ? '' : String(value));
  useEffect(() => {
    setLocal((cur) => (cur.trim() !== '' && Number(cur) === value ? cur : value === undefined ? cur : String(value)));
  }, [value]);
  return (
    <Field
      label={label}
      value={local}
      testID={testID}
      error={error}
      keyboardType={integer ? 'number-pad' : 'decimal-pad'}
      onChangeText={(v) => {
        setLocal(v);
        const n = Number(v);
        if (v.trim() === '') onCommit(undefined);
        else if (Number.isFinite(n) && n >= 0) onCommit(integer ? Math.round(n) : n);
      }}
    />
  );
}

export function Stepper({
  label,
  value,
  min,
  max,
  onChange,
  testID,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
  testID?: string;
}) {
  const t = useTheme();
  const btn = (title: string, a11y: string, next: number, disabled: boolean, id: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      disabled={disabled}
      testID={id}
      onPress={() => onChange(next)}
      style={{ width: MIN_TAP, height: MIN_TAP, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: t.primary, borderRadius: 8, opacity: disabled ? 0.4 : 1 }}
    >
      <RNText style={{ color: t.primary, fontSize: 24 }}>{title}</RNText>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }} accessibilityRole="adjustable" accessibilityLabel={`${label}: ${value}`}>
      {btn('-', `Fewer ${label.toLowerCase()}`, value - 1, value <= min, `${testID ?? 'stepper'}-dec`)}
      <Text testID={`${testID ?? 'stepper'}-value`} style={{ minWidth: 32, textAlign: 'center', fontSize: 20, fontWeight: '600' }}>
        {value}
      </Text>
      {btn('+', `More ${label.toLowerCase()}`, value + 1, value >= max, `${testID ?? 'stepper'}-inc`)}
    </View>
  );
}

/** A recipe cover. Storage paths load through the bearer-protected /api/images route (a signed URL behind a redirect). */
export function RecipeImage({ imageUrl, size = 72, height, label }: { imageUrl: string | null | undefined; size?: number; height?: number; label: string }) {
  const { recipes } = useApp();
  const t = useTheme();
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  useEffect(() => {
    let live = true;
    recipes.imageSource(imageUrl).then(
      (s) => live && setSource(s),
      () => live && setSource(null),
    );
    return () => {
      live = false;
    };
  }, [recipes, imageUrl]);
  const h = height ?? size;
  if (!source) {
    return (
      <View
        accessible
        accessibilityLabel="No photo"
        style={{ width: size, height: h, borderRadius: 8, backgroundColor: t.surface, borderWidth: 1, borderColor: t.border, alignItems: 'center', justifyContent: 'center' }}
      >
        <Muted>No photo</Muted>
      </View>
    );
  }
  return <Image source={source} accessibilityLabel={label} style={{ width: size, height: h, borderRadius: 8 }} resizeMode="cover" testID="recipe-image" />;
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: 'neutral' | 'warn' | 'good' | 'bad' }) {
  const t = useTheme();
  const colour = tone === 'warn' ? t.warn : tone === 'bad' ? t.danger : tone === 'good' ? t.primary : t.muted;
  return (
    <RNText style={{ color: colour, borderColor: colour, borderWidth: 1, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 1, fontSize: 12, marginLeft: 6 }}>{label}</RNText>
  );
}

export function Section({ children, testID }: { children: React.ReactNode; testID?: string }) {
  const styles = useStyles();
  return (
    <View style={styles.banner} testID={testID}>
      {children}
    </View>
  );
}
