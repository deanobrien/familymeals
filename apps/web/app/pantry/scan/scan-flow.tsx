'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@fr/ui';
import { fmtNum, rowFromDto, rowFromProduct, withCount, type ScanRow } from '../../../lib/pantry/scan-rows';
import type { ProductLookupDto } from '../../../lib/products/types';
import { postScan, type ScanApiFailure } from '../../../lib/pantry/scan-client';
import type { ScanProviderInfo } from '../../../lib/pantry/scan-types';
import { SETTINGS_ERROR_CODES } from '../../recipes/import/upload-step';
import { BarcodeStep } from './barcode-step';
import { CaptureStep, type ScanImage } from './capture-step';
import { ReviewStep } from './review-step';
import s from './scan.module.css';

type Stage = 'capture' | 'scanning' | 'review' | 'done';
type ApiError = ScanApiFailure;

export function ScanFlow({ provider }: { provider: ScanProviderInfo }) {
  const [stage, setStage] = useState<Stage>('capture');
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
    setRows((cur) => [...cur.filter((r) => r.barcode), ...out.data.rows.map(rowFromDto)]);
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

      {stage === 'capture' && (
        <>
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
          onBack={() => setStage('capture')}
          onAdded={(message) => { setAdded(message); setStage('done'); }}
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
