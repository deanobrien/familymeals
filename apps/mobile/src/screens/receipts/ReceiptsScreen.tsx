import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { ServerScreen } from '@/data/ServerApiContext';
import { defaultRotator, prepareForUpload, type CapturedImage, type Resizer, type Rotator } from '@/lib/extraction';
import { formatPence, listReceipts, uploadReceipt, type ReceiptListEntry } from '@/lib/receiptsApi';
import type { ServerApi } from '@/lib/serverApi';
import PhotoCapture from '../PhotoCapture';
import { Button, EmptyState, ErrorText, Loading, Muted, MIN_TAP, Text, useStyles, useTheme } from '../ui';

function StatusBadge({ status }: { status: ReceiptListEntry['status'] }) {
  const t = useTheme();
  const done = status === 'reconciled';
  return (
    <Text style={{ color: done ? t.primary : t.warn, fontWeight: '700', fontSize: 13 }} testID="status-badge">
      {done ? 'Reconciled' : 'Needs review'}
    </Text>
  );
}

function ScanPanel({
  api,
  householdId,
  resizer,
  rotator,
  onClose,
  onUploaded,
}: {
  api: ServerApi;
  householdId: string;
  resizer?: Resizer;
  rotator: Rotator;
  onClose: () => void;
  onUploaded: (receiptId: string) => void;
}) {
  const styles = useStyles();
  const [images, setImages] = useState<CapturedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const [prepared] = await prepareForUpload(images, resizer, 1);
      onUploaded(await uploadReceipt(api, householdId, prepared!));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed. Please try again.');
      setBusy(false);
    }
  }

  if (busy) return <Loading label="Reading your receipt. This can take a moment" />;
  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">
        Scan a receipt
      </Text>
      <Muted>Lay the receipt flat in good light and photograph the whole thing. One photo.</Muted>
      <PhotoCapture images={images} onChange={setImages} max={1} noun="photo" rotator={rotator} testIdPrefix="receipt" />
      <ErrorText message={error} />
      <Button title="Read this receipt" onPress={() => void send()} disabled={images.length === 0} testID="send-receipt" />
      <Button title="Cancel" variant="secondary" onPress={onClose} testID="cancel-scan" />
    </ScrollView>
  );
}

function List({ api, householdId, resizer, rotator }: { api: ServerApi; householdId: string; resizer?: Resizer; rotator: Rotator }) {
  const styles = useStyles();
  const theme = useTheme();
  const router = useRouter();
  const [receipts, setReceipts] = useState<ReceiptListEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setReceipts(await listReceipts(api, householdId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load your receipts.');
    }
  }, [api, householdId]);
  useEffect(() => {
    void load();
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (scanning) {
    return (
      <ScanPanel
        api={api}
        householdId={householdId}
        {...(resizer ? { resizer } : {})}
        rotator={rotator}
        onClose={() => setScanning(false)}
        onUploaded={(id) => {
          setScanning(false);
          void load();
          router.push(`/receipts/${id}`);
        }}
      />
    );
  }
  if (!receipts && !error) return <Loading label="Loading receipts" />;

  return (
    <FlatList
      testID="receipts-list"
      style={{ backgroundColor: theme.bg }}
      contentContainerStyle={{ padding: 16 }}
      data={receipts ?? []}
      keyExtractor={(r) => r.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />}
      ListHeaderComponent={
        <View>
          <Text style={styles.title} accessibilityRole="header">
            Receipts
          </Text>
          <Muted>Scan a till receipt to record what you actually paid and tick off your shopping list.</Muted>
          <Button title="Scan a receipt" onPress={() => setScanning(true)} testID="scan-receipt" />
          <ErrorText message={error} />
          {error ? <Button title="Try again" variant="secondary" onPress={() => void load()} testID="retry" /> : null}
        </View>
      }
      ListEmptyComponent={error ? undefined : <EmptyState title="No receipts yet" hint="Scanned receipts are kept here for spending reports." />}
      renderItem={({ item }) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${item.retailer ?? 'Unknown retailer'}, ${item.date ?? 'no date'}, ${item.totalPence !== undefined ? formatPence(item.totalPence) : 'no total'}, ${item.status === 'reconciled' ? 'reconciled' : 'needs review'}`}
          onPress={() => router.push(`/receipts/${item.id}`)}
          testID={`receipt-${item.id}`}
          style={[styles.row, { minHeight: MIN_TAP + 16 }]}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700' }}>{item.retailer ?? 'Unknown retailer'}</Text>
            <Muted>
              {item.date ?? 'No date'} · {item.lineCount} {item.lineCount === 1 ? 'line' : 'lines'} · {item.totalPence !== undefined ? formatPence(item.totalPence) : 'No total'}
            </Muted>
          </View>
          <StatusBadge status={item.status} />
        </Pressable>
      )}
    />
  );
}

export default function ReceiptsScreen({ resizer, rotator = defaultRotator }: { resizer?: Resizer; rotator?: Rotator }) {
  return <ServerScreen>{(api, householdId) => <List api={api} householdId={householdId} {...(resizer ? { resizer } : {})} rotator={rotator} />}</ServerScreen>;
}
