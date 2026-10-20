import React, { useCallback, useEffect, useState } from 'react';
import { Image, ScrollView, View } from 'react-native';
import { ServerScreen } from '@/data/ServerApiContext';
import {
  confirmReceipt,
  formatPence,
  getReceipt,
  photoSource,
  type ConfirmSummary,
  type LineDecision,
  type ReceiptDetail,
} from '@/lib/receiptsApi';
import type { ServerApi } from '@/lib/serverApi';
import { Button, ErrorState, Loading, Muted, Text, useStyles } from '../ui';
import ReceiptReview from './ReceiptReview';

function Photo({ api, householdId, photoPath }: { api: ServerApi; householdId: string; photoPath: string }) {
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void photoSource(api, householdId, photoPath).then((s) => live && setSource(s));
    return () => {
      live = false;
    };
  }, [open, api, householdId, photoPath]);
  return (
    <View style={{ marginVertical: 8 }}>
      <Button title={open ? 'Hide receipt photo' : 'View receipt photo'} variant="secondary" onPress={() => setOpen((v) => !v)} testID="photo-toggle" />
      <Muted>Kept privately; deleted 90 days after you confirm the receipt.</Muted>
      {open && source ? (
        <Image
          source={source}
          resizeMode="contain"
          style={{ width: '100%', aspectRatio: 0.7, marginTop: 8 }}
          accessibilityLabel="Receipt photo"
          testID="receipt-photo"
        />
      ) : null}
    </View>
  );
}

function History({ detail }: { detail: ReceiptDetail }) {
  return (
    <View testID="history">
      <Text style={{ fontWeight: '700', marginTop: 8 }}>Reconciled</Text>
      <Text accessibilityRole="summary">
        {detail.purchaseCount} purchase(s) recorded. Items you did not confirm stay on your shopping list. This receipt is kept as history.
      </Text>
      {detail.review.lines.map((l) => {
        const d = detail.decisions.find((x) => x.lineId === l.lineId);
        const outcome =
          d?.outcome === 'purchase' ? `bought: ${d.itemName ?? 'list item'}` : d?.outcome === 'extra' ? `extra${d.addToPantry ? ' (added to pantry)' : ''}` : 'not matched';
        return (
          <Text key={l.lineId} testID={`history-${l.lineId}`} style={{ marginVertical: 4 }}>
            {l.raw}
            {l.netPence !== undefined ? ` (${formatPence(l.netPence)})` : ''} → {outcome}
          </Text>
        );
      })}
    </View>
  );
}

function Summary({ s, onDone }: { s: ConfirmSummary; onDone: () => void }) {
  return (
    <View testID="summary" accessibilityRole="summary">
      <Text style={{ fontWeight: '700', fontSize: 18 }}>Receipt saved</Text>
      <Text testID="summary-purchases">{s.purchases} purchase(s) recorded</Text>
      <Text testID="summary-extras">{s.extras} extra(s) not on your list</Text>
      <Text testID="summary-pantry">{s.pantryAdds} added to your pantry</Text>
      <Text testID="summary-left">{s.leftOutstanding} item(s) left on your shopping list</Text>
      <Button title="See the receipt" onPress={onDone} testID="summary-done" />
    </View>
  );
}

function Detail({ api, householdId, id }: { api: ServerApi; householdId: string; id: string }) {
  const styles = useStyles();
  const [detail, setDetail] = useState<ReceiptDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<ConfirmSummary | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setDetail(await getReceipt(api, householdId, id));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load this receipt.');
    }
  }, [api, householdId, id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (error) return <ErrorState message={error} onRetry={() => void load()} />;
  if (!detail) return <Loading label="Loading receipt" />;
  const { review } = detail;

  const confirm = async (decisions: LineDecision[]) => {
    const s = await confirmReceipt(api, householdId, id, decisions); // errors (incl. the read-only 403 message) surface in the form
    setSummary(s);
    return s;
  };

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">
        {review.retailer ?? 'Unknown retailer'}
      </Text>
      <Text testID="receipt-header">
        {review.date ?? 'No date'} · {review.totalPence !== undefined ? `Total ${formatPence(review.totalPence)}` : 'No total read'} ·{' '}
        {review.status === 'reconciled' ? 'Reconciled' : 'Needs review'}
      </Text>
      {detail.hasPhoto && detail.photoPath ? <Photo api={api} householdId={householdId} photoPath={detail.photoPath} /> : null}
      {summary ? (
        <Summary
          s={summary}
          onDone={() => {
            setSummary(null);
            setDetail(null);
            void load();
          }}
        />
      ) : review.status === 'reconciled' ? (
        <History detail={detail} />
      ) : (
        <ReceiptReview model={review} onConfirm={confirm} />
      )}
    </ScrollView>
  );
}

export default function ReceiptDetailScreen({ id }: { id: string }) {
  return <ServerScreen>{(api, householdId) => <Detail api={api} householdId={householdId} id={id} />}</ServerScreen>;
}
