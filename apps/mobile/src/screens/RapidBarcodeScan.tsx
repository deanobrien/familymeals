import React, { useEffect, useState } from 'react';
import { ScrollView, TextInput, Vibration, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { decrement, increment, normaliseRetailCode, sight, totalCount, undo } from '@fr/engine/pantry';
import { RETAIL_BARCODE_TYPES } from '@/lib/barcode';
import { loadDevicePrefs } from '@/lib/devicePrefs';
import { playScanBeep } from '@/lib/scanSound';
import { PRODUCT_ATTRIBUTION } from '@/lib/productApi';
import type { RapidSession } from './pantryScan/useRapidSession';
import { Button, ErrorText, Muted, Text, useStyles, useTheme } from './ui';

export const KEEP_AWAKE_TAG = 'fr-rapid-scan';

function useScanSound() {
  const on = React.useRef(true);
  useEffect(() => {
    void loadDevicePrefs().then((p) => { on.current = p.scanSound; });
  }, []);
  return on;
}

/** One short tap per COUNTED read (never per repeat of the same pack). Falls back to a vibration if haptics are unavailable. */
function tick() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => Vibration.vibrate(40));
}

/**
 * Continuous barcode scanning (BS1, D344): expo-camera keeps firing `onBarcodeScanned`; each event goes through the same
 * debounce / tally as the web (`@fr/engine/pantry`): the same pack in view counts once, moving away and back counts again.
 * Lookups run in the background (the session's tracker, POST /api/products) and never block the camera. Each counted
 * read gives a haptic tick, and the screen is kept awake while the camera is running and not paused. "Review" hands the
 * tally to the phone's own review (matching, pack sizes, dates, merge preview, confirm); nothing is written here.
 */
export default function RapidBarcodeScan({
  session,
  onReview,
  onClose,
  closeLabel = 'Back',
  now = Date.now,
}: {
  session: RapidSession;
  onReview: () => void;
  onClose: () => void;
  closeLabel?: string;
  now?: () => number;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraOn, setCameraOn] = useState(false);
  const [paused, setPaused] = useState(false);
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { state, lookups, commit, ref } = session;
  const live = cameraOn && !!permission?.granted && !paused;
  // "Scan sound" (Settings, default on): a short beep per counted read; silent mode is respected by the audio session.
  const soundOn = useScanSound();

  // Keep the screen on only while the camera session is live; released on pause, on leaving and on unmount.
  useEffect(() => {
    if (!live) return undefined;
    activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    return () => { deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined); };
  }, [live]);

  function onScanned(event: { data: string; type?: string }) {
    if (paused) return;
    const code = normaliseRetailCode(event.data, event.type);
    if (!code) return;
    const r = sight(ref.current, code, now());
    if (r.counted) {
      tick();
      if (soundOn.current) playScanBeep();
      commit(r.state);
    } else {
      session.note(r.state);
    }
  }

  function addManual() {
    const code = normaliseRetailCode(manual);
    if (!code) { setError('Enter the 8, 12 or 13 digits printed under the barcode.'); return; }
    setError(null);
    const known = ref.current.items.some((i) => i.barcode === code);
    commit(known ? increment(ref.current, code) : sight(ref.current, code, now()).state);
    setManual('');
  }

  const total = totalCount(state);
  const labelFor = (code: string): string => {
    const st = lookups.get(code);
    if (st?.state === 'done') return st.value.name;
    if (st?.state === 'notfound') return 'Unknown product';
    if (st?.state === 'error') return 'Lookup failed';
    return 'Looking up...';
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">
        Scan many barcodes
      </Text>
      <Muted>Point at each barcode in turn. Scan the same product again to add another. Nothing is added until you review and confirm.</Muted>

      {cameraOn && permission?.granted && (
        <View style={{ height: 260, marginVertical: 12 }}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            accessibilityLabel="Barcode camera preview"
            barcodeScannerSettings={{ barcodeTypes: [...RETAIL_BARCODE_TYPES] }}
            onBarcodeScanned={onScanned}
          />
        </View>
      )}
      {!cameraOn ? (
        <Button
          title={total > 0 ? 'Resume scanning' : 'Start camera'}
          testID="rapid-start"
          onPress={async () => {
            if (!permission?.granted) {
              const p = await requestPermission();
              if (!p.granted) { setError('Camera permission denied. You can still type barcodes.'); return; }
            }
            setError(null);
            setCameraOn(true);
          }}
        />
      ) : (
        <View style={{ gap: 8 }}>
          <Button title={paused ? 'Resume' : 'Pause'} variant="secondary" testID="rapid-pause" onPress={() => setPaused((p) => !p)} />
          <Button title="Undo last" variant="secondary" testID="rapid-undo" disabled={state.history.length === 0} onPress={() => commit(undo(ref.current))} />
        </View>
      )}

      <Text accessibilityLiveRegion="polite" testID="rapid-counter" style={styles.heading}>
        {total} {total === 1 ? 'item' : 'items'} scanned
      </Text>

      {[...state.items].reverse().map((i) => (
        <View key={i.barcode} testID="rapid-row" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginVertical: 4 }}>
          <View style={{ flex: 1 }}>
            <Text>{labelFor(i.barcode)}</Text>
            <Muted>{i.barcode}</Muted>
          </View>
          <Button title="-" variant="secondary" accessibilityLabel={`Remove one ${labelFor(i.barcode)}`} testID="rapid-minus" onPress={() => commit(decrement(ref.current, i.barcode))} />
          <Text testID="rapid-count">x{i.count}</Text>
          <Button title="+" variant="secondary" accessibilityLabel={`Add one ${labelFor(i.barcode)}`} testID="rapid-plus" onPress={() => commit(increment(ref.current, i.barcode))} />
        </View>
      ))}
      {[...lookups.values()].some((l) => l.state === 'done') && <Muted>{PRODUCT_ATTRIBUTION}</Muted>}

      <TextInput
        style={styles.input}
        placeholder="Or type a barcode"
        placeholderTextColor={theme.muted}
        accessibilityLabel="Barcode digits"
        keyboardType="number-pad"
        value={manual}
        onChangeText={setManual}
        onSubmitEditing={addManual}
        testID="rapid-input"
      />
      <Button title="Add" variant="secondary" testID="rapid-add" onPress={addManual} disabled={manual.trim() === ''} />
      <ErrorText message={error} />

      <Button
        title={total === 0 ? 'Review' : `Review ${state.items.length} ${state.items.length === 1 ? 'product' : 'products'}`}
        testID="rapid-review"
        accessibilityHint="Check the scanned products, add dates, then add them to your pantry"
        disabled={total === 0}
        onPress={() => { setCameraOn(false); onReview(); }}
      />
      <Button title={closeLabel} variant="secondary" onPress={onClose} testID="rapid-close" />
    </ScrollView>
  );
}
