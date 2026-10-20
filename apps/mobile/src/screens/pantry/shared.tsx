import React from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import type { Badge } from '@/lib/pantryApi';
import { MIN_TAP, useStyles, useTheme } from '../ui';

/** Expiry/state badge. The label is text ("Expires today"), the tone only adds colour and a marker, never carries meaning alone. */
export function BadgeText({ badge, testID }: { badge: Badge; testID?: string }) {
  const t = useTheme();
  const color = badge.tone === 'danger' ? t.danger : badge.tone === 'warning' ? t.warn : badge.tone === 'success' ? t.primary : t.muted;
  const marker = badge.tone === 'danger' ? '! ' : badge.tone === 'warning' ? '~ ' : '';
  return (
    <RNText testID={testID} style={{ color, fontSize: 14, fontWeight: '600' }} accessibilityLabel={badge.label}>
      {marker}
      {badge.label}
    </RNText>
  );
}

/** A selectable pill (units, modes). 48dp tall. */
export function Chip({ label, selected, onPress, testID, accessibilityLabel }: { label: string; selected: boolean; onPress: () => void; testID?: string; accessibilityLabel?: string }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      testID={testID}
      onPress={onPress}
      style={{
        minHeight: MIN_TAP, minWidth: MIN_TAP, paddingHorizontal: 14, justifyContent: 'center', alignItems: 'center',
        borderRadius: 24, borderWidth: 1, marginRight: 8, marginBottom: 8,
        borderColor: selected ? t.primary : t.border, backgroundColor: selected ? t.primary : 'transparent',
      }}
    >
      <RNText style={{ color: selected ? t.primaryText : t.text, fontWeight: '600', fontSize: 15 }}>{label}</RNText>
    </Pressable>
  );
}

export function ChipRow({ children }: { children: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{children}</View>;
}

/** A titled block. */
export function Section({ title, children, testID }: { title: string; children: React.ReactNode; testID?: string }) {
  const styles = useStyles();
  return (
    <View testID={testID}>
      <RNText accessibilityRole="header" style={styles.heading}>
        {title}
      </RNText>
      {children}
    </View>
  );
}
