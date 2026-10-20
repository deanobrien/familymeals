import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { fmtNum, mergeLookup, rapidKey, rowFromDto, rowFromRapid, withCount, type LookupState, type ScanLookupLike } from '@fr/engine/pantry';
import { useApp } from '@/data/AppContext';
import { ServerScreen } from '@/data/ServerApiContext';
import { prepareForUpload, type CapturedImage, type Resizer } from '@/lib/extraction';
import { createPantryScanClient, MAX_SCAN_PHOTOS, type PantryScanClient, type PhoneScanRow, type ReviewProduct, type ScanProvider } from '@/lib/pantryScanApi';
import { createProductClient, type ProductClient, type ProductSummary } from '@/lib/productApi';
import type { ServerApi } from '@/lib/serverApi';
import PhotoCapture from '../PhotoCapture';
import RapidBarcodeScan from '../RapidBarcodeScan';
import { Chip, ChipRow } from '../pantry/shared';
import { Button, ErrorText, Loading, Muted, Text, useStyles } from '../ui';
import ScanReview from './ScanReview';
import { useRapidSession } from './useRapidSession';

export type ScanMode = 'photos' | 'barcodes';
type Stage = 'capture' | 'scanning' | 'review' | 'done';

/** A batch lookup answer as review input. A summary without the full record still names the row (unmatched). */
export function toReviewLookup(st: LookupState<ProductSummary> | undefined): LookupState<ScanLookupLike<ReviewProduct>> | undefined {
  if (!st || st.state !== 'done') return st;
  const s = st.value;
  if (s.review) return { state: 'done', value: s.review };
  return {
    state: 'done',
    value: {
      product: {
        barcode: s.barcode, name: s.name, ...(s.brand ? { brand: s.brand } : {}), ...(s.packSizeText ? { packSizeText: s.packSizeText } : {}),
        categories: [], nutrition: { per: 'g' }, allergenText: 'Allergens not listed', sourceUrl: s.sourceUrl,
      },
      match: { status: 'unmatched', suggestions: [] },
    },
  };
}

export interface PantryScanProps {
  initialMode?: ScanMode;
  resizer?: Resizer;
  productClient?: ProductClient;
  scanClient?: PantryScanClient;
  now?: () => number;
  today?: () => string;
  previewDebounceMs?: number;
}

/**
 * Scan groceries into the pantry on the phone (D343 photos, D344 continuous barcodes), the web /pantry/scan's twin.
 * Photos: up to 10, read by the server's AI scan (video frames are web-only: phone video needs a native frame-extraction
 * module, so photos cover it). Barcodes: the continuous scanner's tally. Both end in the same review -> merge preview ->
 * confirm, all on the phone. Nothing is written before "Add to pantry".
 */
export default function PantryScanScreen(props: PantryScanProps) {
  return <ServerScreen>{(api, householdId) => <PantryScan api={api} householdId={householdId} {...props} />}</ServerScreen>;
}

function PantryScan({
  api, householdId, initialMode = 'photos', resizer, productClient, scanClient, now, today, previewDebounceMs,
}: PantryScanProps & { api: ServerApi; householdId: string }) {
  const styles = useStyles();
  const router = useRouter();
  const { ds } = useApp();
  const client = useMemo(() => scanClient ?? createPantryScanClient(api), [scanClient, api]);
  const products = useMemo(
    () => productClient ?? createProductClient({ baseUrl: process.env.EXPO_PUBLIC_API_BASE_URL, getToken: () => ds.getAccessToken() }),
    [productClient, ds],
  );
  const rapid = useRapidSession(products, householdId);
  const [mode, setMode] = useState<ScanMode>(initialMode);
  const [stage, setStage] = useState<Stage>('capture');
  const [images, setImages] = useState<CapturedImage[]>([]);
  const [rows, setRows] = useState<PhoneScanRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [provider, setProvider] = useState<ScanProvider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [reviewId, setReviewId] = useState(1);
  const synced = useRef<Map<string, number>>(new Map());

  // A lookup finished: fill in the rows waiting on it (counts, dates and names the owner set are kept).
  useEffect(() => {
    setRows((cur) => {
      let changed = false;
      const next = cur.map((r) => {
        if (!r.rapid || !r.scanBarcode) return r;
        const m = mergeLookup(r, toReviewLookup(rapid.lookups.get(r.scanBarcode)));
        if (m !== r) changed = true;
        return m;
      });
      return changed ? next : cur;
    });
  }, [rapid.lookups]);

  /** The tally -> review rows. Rows already in the review keep what the owner did; a tally change since the last sync wins for the count. */
  function syncRapidRows() {
    const items = rapid.ref.current.items;
    setRows((cur) => {
      const mine = new Map(cur.filter((r) => r.rapid).map((r) => [r.key, r]));
      const rapidRows = items.map((i) => {
        const existing = mine.get(rapidKey(i.barcode));
        if (!existing) return rowFromRapid(i.barcode, i.count, toReviewLookup(rapid.lookups.get(i.barcode)));
        return synced.current.get(i.barcode) === i.count ? existing : withCount(existing, fmtNum(i.count));
      });
      return [...cur.filter((r) => !r.rapid), ...rapidRows];
    });
    synced.current = new Map(items.map((i) => [i.barcode, i.count]));
  }

  async function scanPhotos() {
    setStage('scanning');
    setError(null);
    try {
      const prepared = await prepareForUpload(images, resizer, MAX_SCAN_PHOTOS);
      const out = await client.scan(householdId, prepared);
      if (out.provider) setProvider(out.provider);
      // Barcode rows already in the review stay (first); the photo scan adds its own.
      setRows((cur) => [...cur.filter((r) => r.rapid), ...out.rows.map((d) => rowFromDto<ReviewProduct>(d))]);
      setWarnings(out.warnings);
      setStage('review');
    } catch (e) {
      setError(e instanceof Error ? `${e.message} Your photos are still here: press Scan to try again.` : 'The scan failed. Please try again.');
      setStage('capture');
    }
  }

  function startOver() {
    rapid.clear();
    synced.current = new Map();
    setImages([]);
    setRows([]);
    setWarnings([]);
    setAdded(null);
    setError(null);
    setReviewId((n) => n + 1);
    setStage('capture');
  }

  if (stage === 'scanning') return <Loading label={`Reading ${images.length} ${images.length === 1 ? 'photo' : 'photos'}. This can take up to a minute`} />;

  if (stage === 'review') {
    return (
      <ScanReview
        key={reviewId}
        api={api}
        client={client}
        householdId={householdId}
        rows={rows}
        setRows={setRows}
        warnings={warnings}
        backLabel={rows.some((r) => r.rapid) ? 'Back to scanning' : 'Back to photos'}
        onBack={() => { if (rows.some((r) => r.rapid)) setMode('barcodes'); setStage('capture'); }}
        onRetry={(code) => rapid.retry(code)}
        onAdded={(message) => { rapid.clear(); synced.current = new Map(); setAdded(message); setStage('done'); }}
        {...(resizer ? { resizer } : {})}
        {...(today ? { today } : {})}
        {...(previewDebounceMs !== undefined ? { previewDebounceMs } : {})}
      />
    );
  }

  if (stage === 'done') {
    return (
      <View style={styles.screen} testID="scan-done">
        <Text style={styles.title} accessibilityRole="header" accessibilityLiveRegion="polite">{added}</Text>
        <Button title="Back to pantry" testID="done-pantry" onPress={() => router.push('/pantry')} />
        <Button title="Scan more" variant="secondary" testID="done-more" onPress={startOver} />
      </View>
    );
  }

  const modeChips = (
    <ChipRow>
      <Chip label="Photos" selected={mode === 'photos'} testID="mode-photos" accessibilityLabel="Scan with photos" onPress={() => setMode('photos')} />
      <Chip label="Barcodes" selected={mode === 'barcodes'} testID="mode-barcodes" accessibilityLabel="Scan barcodes continuously" onPress={() => setMode('barcodes')} />
    </ChipRow>
  );

  if (mode === 'barcodes') {
    return (
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>{modeChips}</View>
        <RapidBarcodeScan
          session={rapid}
          onReview={() => { syncRapidRows(); setWarnings([]); setStage('review'); }}
          onClose={() => setMode('photos')}
          closeLabel="Scan photos instead"
          {...(now ? { now } : {})}
        />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen} keyboardShouldPersistTaps="handled">
      <Text style={styles.title} accessibilityRole="header">Scan groceries</Text>
      {modeChips}
      <Muted>
        Photograph your shopping (up to {MAX_SCAN_PHOTOS} photos). Each item is read and matched, and you check everything before
        it goes into your pantry. Lots of packets? Use Barcodes instead.
      </Muted>
      {provider?.isMock && (
        <View style={styles.banner} testID="mock-banner">
          <Muted>No AI provider is set up, so a scan returns a fixed sample list, not what is in your photos.</Muted>
        </View>
      )}
      <PhotoCapture images={images} onChange={setImages} max={MAX_SCAN_PHOTOS} testIdPrefix="scan-photo" />
      <ErrorText message={error} />
      {rapid.state.items.length > 0 && (
        <Muted testID="barcodes-pending">{rapid.state.items.length} scanned barcode{rapid.state.items.length === 1 ? '' : 's'} will be reviewed with these photos.</Muted>
      )}
      <Button
        title={images.length === 0 ? 'Scan' : `Scan ${images.length} ${images.length === 1 ? 'photo' : 'photos'}`}
        testID="scan-send"
        disabled={images.length === 0}
        onPress={() => { syncRapidRows(); void scanPhotos(); }}
      />
      <Muted>Video is not supported on the phone yet: take a few photos instead.</Muted>
    </ScrollView>
  );
}
