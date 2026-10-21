'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { emptyRapid, normaliseRetailCode, sight, type RapidState } from '@fr/engine/pantry';
import { MAX_PHOTO_BYTES, formatCountdown, isSessionId, isToken, secondsLeft } from '@fr/engine/scanner';
import { Button, Input } from '@fr/ui';
import { downscaleImage } from '../../../lib/images/downscale';
import { CAMERA_MESSAGES, classifyCameraError, openRearCamera, type CameraSession } from '../../../lib/products/camera';
import { createDecoder, type FrameDecoder } from '../../../lib/products/decoder';
import { createScanFeedback, createScreenWake, type ScanFeedback, type ScreenWake } from '../../../lib/products/scan-feedback';
import { ROI_HEIGHT, ROI_WIDTH, startFrameLoop, type DrawCanvas } from '../../../lib/products/scan-loop';
import { phoneConnect, phonePush, type PhoneCred } from '../../../lib/scanner/client';
import { PhoneSender, type PhoneState } from '../../../lib/scanner/phone-sender';
import s from '../../pantry/scan/scan.module.css';
import p from './phone-scanner.module.css';

const DEVICE_KEY = 'fr.scanner.device';
const credKey = (id: string) => `fr.scanner.cred.${id}`;

function randomId(bytes = 24): string {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** This phone's id for scanning sessions (kept so a reload is the same phone, not "another phone"). */
function deviceId(): string {
  try {
    const have = window.localStorage.getItem(DEVICE_KEY);
    if (have && /^[A-Za-z0-9_-]{16,128}$/.test(have)) return have;
    const fresh = randomId();
    window.localStorage.setItem(DEVICE_KEY, fresh);
    return fresh;
  } catch {
    return randomId();
  }
}

/**
 * Read the credentials from the address and tidy it: the token comes from the fragment (never sent to any server), is kept for this
 * tab in sessionStorage so a reload works, and is then removed from the address bar so a screenshot or history entry does not hold it.
 */
export function readCredentials(loc: Pick<Location, 'search' | 'hash' | 'pathname'>, store: Pick<Storage, 'getItem' | 'setItem'> | null): { sessionId: string; token: string } | null {
  const id = new URLSearchParams(loc.search).get('s');
  if (!isSessionId(id)) return null;
  const fromHash = new URLSearchParams(loc.hash.replace(/^#/, '')).get('t');
  let token = isToken(fromHash) ? fromHash : null;
  try {
    if (token) store?.setItem(credKey(id), token);
    else token = store?.getItem(credKey(id)) ?? null;
  } catch { /* no sessionStorage: the first load still works */ }
  return isToken(token) ? { sessionId: id.toLowerCase(), token } : null;
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

type CameraState = 'idle' | 'starting' | 'on' | 'error';

export function PhoneScanner() {
  const [view, setView] = useState<PhoneState | null>(null);
  const [bad, setBad] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const sender = useRef<PhoneSender | null>(null);

  const [camera, setCamera] = useState<CameraState>('idle');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const camRef = useRef<CameraSession | null>(null);
  const decoderRef = useRef<FrameDecoder | null>(null);
  const stopLoop = useRef<(() => void) | null>(null);
  const feedback = useRef<ScanFeedback | null>(null);
  const wake = useRef<ScreenWake | null>(null);
  const tally = useRef<RapidState>(emptyRapid());

  useEffect(() => {
    let store: Storage | null = null;
    try { store = window.sessionStorage; } catch { store = null; }
    const cred = readCredentials(window.location, store);
    if (!cred) { setBad(true); return undefined; }
    // Remove the secret from the address bar (the session id stays so a reload still finds the session).
    try { window.history.replaceState(null, '', `${window.location.pathname}?s=${cred.sessionId}`); } catch { /* ignore */ }
    const full: PhoneCred = { ...cred, device: deviceId() };
    const snd = new PhoneSender(full, { connect: phoneConnect, push: phonePush }, setView);
    sender.current = snd;
    void snd.connect();
    const retry = setInterval(() => { if (snd.state.queued > 0) void snd.flush(); }, 3000);
    const onOnline = () => void snd.flush();
    window.addEventListener('online', onOnline);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(retry);
      clearInterval(tick);
      window.removeEventListener('online', onOnline);
      teardown();
    };
  }, []);

  function teardown() {
    stopLoop.current?.(); stopLoop.current = null;
    decoderRef.current?.close(); decoderRef.current = null;
    camRef.current?.stop(); camRef.current = null;
    wake.current?.release(); wake.current = null;
    feedback.current?.close(); feedback.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  const stopped = view?.status === 'stopped';
  useEffect(() => {
    if (stopped) { teardown(); setCamera('idle'); }
  }, [stopped]);

  async function startCamera() {
    setCameraError(null);
    setCamera('starting');
    feedback.current ??= createScanFeedback();
    feedback.current.unlock(); // inside the tap, so the browser allows the beep
    wake.current ??= createScreenWake();
    void wake.current.acquire();
    try {
      const [cam, decoder] = await Promise.all([openRearCamera(), createDecoder()]);
      camRef.current = cam;
      decoderRef.current = decoder;
      setCamera('on');
    } catch (e) {
      teardown();
      setCameraError(CAMERA_MESSAGES[(e as { kind?: string })?.kind === 'unsupported' ? 'unsupported' : classifyCameraError(e)]);
      setCamera('error');
    }
  }

  useEffect(() => {
    if (camera !== 'on') return;
    const cam = camRef.current, decoder = decoderRef.current, video = videoRef.current, canvas = canvasRef.current;
    if (!cam || !decoder || !video || !canvas) return;
    video.srcObject = cam.stream;
    void video.play().catch(() => undefined);
    stopLoop.current?.();
    stopLoop.current = startFrameLoop({
      video, canvas: canvas as unknown as DrawCanvas, decoder,
      onCodes: (codes, at) => {
        for (const c of codes) {
          // The same counting rule as the desktop camera: a pack held in view counts once; moving away and back counts again.
          const r = sight(tally.current, c.code, at);
          tally.current = r.state;
          if (r.counted) {
            sender.current?.sendBarcode(c.code);
            feedback.current?.scanned({ sound: true, vibrate: true });
            setFlash((n) => n + 1);
          }
        }
      },
    });
  }, [camera]);

  const addManual = useCallback(() => {
    const code = normaliseRetailCode(manual);
    if (!code) { setManualError('Enter the 8, 12 or 13 digits printed under the barcode.'); return; }
    setManualError(null);
    sender.current?.sendBarcode(code);
    setManual('');
  }, [manual]);

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const input = e.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    setPhotoNote('Preparing the photo...');
    let out = await downscaleImage(file, { maxEdge: 1600, quality: 0.8 });
    if (out.size > MAX_PHOTO_BYTES) out = await downscaleImage(file, { maxEdge: 1100, quality: 0.7 });
    if (out.size > MAX_PHOTO_BYTES || !/^image\/(jpeg|png|webp)$/.test(out.type)) {
      setPhotoNote('That photo could not be shrunk enough to send. Try again with the phone a little further away.');
      return;
    }
    sender.current?.sendPhoto(await toBase64(out), out.type);
    setPhotoNote('Photo sent.');
  }

  if (bad) {
    return (
      <main className={p.page}>
        <h1>This link does not work</h1>
        <p>It is missing the scanning code or is not a scanning link. On the computer, press <strong>Use my phone</strong> to show a fresh QR code, and scan that.</p>
      </main>
    );
  }
  if (!view || view.status === 'connecting') {
    return <main className={p.page}><h1>Connecting...</h1><p role="status">Linking this phone to your computer.</p></main>;
  }
  if (view.status === 'stopped' && view.sent === 0 && !view.purpose) {
    return (
      <main className={p.page}>
        <h1>Cannot scan for the computer</h1>
        <p role="alert" data-testid="phone-fatal">{view.message}</p>
      </main>
    );
  }

  const left = view.expiresAt ? secondsLeft(view.expiresAt, now) : 0;
  const pantry = view.purpose === 'pantry';
  const roiStyle = { width: `${ROI_WIDTH * 100}%`, height: `${ROI_HEIGHT * 100}%` };

  return (
    <main className={p.page} data-testid="phone-page" data-status={view.status}>
      <h1>{pantry ? 'Scanning for your pantry' : 'Photographing a receipt'}</h1>
      <p className={s.muted}>Connected to your computer. Whatever you scan appears there for you to check; nothing is saved until you confirm on the computer.</p>
      <p role="status" aria-live="polite" data-testid="phone-sent">
        <strong>{view.sent}</strong> sent{view.queued > 0 ? `, ${view.queued} waiting for a connection` : ''}.{' '}
        {view.status === 'ready' && <span className={s.muted}>Time left {formatCountdown(left)}</span>}
      </p>
      {view.message && <p role={view.status === 'stopped' ? 'alert' : 'status'} className={s.error} data-testid="phone-message">{view.message}</p>}

      {view.status === 'ready' && (
        <>
          {pantry && (
            <section className={s.stack} aria-label="Barcodes">
              {camera !== 'on' && (
                <div className={s.actions}>
                  <Button size="lg" onClick={() => void startCamera()} loading={camera === 'starting'} data-testid="phone-camera-start">Scan barcodes</Button>
                </div>
              )}
              {cameraError && <p role="alert" className={s.fieldError}>{cameraError}</p>}
              {camera === 'on' && (
                <>
                  <div className={s.scanner} data-testid="phone-scanner-view">
                    <video ref={videoRef} className={s.scanVideo} playsInline muted aria-label="Camera view for barcode scanning" />
                    <canvas ref={canvasRef} hidden />
                    <div className={s.reticle} style={roiStyle} aria-hidden="true" />
                    {flash > 0 && <div key={flash} className={s.flash} aria-hidden="true" />}
                  </div>
                  <div className={s.actions}>
                    <Button variant="secondary" onClick={() => { teardown(); setCamera('idle'); }}>Stop the camera</Button>
                  </div>
                </>
              )}
              <form className={s.actions} onSubmit={(e) => { e.preventDefault(); if (manual.trim()) addManual(); }}>
                <Input label="Or type a barcode" inputMode="numeric" autoComplete="off" value={manual} placeholder="e.g. 5000157024671" onChange={(e) => setManual(e.target.value)} data-testid="phone-ean-input" />
                <Button type="submit" variant="secondary" disabled={manual.trim() === ''} data-testid="phone-ean-add">Send</Button>
              </form>
              {manualError && <p role="alert" className={s.fieldError}>{manualError}</p>}
            </section>
          )}

          <section className={s.stack} aria-label="Photos">
            <label className={`fr-btn fr-btn--${pantry ? 'secondary' : 'primary'} fr-btn--lg ${p.photoBtn}`}>
              {pantry ? 'Take a photo of the shelf, fridge or a label' : 'Take a photo of the receipt'}
              <input type="file" accept="image/*" capture="environment" className="fr-visually-hidden" onChange={(e) => void onPhoto(e)} data-testid="phone-photo-input" />
            </label>
            {photoNote && <p role="status" className={s.muted} data-testid="phone-photo-note">{photoNote}</p>}
          </section>
        </>
      )}

      {view.recent.length > 0 && (
        <section aria-label="Sent">
          <h2 className={p.h2}>Sent</h2>
          <ul className={p.recent} data-testid="phone-recent">
            {view.recent.map((r) => (
              <li key={r.id} data-state={r.state}>
                <span>{r.label}</span>
                <span className={s.muted}>{r.state === 'sent' ? 'sent' : r.state === 'waiting' ? 'waiting...' : r.note ?? 'not sent'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
