import React, { useState } from 'react';
import { Modal, Pressable, Text as RNText, View } from 'react-native';
import { lockLabel, type DevicePinGate } from '@fr/engine/kids';
import { useTheme } from '../ui';

/**
 * The grown-up PIN pad (P3-A, D424): digits only (no keyboard), wrong guesses lock it for longer each time (30 seconds, then
 * doubling), and the lock survives closing the app. `onOpen` runs only after the device-local PIN check passes.
 */
export default function PinPad({ gate, onOpen, onCancel }: { gate: DevicePinGate; onOpen: () => void; onCancel: () => void }) {
  const t = useTheme();
  const [digits, setDigits] = useState('');
  const [msg, setMsg] = useState('');
  const press = (d: string) => {
    if (digits.length >= 6) return;
    setMsg('');
    setDigits(digits + d);
  };
  const submit = async () => {
    const r = await gate.verify(digits);
    if (r.ok) return onOpen();
    setDigits('');
    if (r.reason === 'locked' || (r.reason === 'wrong' && r.retryAfterMs > 0)) setMsg(`Too many tries. Try again in ${lockLabel(r.retryAfterMs)}.`);
    else setMsg('That is not the PIN.');
  };
  const key = (label: string, onPress: () => void, testID: string, accessibilityLabel = label, disabled = false) => (
    <Pressable
      key={testID} accessibilityRole="button" accessibilityLabel={accessibilityLabel} testID={testID} onPress={onPress} disabled={disabled}
      style={{ width: 76, height: 76, borderRadius: 38, borderWidth: 2, borderColor: t.border, backgroundColor: t.surface, alignItems: 'center', justifyContent: 'center', margin: 6, opacity: disabled ? 0.4 : 1 }}
    >
      <RNText style={{ fontSize: 28, color: t.text }}>{label}</RNText>
    </Pressable>
  );
  return (
    <Modal transparent animationType="fade" onRequestClose={() => undefined} visible>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', alignItems: 'center', justifyContent: 'center' }} testID="pin-pad">
        <View style={{ backgroundColor: t.bg, borderRadius: 20, padding: 20, alignItems: 'center', width: 300 }}>
          <RNText style={{ fontSize: 18, fontWeight: '600', color: t.text }}>Grown-up PIN</RNText>
          <RNText style={{ fontSize: 32, letterSpacing: 8, color: t.text, minHeight: 48 }} testID="pin-dots" accessibilityLabel={`${digits.length} digits entered`}>
            {digits ? '●'.repeat(digits.length) : '• • • •'}
          </RNText>
          <RNText accessibilityRole="alert" style={{ color: t.danger, minHeight: 24, textAlign: 'center' }} testID="pin-message">{msg}</RNText>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => key(d, () => press(d), `pin-${d}`))}
            {key('⌫', () => setDigits(digits.slice(0, -1)), 'pin-del', 'Delete')}
            {key('0', () => press('0'), 'pin-0')}
            {key('✔', () => void submit(), 'pin-ok', 'Unlock', digits.length < 4)}
          </View>
          <Pressable accessibilityRole="button" onPress={onCancel} testID="pin-cancel" style={{ minHeight: 48, justifyContent: 'center' }}>
            <RNText style={{ color: t.text, textDecorationLine: 'underline' }}>Back to voting</RNText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
