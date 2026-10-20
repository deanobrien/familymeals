import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, ScrollView, TextInput, Vibration, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import {
  createLookupTracker, decrement, emptyRapid, increment, normaliseRetailCode, sight, toSeedParam, totalCount, undo,
  type LookupState, type LookupTracker, type RapidState,
} from '@fr/engine/pantry';
import { RETAIL_BARCODE_TYPES } from '@/lib/barcode';
import { PRODUCT_ATTRIBUTION, type ProductClient, type ProductSummary } from '@/lib/productApi';
import { Button, ErrorText, Muted, Text, useStyles, useTheme } from './ui';

/**
 * Continuous barcode scanning (BS1): expo-camera keeps firing `onBarcodeScanned`; each event goes through the same
 * debounce / tally as the web (`@fr/engine/pantry`): the same pack in view counts once, moving away and back counts again.
 * Lookups run in the background through POST /api/products (never blocking the camera). The app writes nothing: "Review on
 * the web" opens /pantry/scan with this tally handed over in the link, and the web review (matching, pack sizes, allergens,
 * dates, merge preview, confirm) takes over. Not done on Android (needs a native module): beep and keep-awake.
 */
export default function RapidBarcodeScan({
  client,
  householdId,
  onClose,
  now = Date.now,
}: {
  client: ProductClient;
  householdId: string;
  onClose: () => void;
  now?: () => number;
}) {
  const styles = useStyles();
  const theme = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [cameraOn, setCameraOn] = useState(false);
  const [paused, setPaused] = useState(false);
  const [state, setState] = useState<RapidState>(emptyRapid);
  const [lookups, setLookups] = useState<ReadonlyMap<string, LookupState<ProductSummary>>>(new Map());
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<RapidState>(state);
  const tracker = useRef<LookupTracker<ProductSummary> | null>(null);
  const pausedRef = useRef(false);
  pausedRef.current = paused;

  const getTracker = useCallback(() => {
    tracker.current ??= createLookupTracker<ProductSummary>({
      post: (req) => client.lookupBatch(householdId, req),
      onChange: setLookups,
    });
    return tracker.current;
  }, [client, householdId]);

  useEffect(() => () => { tracker.current?.stop(); tracker.current = null; }, []);

  const commit = useCallback((next: RapidState) => {
    ref.current = next;
    setState(next);
    for (const i of next.items) getTracker().request(i.barcode);
  }, [getTracker]);

  function onScanned(event: { data: string; type?: string }) {
    if (pausedRef.current) return;
    const code = normaliseRetailCode(event.data, event.type);
    if (!code) return;
    const r = sight(ref.current, code, now());
    if (r.counted) {
      Vibration.vibrate(40);
      commit(r.state);
    } else {
      ref.current = r.state; // `seen` bookkeeping only
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
  const reviewUrl = client.webUrl(`/pantry/scan?mode=rapid&codes=${encodeURIComponent(toSeedParam(state.items))}`);
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
      <Muted>Point at each barcode in turn. Scan the same product again to add another. Nothing is added to your pantry here: finish on the web.</Muted>

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

      {reviewUrl && (
        <Button title="Review on the web" testID="rapid-review" disabled={total === 0} onPress={() => void Linking.openURL(reviewUrl)} />
      )}
      <Button title="Back to recipe capture" variant="secondary" onPress={onClose} testID="rapid-close" />
    </ScrollView>
  );
}
