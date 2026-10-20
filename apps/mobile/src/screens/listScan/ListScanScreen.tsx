import React, { useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ServerScreen } from '@/data/ServerApiContext';
import { prepareForUpload, type CapturedImage, type Resizer, type Rotator } from '@/lib/extraction';
import { MAX_LIST_PHOTOS, newBatchId, scanList, type ConfirmOutcome, type ScanRow } from '@/lib/listScanApi';
import type { ServerApi } from '@/lib/serverApi';
import PhotoCapture from '../PhotoCapture';
import { Button, ErrorText, Muted, Text, useStyles } from '../ui';
import ReviewStep from './ReviewStep';

type Step = 'capture' | 'review' | 'done';

/** Handwritten shopping list: photos -> read (AI, on the server) -> review -> destination -> confirm (D260-D266, D346). */
export default function ListScanScreen({ resizer, rotator }: { resizer?: Resizer; rotator?: Rotator }) {
  return <ServerScreen>{(api, householdId) => <Flow api={api} householdId={householdId} resizer={resizer} rotator={rotator} />}</ServerScreen>;
}

function Flow({ api, householdId, resizer, rotator }: { api: ServerApi; householdId: string; resizer: Resizer | undefined; rotator: Rotator | undefined }) {
  const styles = useStyles();
  const router = useRouter();
  const [step, setStep] = useState<Step>('capture');
  const [images, setImages] = useState<CapturedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [title, setTitle] = useState<string | undefined>(undefined);
  // One id per review session: every preview / confirm retry of this scan reuses it (idempotent confirm, D266).
  const [batchId, setBatchId] = useState(newBatchId);
  const [result, setResult] = useState<ConfirmOutcome | null>(null);

  async function read() {
    if (busy || images.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const upload = await prepareForUpload(images, resizer, MAX_LIST_PHOTOS);
      const out = await scanList(api, householdId, upload);
      setRows(out.rows);
      setWarnings(out.warnings);
      setTitle(out.title);
      setBatchId(newBatchId());
      setStep('review');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The scan failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setImages([]);
    setRows([]);
    setResult(null);
    setError(null);
    setStep('capture');
  }

  if (step === 'review') {
    return (
      <ReviewStep
        api={api}
        householdId={householdId}
        rows={rows}
        setRows={setRows}
        warnings={warnings}
        title={title}
        batchId={batchId}
        onBack={() => setStep('capture')}
        onDone={(r) => {
          setResult(r);
          setStep('done');
        }}
      />
    );
  }

  if (step === 'done' && result) {
    return (
      <ScrollView contentContainerStyle={styles.screen} testID="list-done">
        <Text accessibilityRole="header" style={styles.title}>List added</Text>
        <Text testID="list-done-message">{result.message}</Text>
        <View style={{ gap: 8, marginTop: 16 }}>
          <Button title="Back to Shopping" testID="list-done-shopping" onPress={() => router.replace('/shopping' as never)} />
          <Button title="Scan another list" variant="secondary" testID="list-done-again" onPress={reset} />
        </View>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text accessibilityRole="header" style={styles.title}>Scan a handwritten list</Text>
      <Muted>Photograph your paper list (up to {MAX_LIST_PHOTOS} photos). You check what was read before anything is added.</Muted>
      <ErrorText message={error} />
      <PhotoCapture images={images} onChange={setImages} max={MAX_LIST_PHOTOS} noun="photo" testIdPrefix="list-photo" {...(rotator ? { rotator } : {})} />
      <Button title={busy ? 'Reading your list' : 'Read my list'} testID="list-scan-send" disabled={busy || images.length === 0} onPress={() => void read()} />
    </ScrollView>
  );
}
