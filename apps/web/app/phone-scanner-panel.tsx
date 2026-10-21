'use client';

import { useMemo, useState } from 'react';
import { formatCountdown, type ScannerPurpose } from '@fr/engine/scanner';
import { Button, Card, CardBody } from '@fr/ui';
import { qrMatrix, qrPath, qrViewBox } from '../lib/scanner/qr';
import { useScannerSession, type ScannerHandlers } from '../lib/scanner/use-scanner-session';
import s from './phone-scanner-panel.module.css';

/** The QR code as one SVG path (no HTML injection). `label` is its accessible name. */
export function QrCode({ value, label, size = 232 }: { value: string; label: string; size?: number }) {
  const m = useMemo(() => qrMatrix(value), [value]);
  const box = qrViewBox(m);
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${box} ${box}`} width={size} height={size} shapeRendering="crispEdges" data-testid="phone-qr" className={s.qr}>
      <rect width={box} height={box} fill="#ffffff" />
      <path d={qrPath(m)} fill="#000000" />
    </svg>
  );
}

interface Props extends ScannerHandlers {
  purpose: ScannerPurpose;
  /** Supabase Realtime is available (DATA_BACKEND=supabase): a hint that makes new scans appear at once. */
  realtime?: boolean;
  /** What the phone is for, in the panel's words ("scan barcodes", "photograph the receipt"). */
  what: string;
}

/**
 * "Use my phone" (P3-C, D447): shows a QR code for a short-lived session and feeds whatever the phone scans or photographs into the
 * page's existing review. The page decides what to do with each barcode / photo; nothing is written to the pantry or receipts here.
 */
export function PhoneScannerPanel({ purpose, realtime = false, what, onBarcode, onPhoto }: Props) {
  const { state, start, stop, releasePhone } = useScannerSession(purpose, { ...(onBarcode ? { onBarcode } : {}), ...(onPhoto ? { onPhoto } : {}) }, { realtime });
  const [copied, setCopied] = useState(false);
  const live = state.phase === 'live';
  const connected = state.session?.state === 'connected';

  async function copy() {
    if (!state.link) return;
    try {
      await navigator.clipboard.writeText(state.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* the address is also shown, selectable */ }
  }

  if (state.phase === 'idle' || state.phase === 'starting' || state.phase === 'error' || state.phase === 'ended') {
    return (
      <div className={s.wrap} data-testid="phone-scanner" data-phase={state.phase}>
        <div className={s.actions}>
          <Button variant="secondary" size="lg" onClick={() => void start()} loading={state.phase === 'starting'} data-testid="use-my-phone">
            {state.phase === 'ended' ? 'Use my phone again' : 'Use my phone'}
          </Button>
          <span className={s.muted}>Scan a QR code and your phone will {what} straight into this page.</span>
        </div>
        {state.error && <p role="alert" className={s.error} data-testid="phone-scanner-error">{state.error}</p>}
      </div>
    );
  }

  return (
    <Card>
      <CardBody>
        <div className={s.wrap} data-testid="phone-scanner" data-phase="live" data-state={state.session?.state ?? 'waiting'} data-link={state.link ?? ''}>
          <h2 className={s.title}>Use your phone to {what}</h2>
          <ol className={s.steps}>
            <li>Scan this code with your phone camera (or with the Family Recipes app: More, Scan for a computer).</li>
            <li>Allow the camera, then {what}. Each one appears here within a couple of seconds.</li>
            <li>Check everything on this page before anything is added: nothing is saved until you confirm.</li>
          </ol>
          <div className={s.qrRow}>
            {state.link && <QrCode value={state.link} label="QR code that connects your phone to this page" />}
            <div className={s.status} role="status" aria-live="polite" data-testid="phone-status">
              <strong>{connected ? 'Phone connected' : 'Waiting for your phone'}</strong>
              <span>{state.received} {state.received === 1 ? 'scan' : 'scans'} received</span>
              <span className={s.muted} data-testid="phone-countdown">Ends in {formatCountdown(state.secondsLeft)}</span>
              <span className={s.muted}>The code works for one phone and stops after 10 minutes or when you press Stop.</span>
            </div>
          </div>
          <details>
            <summary className={s.summary}>Cannot scan the code?</summary>
            <p className={s.muted}>Open this address on your phone (it is private to this session; do not share it):</p>
            <p className={s.link} data-testid="phone-link" tabIndex={0}>{state.link}</p>
            <Button variant="secondary" size="sm" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy address'}</Button>
          </details>
          <div className={s.actions}>
            {connected && <Button variant="secondary" onClick={() => void releasePhone()} data-testid="phone-release">Use a different phone</Button>}
            <Button variant="ghost" onClick={() => void stop()} data-testid="phone-stop">{live ? 'Stop' : 'Close'}</Button>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
