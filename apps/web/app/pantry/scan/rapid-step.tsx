'use client';

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { normaliseRetailCode, totalCount, type LookupState } from '@fr/engine/pantry';
import { Button, Card, CardBody, Input } from '@fr/ui';
import { CAMERA_MESSAGES, classifyCameraError, openRearCamera, type CameraSession } from '../../../lib/products/camera';
import { createDecoder, type DecoderKind, type FrameDecoder } from '../../../lib/products/decoder';
import { createScanFeedback, createScreenWake, type ScanFeedback, type ScreenWake } from '../../../lib/products/scan-feedback';
import { ROI_HEIGHT, ROI_WIDTH, startFrameLoop, type DrawCanvas } from '../../../lib/products/scan-loop';
import { PRODUCT_ATTRIBUTION } from '../../../lib/products/types';
import type { ProductLookupDto } from '../../../lib/products/types';
import s from './scan.module.css';
import type { RapidSession } from './use-rapid-session';

const SOUND_KEY = 'fr.rapidscan.sound';
const last4 = (code: string) => code.slice(-4);

/** The line the tally shows for a code, in whatever state its lookup is. */
export function tallyLabel(code: string, state: LookupState<ProductLookupDto> | undefined): { name: string; detail: string; tone: 'ok' | 'wait' | 'warn' } {
  if (state?.state === 'done') {
    const p = state.value.product;
    return { name: p.brand && !p.name.toLowerCase().startsWith(p.brand.toLowerCase()) ? `${p.brand} ${p.name}` : p.name, detail: [p.packSizeText, code].filter(Boolean).join(' / '), tone: 'ok' };
  }
  if (state?.state === 'notfound') return { name: 'Unknown product', detail: `${code}: you can name it in the review`, tone: 'warn' };
  if (state?.state === 'error') return { name: 'Lookup failed', detail: `${code}: ${state.error.message}`, tone: 'warn' };
  return { name: 'Looking up...', detail: code, tone: 'wait' };
}

interface Props {
  session: RapidSession;
  onDone: () => void;
  onCancel: () => void;
}

type CameraState = 'idle' | 'starting' | 'on' | 'error';

/**
 * Continuous barcode scanning (BS1): live rear camera, a ~10 fps decode loop over a downscaled region, a beep + buzz + green
 * flash on every counted read, and a running tally the owner can correct with + / - and Undo, all within thumb reach. Lookups
 * run in the background (they never block the camera). Nothing is written to the pantry here: Done goes to the review.
 */
export function RapidStep({ session, onDone, onCancel }: Props) {
  const { state, lookups } = session;
  const [camera, setCamera] = useState<CameraState>('idle');
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [torch, setTorch] = useState(false);
  const [caps, setCaps] = useState<{ torch: boolean; tapFocus: boolean }>({ torch: false, tapFocus: false });
  const [sound, setSound] = useState(true);
  const [flash, setFlash] = useState(0);
  const [announcement, setAnnouncement] = useState('');
  const [latest, setLatest] = useState<string | null>(null);
  const [kind, setKind] = useState<DecoderKind | null>(null);
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number; n: number } | null>(null);
  const [manual, setManual] = useState('');
  const [manualError, setManualError] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const camRef = useRef<CameraSession | null>(null);
  const decoderRef = useRef<FrameDecoder | null>(null);
  const stopLoop = useRef<(() => void) | null>(null);
  const feedback = useRef<ScanFeedback | null>(null);
  const wake = useRef<ScreenWake | null>(null);
  const pausedRef = useRef(false);
  const soundRef = useRef(true);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const lookupsRef = useRef(lookups);
  lookupsRef.current = lookups;
  pausedRef.current = paused;
  soundRef.current = sound;

  useEffect(() => {
    try { if (window.localStorage.getItem(SOUND_KEY) === 'off') setSound(false); } catch { /* default on */ }
    return () => teardown();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function teardown() {
    stopLoop.current?.(); stopLoop.current = null;
    decoderRef.current?.close(); decoderRef.current = null;
    camRef.current?.stop(); camRef.current = null;
    wake.current?.release(); wake.current = null;
    feedback.current?.close(); feedback.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function announceFor(code: string, total: number) {
    const st = lookupsRef.current.get(code);
    const name = st?.state === 'done' ? tallyLabel(code, st).name : `product ending ${last4(code)}`;
    setAnnouncement(`Added ${name}. ${total} ${total === 1 ? 'item' : 'items'} scanned.`);
  }

  async function start() {
    setCameraError(null);
    setCamera('starting');
    feedback.current ??= createScanFeedback();
    feedback.current.unlock(); // inside the tap, so the browser allows the beep
    wake.current ??= createScreenWake();
    void wake.current.acquire();
    try {
      const params = new URLSearchParams(window.location.search);
      const forced = params.get('decoder');
      const [cam, decoder] = await Promise.all([
        openRearCamera(),
        createDecoder(forced === 'wasm' || forced === 'native' ? { force: forced } : {}),
      ]);
      camRef.current = cam;
      decoderRef.current = decoder;
      setKind(decoder.kind);
      setCaps({ torch: cam.caps.torch, tapFocus: cam.caps.tapFocus });
      setCamera('on');
      await new Promise((r) => setTimeout(r, 0)); // the <video> mounts on the next render
      const video = videoRef.current;
      const canvas = canvasRef.current;
      if (!video || !canvas) { teardown(); setCamera('idle'); return; }
      video.srcObject = cam.stream;
      await video.play().catch(() => undefined);
      stopLoop.current = startFrameLoop({
        video, canvas: canvas as unknown as DrawCanvas, decoder,
        isPaused: () => pausedRef.current,
        onCodes: (codes, at) => {
          for (const c of codes) {
            const r = sessionRef.current.sight(c.code, at);
            if (r.counted) {
              feedback.current?.scanned({ sound: soundRef.current, vibrate: true });
              setFlash((n) => n + 1);
              setLatest(c.code);
              announceFor(c.code, totalCount(r.state));
            }
          }
        },
      });
    } catch (e) {
      teardown();
      const kindOfError = (e as { kind?: string })?.kind === 'unsupported' ? 'unsupported' : classifyCameraError(e);
      setCameraError(CAMERA_MESSAGES[kindOfError]);
      setCamera('error');
    }
  }

  function stopCamera() {
    teardown();
    setCamera('idle');
    setTorch(false);
    setPaused(false);
  }

  async function toggleTorch() {
    const next = !torch;
    if (await camRef.current?.setTorch(next)) setTorch(next);
  }

  function onVideoPointer(e: ReactPointerEvent<HTMLDivElement>) {
    if (!caps.tapFocus) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    setFocusPoint({ x, y, n: Date.now() });
    void camRef.current?.focusAt(x, y);
  }

  function toggleSound() {
    const next = !sound;
    setSound(next);
    try { window.localStorage.setItem(SOUND_KEY, next ? 'on' : 'off'); } catch { /* not persisted */ }
  }

  function addManual() {
    const code = normaliseRetailCode(manual);
    if (!code) { setManualError('Enter the 8, 12 or 13 digits printed under the barcode.'); return; }
    setManualError(null);
    // Typing is deliberate: always counted (the debounce is for a camera seeing the same pack many times).
    const cur = sessionRef.current;
    const known = cur.state.items.some((i) => i.barcode === code);
    if (known) cur.plus(code); else cur.sight(code, Date.now());
    feedback.current?.scanned({ sound: soundRef.current, vibrate: false });
    setLatest(code);
    announceFor(code, totalCount(cur.state) + 1);
    setManual('');
  }

  function done() {
    stopCamera();
    onDone();
  }

  const ordered = useMemo(() => [...state.items].reverse(), [state.items]);
  const total = totalCount(state);
  const pending = state.items.filter((i) => { const st = lookups.get(i.barcode); return !st || st.state === 'pending'; }).length;
  const roiStyle = { width: `${ROI_WIDTH * 100}%`, height: `${ROI_HEIGHT * 100}%` };

  return (
    <div className={s.stack} data-testid="rapid-step">
      <Card>
        <CardBody>
          <div className={s.stack}>
            <h2 style={{ margin: 0, fontSize: 'var(--fr-text-lg)' }}>Scan barcodes continuously</h2>
            <p className={s.muted}>
              Point the camera at each barcode, one after another: it beeps and adds each one. Scan the same product again
              to add another. Nothing is added to your pantry until you review and confirm.
            </p>
            {session.restored && state.items.length > 0 && (
              <p role="note" className={s.info} data-testid="rapid-restored">We kept your {total} scanned {total === 1 ? 'item' : 'items'} from before the page reloaded.</p>
            )}

            {camera !== 'on' && (
              <div className={s.actions}>
                <Button size="lg" onClick={() => void start()} loading={camera === 'starting'} data-testid="rapid-start">
                  {state.items.length > 0 ? 'Resume scanning' : 'Start camera'}
                </Button>
              </div>
            )}
            {cameraError && <p role="alert" className={s.fieldError} data-testid="rapid-camera-error">{cameraError}</p>}

            {camera === 'on' && (
              <div
                className={s.scanner} onPointerDown={onVideoPointer} data-testid="rapid-scanner"
                data-decoder={kind ?? undefined} data-paused={paused ? 'true' : 'false'}
              >
                <video ref={videoRef} className={s.scanVideo} playsInline muted aria-label="Camera view for barcode scanning" data-testid="rapid-video" />
                <canvas ref={canvasRef} hidden />
                <div className={s.reticle} style={roiStyle} aria-hidden="true" />
                {flash > 0 && <div key={flash} className={s.flash} data-testid="scan-flash" aria-hidden="true" />}
                {paused && <div className={s.pausedBadge}>Paused</div>}
                {focusPoint && <div key={focusPoint.n} className={s.focusRing} style={{ left: `${focusPoint.x * 100}%`, top: `${focusPoint.y * 100}%` }} aria-hidden="true" />}
              </div>
            )}

            {camera === 'on' && (
              <div className={s.controls} role="group" aria-label="Scanning controls">
                <Button variant="secondary" size="lg" onClick={() => setPaused((p) => !p)} aria-pressed={paused} data-testid="rapid-pause">
                  {paused ? 'Resume' : 'Pause'}
                </Button>
                <Button variant="secondary" size="lg" onClick={session.undo} disabled={state.history.length === 0} data-testid="rapid-undo">Undo last</Button>
                {caps.torch && (
                  <Button variant="secondary" size="lg" onClick={() => void toggleTorch()} aria-pressed={torch} data-testid="rapid-torch">
                    {torch ? 'Torch on' : 'Torch off'}
                  </Button>
                )}
                <Button variant="ghost" onClick={toggleSound} aria-pressed={sound} data-testid="rapid-sound">{sound ? 'Sound on' : 'Sound off'}</Button>
              </div>
            )}
            {camera === 'on' && caps.tapFocus && <p className={s.muted}>Tap the picture to focus.</p>}

            <div className={s.counter} data-testid="rapid-counter">
              <strong>{total}</strong> {total === 1 ? 'item' : 'items'} scanned
              {state.items.length > 0 && <> ({state.items.length} {state.items.length === 1 ? 'product' : 'products'})</>}
              {pending > 0 && <span className={s.muted}> / looking up {pending}...</span>}
            </div>
            <p className="fr-visually-hidden" role="status" aria-live="polite" data-testid="rapid-announce">{announcement}</p>

            {state.items.length === 0 ? (
              <p className={s.muted} data-testid="rapid-empty">Nothing scanned yet.</p>
            ) : (
              <ul className={s.tally} aria-label="Scanned products" data-testid="rapid-tally">
                {ordered.map((i) => {
                  const st = lookups.get(i.barcode);
                  const l = tallyLabel(i.barcode, st);
                  const retryable = st?.state === 'error' && st.error.retryable;
                  return (
                    <li key={i.barcode} className={`${s.tallyRow} ${latest === i.barcode ? s.tallyLatest : ''}`} data-testid="tally-row" data-barcode={i.barcode}>
                      <div className={s.tallyText}>
                        <strong data-testid="tally-name">{l.name}</strong>
                        <span className={s.muted}>{l.detail}</span>
                        {retryable && <Button variant="ghost" size="sm" onClick={() => session.retry(i.barcode)}>Try the lookup again</Button>}
                      </div>
                      <div className={s.stepper}>
                        <Button variant="secondary" aria-label={`Remove one ${l.name} (${last4(i.barcode)})`} onClick={() => session.minus(i.barcode)} data-testid="tally-minus">&minus;</Button>
                        <span className={s.count} data-testid="tally-count" aria-label={`${i.count} scanned`}>&times;{i.count}</span>
                        <Button variant="secondary" aria-label={`Add one ${l.name} (${last4(i.barcode)})`} onClick={() => session.plus(i.barcode)} data-testid="tally-plus">+</Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {state.items.some((i) => lookups.get(i.barcode)?.state === 'done') && <p className={s.muted}>{PRODUCT_ATTRIBUTION}.</p>}

            <form className={s.actions} onSubmit={(e) => { e.preventDefault(); if (manual.trim()) addManual(); }}>
              <Input
                label="Or type a barcode" inputMode="numeric" autoComplete="off" value={manual} placeholder="e.g. 5000157024671"
                onChange={(e) => setManual(e.target.value)} data-testid="rapid-ean-input"
              />
              <Button type="submit" variant="secondary" disabled={manual.trim() === ''} data-testid="rapid-ean-add">Add</Button>
            </form>
            {manualError && <p role="alert" className={s.fieldError}>{manualError}</p>}
          </div>
        </CardBody>
      </Card>

      <div className={s.doneBar}>
        <Button size="lg" onClick={done} disabled={state.items.length === 0} data-testid="rapid-done">
          {state.items.length === 0 ? 'Done' : `Done: review ${total} ${total === 1 ? 'item' : 'items'}`}
        </Button>
        <Button variant="ghost" onClick={() => { stopCamera(); onCancel(); }} data-testid="rapid-cancel">Back</Button>
        {state.items.length > 0 && <Button variant="ghost" onClick={() => { stopCamera(); session.clear(); }} data-testid="rapid-clear">Clear all</Button>}
      </div>
    </div>
  );
}
