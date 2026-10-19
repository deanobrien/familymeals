'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, Card, CardBody, Input } from '@fr/ui';
import { BARCODE_FORMATS, platformDetector, startScanLoop } from '../../../lib/products/barcode-detect';
import { fetchProduct } from '../../../lib/products/client';
import type { ProductLookupDto } from '../../../lib/products/types';
import s from './scan.module.css';

interface Props {
  onProduct: (lookup: ProductLookupDto) => void;
  disabled?: boolean;
}

/**
 * Barcode capture (X2). Camera scanning uses the browser's BarcodeDetector where it exists (Chrome / Android); everywhere
 * else, and always as an alternative, the owner can type the digits under the barcode. Either way the code goes to
 * /api/products/<barcode>; nothing is added to the pantry until the review is confirmed.
 */
export function BarcodeStep({ onProduct, disabled }: Props) {
  const [ean, setEan] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const supported = useRef<boolean | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // Set after mount so server and first client render agree.
  const [canCamera, setCanCamera] = useState(false);
  useEffect(() => {
    supported.current = platformDetector() !== null && !!navigator.mediaDevices?.getUserMedia;
    setCanCamera(supported.current);
    return () => stopCamera();
  }, []);

  function stopCamera() {
    stopRef.current?.();
    stopRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraOn(false);
  }

  async function lookup(code: string) {
    setBusy(true);
    setError(null);
    setStatus(null);
    const out = await fetchProduct(code);
    setBusy(false);
    if (!out.ok) { setError(out.error.message); return; }
    setStatus(`Found: ${out.data.product.name}`);
    setEan('');
    onProduct(out.data);
  }

  async function startCamera() {
    setError(null);
    const factory = platformDetector();
    if (!factory) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      streamRef.current = stream;
      setCameraOn(true);
      // The <video> mounts on the next render.
      await new Promise((r) => setTimeout(r, 0));
      const video = videoRef.current;
      if (!video) { stopCamera(); return; }
      video.srcObject = stream;
      await video.play().catch(() => undefined);
      stopRef.current = startScanLoop({
        detector: factory(BARCODE_FORMATS),
        source: video,
        onCode: (code) => { stopCamera(); setEan(code); void lookup(code); },
      });
    } catch {
      stopCamera();
      setError('The camera could not be opened. Allow camera access, or type the barcode digits instead.');
    }
  }

  return (
    <Card>
      <CardBody>
        <div className={s.stack}>
          <h2 style={{ margin: 0, fontSize: 'var(--fr-text-lg)' }}>Scan a barcode</h2>
          <p className={s.muted}>
            Packaged food: scan or type the barcode to fill in the name, pack size, allergens and nutrition from Open Food Facts.
            Dates are not on the barcode: add them from a close-up photo or type them in the review.
          </p>
          {canCamera && (
            <div className={s.actions}>
              {!cameraOn
                ? <Button variant="secondary" disabled={disabled || busy} onClick={() => void startCamera()} data-testid="barcode-camera">Scan barcode with camera</Button>
                : <Button variant="secondary" onClick={stopCamera}>Stop camera</Button>}
            </div>
          )}
          {cameraOn && <video ref={videoRef} className={s.video} playsInline muted aria-label="Camera view for barcode scanning" data-testid="barcode-video" />}
          {!canCamera && (
            <p className={s.muted} data-testid="barcode-manual-note">
              Camera barcode scanning is not available in this browser, so type the digits under the barcode.
            </p>
          )}
          <form
            className={s.actions}
            onSubmit={(e) => { e.preventDefault(); if (ean.trim()) void lookup(ean); }}
          >
            <Input
              label="Barcode digits" inputMode="numeric" autoComplete="off" value={ean} placeholder="e.g. 5000157024671"
              onChange={(e) => setEan(e.target.value)} data-testid="ean-input" disabled={disabled}
            />
            <Button type="submit" variant="secondary" loading={busy} disabled={disabled || busy || ean.trim() === ''} data-testid="ean-lookup">Look up</Button>
          </form>
          {error && <p role="alert" className={s.fieldError} data-testid="barcode-error">{error}</p>}
          {status && <p role="status" className={s.muted} data-testid="barcode-status">{status}</p>}
        </div>
      </CardBody>
    </Card>
  );
}
