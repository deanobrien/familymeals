import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, TextInput, Vibration, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { emptyRapid, normaliseRetailCode, sight, type RapidState } from '@fr/engine/pantry';
import { PhoneSender, formatCountdown, secondsLeft, type PhoneLink, type PhoneState, type PhoneTransport } from '@fr/engine/scanner';
import { RETAIL_BARCODE_TYPES } from '@/lib/barcode';
import { loadDevicePrefs } from '@/lib/devicePrefs';
import { playScanBeep } from '@/lib/scanSound';
import { createPhoneTransport, loadDeviceId, parseScannedLink, preparePhoto, type PreparedPhoto } from '@/lib/scannerApi';
import type { CapturedImage } from '@/lib/extraction';
import { Button, ErrorText, Muted, Text, useStyles, useTheme } from './ui';

export const SCAN_KEEP_AWAKE_TAG = 'fr-scan-for-computer';

export interface ScanForComputerDeps {
  /** The server this app talks to (EXPO_PUBLIC_API_BASE_URL); the QR code must point at it. */
  baseUrl?: string | undefined;
  transport?: PhoneTransport;
  deviceId?: () => Promise<string>;
  preparePhoto?: (img: CapturedImage) => Promise<PreparedPhoto>;
  now?: () => number;
}

function tick() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => Vibration.vibrate(40));
}

/**
 * "Scan for a computer" (P3-C, D448): the desktop shows a QR code; this screen reads it (or takes the address from the
 * app link / a pasted address), connects, then pushes barcodes and photos into that desktop session. The desktop review picks
 * them up live; nothing is written to the pantry from here. The phone does not need to be signed in: the QR code is the credential.
 */
export default function ScanForComputerScreen({ initialUrl, deps = {} }: { initialUrl?: string | null | undefined; deps?: ScanForComputerDeps }) {
  const styles = useStyles();
  const theme = useTheme();
  const baseUrl = 'baseUrl' in deps ? deps.baseUrl : process.env.EXPO_PUBLIC_API_BASE_URL;
  const now = deps.now ?? Date.now;
  const [permission, requestPermission] = useCameraPermissions();
  const [link, setLink] = useState<PhoneLink | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const [qrCamera, setQrCamera] = useState(false);
  const [view, setView] = useState<PhoneState | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [manual, setManual] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [tickNow, setTickNow] = useState(() => now());
  const sender = useRef<PhoneSender | null>(null);
  const tally = useRef<RapidState>(emptyRapid());
  const soundOn = useRef(true);
  const handled = useRef(false);

  useEffect(() => {
    void loadDevicePrefs().then((p) => { soundOn.current = p.scanSound; });
  }, []);

  const accept = useCallback((raw: string) => {
    const parsed = parseScannedLink(raw, baseUrl);
    if (!parsed) {
      setLinkError(baseUrl
        ? 'That is not a scanning code from your Family Recipes computer page. On the computer press "Use my phone" and scan the code it shows.'
        : 'This build of the app has no server address, so it cannot connect to a computer.');
      return false;
    }
    setLinkError(null);
    setQrCamera(false);
    setLink(parsed);
    return true;
  }, [baseUrl]);

  // The app link (https://.../scan/phone?s=...#t=...) opened this screen with the address.
  useEffect(() => {
    if (initialUrl && !handled.current) {
      handled.current = true;
      accept(initialUrl);
    }
  }, [initialUrl, accept]);

  // Connect, then keep retrying anything that could not be sent (a bad connection must not lose a scan).
  useEffect(() => {
    if (!link || !baseUrl) return undefined;
    let alive = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    let clock: ReturnType<typeof setInterval> | undefined;
    const transport = deps.transport ?? createPhoneTransport(baseUrl);
    void (async () => {
      const device = await (deps.deviceId ?? loadDeviceId)();
      if (!alive) return;
      const snd = new PhoneSender({ sessionId: link.sessionId, token: link.token, device }, transport, (s) => { if (alive) setView(s); });
      sender.current = snd;
      await snd.connect();
      if (!alive) return;
      timer = setInterval(() => { if (snd.state.queued > 0) void snd.flush(); }, 3000);
      clock = setInterval(() => setTickNow(now()), 1000);
    })();
    return () => {
      alive = false;
      if (timer) clearInterval(timer);
      if (clock) clearInterval(clock);
      sender.current = null;
    };
    // deps are test seams, fixed for the screen's life
  }, [link, baseUrl]);

  const live = cameraOn && !!permission?.granted && view?.status === 'ready';
  useEffect(() => {
    if (!live) return undefined;
    activateKeepAwakeAsync(SCAN_KEEP_AWAKE_TAG).catch(() => undefined);
    return () => { deactivateKeepAwake(SCAN_KEEP_AWAKE_TAG).catch(() => undefined); };
  }, [live]);
  useEffect(() => {
    if (view?.status === 'stopped') setCameraOn(false);
  }, [view?.status]);

  function onBarcode(event: { data: string; type?: string }) {
    const code = normaliseRetailCode(event.data, event.type);
    if (!code) return;
    // The same counting rule as everywhere else: a pack held in view counts once; moving away and back counts again.
    const r = sight(tally.current, code, now());
    tally.current = r.state;
    if (!r.counted) return;
    sender.current?.sendBarcode(code);
    tick();
    if (soundOn.current) playScanBeep();
  }

  function onQr(event: { data: string }) {
    if (handled.current && link) return;
    accept(event.data);
  }

  function addManual() {
    const code = normaliseRetailCode(manual);
    if (!code) { setError('Enter the 8, 12 or 13 digits printed under the barcode.'); return; }
    setError(null);
    sender.current?.sendBarcode(code);
    setManual('');
  }

  async function takePhoto() {
    setError(null);
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { setError('Camera permission denied. Allow it in Android settings to take photos.'); return; }
      const res = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.9 });
      if (res.canceled || !res.assets[0]) return;
      const a = res.assets[0];
      const prepared = await (deps.preparePhoto ?? preparePhoto)({ uri: a.uri, width: a.width, height: a.height });
      sender.current?.sendPhoto(prepared.base64, prepared.mime);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not take that photo.');
    }
  }

  // ---- no link yet: scan the QR code ----
  if (!link) {
    return (
      <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
        <Text style={styles.title} accessibilityRole="header">Scan for a computer</Text>
        <Muted>On the computer, open Pantry, Scan groceries (or Receipts) and press Use my phone. Then scan the code it shows.</Muted>
        {qrCamera && permission?.granted && (
          <View style={{ height: 300, marginVertical: 12 }}>
            <CameraView style={{ flex: 1 }} facing="back" accessibilityLabel="QR code camera preview" barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={onQr} />
          </View>
        )}
        {!qrCamera && (
          <Button
            title="Scan the QR code"
            testID="scan-computer-open-camera"
            onPress={async () => {
              if (!permission?.granted) {
                const p = await requestPermission();
                if (!p.granted) { setLinkError('Camera permission denied. You can paste the address instead.'); return; }
              }
              setLinkError(null);
              setQrCamera(true);
            }}
          />
        )}
        <Muted>No camera? On the computer choose "Cannot scan the code?", copy the address, and paste it here.</Muted>
        <TextInput
          style={styles.input}
          placeholder="Paste the address"
          placeholderTextColor={theme.muted}
          accessibilityLabel="Scanning address"
          autoCapitalize="none"
          autoCorrect={false}
          value={pasted}
          onChangeText={setPasted}
          testID="scan-computer-link"
        />
        <Button title="Connect" variant="secondary" testID="scan-computer-connect" disabled={pasted.trim() === ''} onPress={() => { accept(pasted); }} />
        <ErrorText message={linkError} />
      </ScrollView>
    );
  }

  // ---- linked ----
  if (!view || view.status === 'connecting') {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.title} accessibilityRole="header">Connecting...</Text>
        <Muted accessibilityLiveRegion="polite">Linking this phone to your computer.</Muted>
      </ScrollView>
    );
  }
  if (view.status === 'stopped' && !view.purpose) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.title} accessibilityRole="header">Cannot scan for the computer</Text>
        <ErrorText message={view.message} />
        <Button title="Try another code" variant="secondary" testID="scan-computer-retry" onPress={() => { handled.current = false; setLink(null); setView(null); }} />
      </ScrollView>
    );
  }

  const pantry = view.purpose === 'pantry';
  const left = view.expiresAt ? secondsLeft(view.expiresAt, tickNow) : 0;
  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">{pantry ? 'Scanning for your pantry' : 'Photographing a receipt'}</Text>
      <Muted>Connected to your computer. What you scan appears there for you to check; nothing is saved until you confirm on the computer.</Muted>
      <Text accessibilityLiveRegion="polite" testID="scan-computer-sent" style={styles.heading}>
        {view.sent} sent{view.queued > 0 ? `, ${view.queued} waiting for a connection` : ''}
      </Text>
      {view.status === 'ready' && <Muted testID="scan-computer-left">Time left {formatCountdown(left)}</Muted>}
      {view.message && <ErrorText message={view.message} />}

      {view.status === 'ready' && pantry && (
        <>
          {cameraOn && permission?.granted && (
            <View style={{ height: 260, marginVertical: 12 }}>
              <CameraView
                style={{ flex: 1 }}
                facing="back"
                accessibilityLabel="Barcode camera preview"
                barcodeScannerSettings={{ barcodeTypes: [...RETAIL_BARCODE_TYPES] }}
                onBarcodeScanned={onBarcode}
              />
            </View>
          )}
          {!cameraOn ? (
            <Button
              title="Scan barcodes"
              testID="scan-computer-start"
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
            <Button title="Stop the camera" variant="secondary" testID="scan-computer-stop-camera" onPress={() => setCameraOn(false)} />
          )}
          <TextInput
            style={styles.input}
            placeholder="Or type a barcode"
            placeholderTextColor={theme.muted}
            accessibilityLabel="Barcode digits"
            keyboardType="number-pad"
            value={manual}
            onChangeText={setManual}
            onSubmitEditing={addManual}
            testID="scan-computer-input"
          />
          <Button title="Send" variant="secondary" testID="scan-computer-add" onPress={addManual} disabled={manual.trim() === ''} />
        </>
      )}
      {view.status === 'ready' && (
        <Button
          title={pantry ? 'Take a photo of the shelf, fridge or a label' : 'Take a photo of the receipt'}
          variant={pantry ? 'secondary' : 'primary'}
          testID="scan-computer-photo"
          onPress={() => void takePhoto()}
        />
      )}
      <ErrorText message={error} />

      {view.recent.length > 0 && (
        <View accessibilityLabel="Sent" testID="scan-computer-recent" style={{ marginTop: 8 }}>
          {view.recent.map((r) => (
            <View key={r.id} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginVertical: 3 }}>
              <Text>{r.label}</Text>
              <Muted>{r.state === 'sent' ? 'sent' : r.state === 'waiting' ? 'waiting...' : r.note ?? 'not sent'}</Muted>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}
