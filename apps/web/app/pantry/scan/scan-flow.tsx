'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { RapidItem } from '@fr/engine/pantry';
import { Button, Card, CardBody } from '@fr/ui';
import { fmtNum, mergeLookup, rapidKey, rowFromDto, rowFromProduct, rowFromRapid, withCount, type ScanRow } from '../../../lib/pantry/scan-rows';
import type { ProductLookupDto } from '../../../lib/products/types';
import { postScan, type ScanApiFailure } from '../../../lib/pantry/scan-client';
import type { ScanProviderInfo } from '../../../lib/pantry/scan-types';
import { SETTINGS_ERROR_CODES } from '../../recipes/import/upload-step';
import { BarcodeStep } from './barcode-step';
import { CaptureStep, MAX_SCAN_IMAGES, type ScanImage } from './capture-step';
import { PhoneScannerPanel } from '../../phone-scanner-panel';
import { RapidStep } from './rapid-step';
import { ReviewStep } from './review-step';
import { useRapidSession } from './use-rapid-session';
import s from './scan.module.css';

type Stage = 'capture' | 'rapid' | 'scanning' | 'review' | 'done';
type ApiError = ScanApiFailure;

export function ScanFlow({ provider, startRapid = false, seed = [], phoneRealtime = false }: { provider: ScanProviderInfo; startRapid?: boolean; seed?: RapidItem[]; phoneRealtime?: boolean }) {
  const [stage, setStage] = useState<Stage>(startRapid || seed.length > 0 ? 'rapid' : 'capture');
  const [images, setImages] = useState<ScanImage[]>([]);
  const [rows, setRows] = useState<ScanRow[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [added, setAdded] = useState<string | null>(null);
  const [active, setActive] = useState<ScanProviderInfo>(provider);
  const counter = useRef(1);
  const imagesRef = useRef<ScanImage[]>([]);
  imagesRef.current = images;
  useEffect(() => () => imagesRef.current.forEach((i) => URL.revokeObjectURL(i.url)), []);

  // Continuous barcode scanning (BS1): the session (tally + background lookups) lives here so lookups keep resolving
  // while the owner reviews, and so a refresh restores the tally.
  const rapid = useRapidSession(seed);
  const synced = useRef<Map<string, number>>(new Map());
  useEffect(() => {
    // After a page reload with a saved tally, go straight back to the scanner rather than an empty start page.
    if (rapid.restored) setStage((s) => (s === 'capture' ? 'rapid' : s));
  }, [rapid.restored]);
  useEffect(() => {
    // A lookup finished: fill in the rows that were waiting on it (counts, dates and names the owner set are kept).
    setRows((cur) => {
      let changed = false;
      const next = cur.map((r) => {
        if (!r.rapid || !r.scanBarcode) return r;
        const m = mergeLookup(r, rapid.lookups.get(r.scanBarcode));
        if (m !== r) changed = true;
        return m;
      });
      return changed ? next : cur;
    });
  }, [rapid.lookups]);

  /**
   * "Use my phone" (P3-C, D447): a barcode the phone scanned joins the same tally as the camera on this page (a new code through the
   * same counting rule, extra units as +1 each), and a photo joins the photos to scan. Nothing is added to the pantry here.
   */
  function fromPhoneBarcode(code: string, count: number) {
    if (rapid.has(code)) for (let i = 0; i < count; i++) rapid.plus(code);
    else {
      rapid.sight(code, Date.now());
      for (let i = 1; i < count; i++) rapid.plus(code);
    }
    setStage((cur) => (cur === 'capture' && imagesRef.current.length === 0 ? 'rapid' : cur));
  }
  function fromPhonePhoto(file: File) {
    setImages((cur) => (cur.length >= MAX_SCAN_IMAGES ? cur : [...cur, { id: counter.current++, file, url: URL.createObjectURL(file), source: 'photo' }]));
  }

  /** Scanned codes -> review rows. Rows already in the review keep what the owner did to them; tally changes since the last sync win for the count. */
  function syncRapidRows() {
    const items = rapid.state.items;
    setRows((cur) => {
      const mine = new Map(cur.filter((r) => r.rapid).map((r) => [r.key, r]));
      const rapidRows = items.map((i) => {
        const existing = mine.get(rapidKey(i.barcode));
        if (!existing) return rowFromRapid(i.barcode, i.count, rapid.lookups.get(i.barcode));
        return synced.current.get(i.barcode) === i.count ? existing : withCount(existing, fmtNum(i.count));
      });
      return [...cur.filter((r) => !r.rapid), ...rapidRows];
    });
    synced.current = new Map(items.map((i) => [i.barcode, i.count]));
  }

  async function scan() {
    setStage('scanning');
    setError(null);
    const out = await postScan(images.map((i) => i.file));
    if (!out.ok) {
      setError(out.error);
      setStage('capture');
      return;
    }
    if (out.data.provider) setActive(out.data.provider);
    // Barcode rows already chosen stay (first); the photo scan adds its own.
    setRows((cur) => [...cur.filter((r) => r.barcode || r.rapid), ...out.data.rows.map(rowFromDto)]);
    setWarnings(out.data.warnings);
    setStage('review');
  }

  /** A barcode lookup became a review row; the same product scanned again adds one to the count. */
  function addProduct(lookup: ProductLookupDto) {
    setRows((cur) => {
      const same = cur.find((r) => r.barcode === lookup.product.barcode);
      if (same) return cur.map((r) => (r === same ? withCount(r, fmtNum((Number(r.count) || 1) + 1)) : r));
      return [...cur, rowFromProduct(lookup, `bc-${lookup.product.barcode}-${counter.current++}`)];
    });
  }

  function startOver() {
    rapid.clear();
    synced.current = new Map();
    images.forEach((i) => URL.revokeObjectURL(i.url));
    setImages([]);
    setRows([]);
    setWarnings([]);
    setAdded(null);
    setError(null);
    setStage('capture');
  }

  const settingsError = error ? SETTINGS_ERROR_CODES.has(error.code) : false;

  return (
    <div className={s.stack}>
      <p data-testid="scan-provider" className={s.muted}>
        Reading with: <strong>{active.label}</strong> <Link href="/settings">Change in Settings</Link>
      </p>
      {active.configured === false && (
        <div role="note" data-testid="unconfigured-banner" className={s.note}>
          No AI provider is set up yet, so photos cannot be read.{' '}
          <Link href="/settings">Open Settings &gt; AI provider</Link>
        </div>
      )}
      {active.isMock && (
        <div role="note" data-testid="mock-banner" className={s.note}>
          No AI provider is set up, so a scan returns a fixed sample list, not what is in your photos.{' '}
          <Link href="/settings">Add an OpenAI key in Settings</Link> to read real photos.
        </div>
      )}

      {error && (
        <div role="alert" data-testid="scan-error" className={s.error}>
          {error.message}{' '}
          {settingsError && <Link href="/settings">Open Settings &gt; AI provider</Link>}
          {error.retryable && !settingsError && <span> Your photos are still here: press Scan to try again.</span>}
        </div>
      )}

      {(stage === 'capture' || stage === 'rapid') && (
        <PhoneScannerPanel purpose="pantry" realtime={phoneRealtime} what="scan barcodes and photograph what you have bought" onBarcode={fromPhoneBarcode} onPhoto={fromPhonePhoto} />
      )}

      {stage === 'rapid' && (
        <RapidStep
          session={rapid}
          onDone={() => { syncRapidRows(); setWarnings([]); setStage('review'); }}
          onCancel={() => { syncRapidRows(); setStage('capture'); }}
        />
      )}

      {stage === 'capture' && (
        <>
          <Card>
            <CardBody>
              <div className={s.stack}>
                <h2 style={{ margin: 0, fontSize: 'var(--fr-text-lg)' }}>Lots to scan?</h2>
                <p className={s.muted}>
                  Scan barcodes one after another with the camera, no photos: it beeps for each one and keeps a running count.
                  Works on iPhone and Android.
                </p>
                <div className={s.actions}>
                  <Button size="lg" onClick={() => setStage('rapid')} data-testid="rapid-open">
                    {rapid.state.items.length > 0 ? `Continue scanning barcodes (${rapid.state.items.length})` : 'Scan barcodes continuously'}
                  </Button>
                </div>
              </div>
            </CardBody>
          </Card>
          <BarcodeStep onProduct={addProduct} />
          {rows.some((r) => r.barcode) && (
            <div className={s.actions} data-testid="barcode-ready">
              <Button onClick={() => { setWarnings([]); setStage('review'); }} data-testid="review-barcodes">
                Review {rows.filter((r) => r.barcode).length} scanned {rows.filter((r) => r.barcode).length === 1 ? 'product' : 'products'}
              </Button>
              <span className={s.muted}>Or add photos below to scan those too.</span>
            </div>
          )}
          <CaptureStep images={images} onChange={setImages} nextId={() => counter.current++} onScan={() => void scan()} />
        </>
      )}

      {stage === 'scanning' && (
        <div role="status" aria-busy="true" data-testid="scanning" className={s.info}>
          <strong>Scanning...</strong> Reading {images.length} {images.length === 1 ? 'image' : 'images'} with {active.label}. This can take
          up to a minute.
        </div>
      )}

      {stage === 'review' && (
        <ReviewStep
          rows={rows}
          setRows={setRows}
          warnings={warnings}
          imageCount={images.length}
          onBack={() => setStage(rows.some((r) => r.rapid) ? 'rapid' : 'capture')}
          backLabel={rows.some((r) => r.rapid) ? 'Back to scanning' : 'Back to photos'}
          onRetry={(code) => rapid.retry(code)}
          onAdded={(message) => { rapid.clear(); synced.current = new Map(); setAdded(message); setStage('done'); }}
        />
      )}

      {stage === 'done' && (
        <div className={s.stack} data-testid="scan-done">
          <p role="status" className={s.info}>{added}</p>
          <div className={s.actions}>
            <Link className="fr-btn fr-btn--primary fr-btn--md" href="/pantry">Back to pantry</Link>
            <Button variant="secondary" onClick={startOver}>Scan more</Button>
          </div>
        </div>
      )}
    </div>
  );
}
