// Browser barcode detection (X2, D189). Uses the platform BarcodeDetector (Chrome / Edge / Android); where it does not
// exist (Safari, Firefox) the UI offers manual EAN entry instead: no scanning library is bundled (zxing-js is
// unmaintained and ~0.5 MB, the wasm polyfills ~1 MB; revisit if iOS Safari users need camera scanning).
// The loop is pure over small interfaces so it is unit-testable without a camera.

export const BARCODE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;

export interface DetectedBarcode { rawValue: string; format?: string }
export interface BarcodeDetectorLike { detect(source: unknown): Promise<DetectedBarcode[]> }
export type DetectorFactory = (formats: readonly string[]) => BarcodeDetectorLike;

/** The platform detector factory, or null when unsupported. */
export function platformDetector(win: object | undefined = typeof window === 'undefined' ? undefined : window): DetectorFactory | null {
  const Ctor = (win as { BarcodeDetector?: unknown } | undefined)?.BarcodeDetector as (new (o: { formats: string[] }) => BarcodeDetectorLike) | undefined;
  if (!Ctor) return null;
  return (formats) => new Ctor({ formats: [...formats] });
}

export interface ScanLoopOptions {
  detector: BarcodeDetectorLike;
  source: unknown;
  /** Called once with the first plausible code; the loop then stops. */
  onCode: (code: string) => void;
  intervalMs?: number;
  /** Test seam. */
  schedule?: (fn: () => void, ms: number) => unknown;
  cancelSchedule?: (handle: unknown) => void;
}

/** Plausible retail code: 8, 12 or 13 digits (the server validates the check digit). */
export const looksLikeRetailCode = (v: string): boolean => /^(\d{8}|\d{12,13})$/.test(v.trim());

/** Poll the detector until a retail code is read. Returns stop(). Detector errors on a frame are ignored. */
export function startScanLoop(o: ScanLoopOptions): () => void {
  const schedule = o.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = o.cancelSchedule ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  let stopped = false;
  let handle: unknown;
  const tick = async () => {
    if (stopped) return;
    try {
      const found = await o.detector.detect(o.source);
      const hit = found.map((f) => f.rawValue.trim()).find(looksLikeRetailCode);
      if (hit && !stopped) {
        stopped = true;
        o.onCode(hit);
        return;
      }
    } catch {
      // a frame the detector cannot read (video not ready yet): try again
    }
    if (!stopped) handle = schedule(() => void tick(), o.intervalMs ?? 250);
  };
  handle = schedule(() => void tick(), 0);
  return () => {
    stopped = true;
    cancel(handle);
  };
}
