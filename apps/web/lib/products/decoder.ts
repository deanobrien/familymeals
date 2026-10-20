// Frame decoders for continuous barcode scanning (BS1, D270-D271): the platform BarcodeDetector where it really reads
// retail codes (Android Chrome), otherwise a lazy-loaded zxing-wasm reader (iPhone Safari, Firefox, desktop). Both take
// the same input (a small canvas holding the downscaled region of interest) and return normalised retail codes, so the
// scan loop does not care which one it has. Pure over small interfaces: unit-testable without a camera or a browser.
import { normaliseRetailCode } from '@fr/engine/pantry';

export const NATIVE_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as const;
export const WASM_FORMATS = ['EAN13', 'EAN8', 'UPCA', 'UPCE'] as const;
/** Where the self-hosted WASM binary is served from (apps/web/public/vendor/zxing; D271). */
export const ZXING_WASM_URL = '/vendor/zxing/zxing_reader.wasm';

export type DecoderKind = 'native' | 'wasm';

export interface DecodedCode {
  /** Normalised retail code (EAN-13 / EAN-8), check digit verified. */
  code: string;
  format?: string;
}

/** The frame handed to a decoder: a canvas (2D) holding the region of interest. */
export interface FrameCanvas {
  width: number;
  height: number;
  getContext(type: '2d'): { getImageData(x: number, y: number, w: number, h: number): ImageData } | null;
}

export interface FrameDecoder {
  readonly kind: DecoderKind;
  decode(canvas: FrameCanvas): Promise<DecodedCode[]>;
  close(): void;
}

/** Native only when the browser says it reads EAN-13 (desktop builds can expose BarcodeDetector with no formats at all). */
export function chooseDecoderKind(info: { hasNative: boolean; supported: readonly string[] }): DecoderKind {
  return info.hasNative && info.supported.includes('ean_13') ? 'native' : 'wasm';
}

interface NativeDetector { detect(source: unknown): Promise<Array<{ rawValue: string; format?: string }>> }
interface NativeCtor {
  new (o: { formats: string[] }): NativeDetector;
  getSupportedFormats?: () => Promise<string[]>;
}

export interface WasmReader {
  read(image: ImageData): Promise<Array<{ text: string; format: string; isValid?: boolean }>>;
}

export interface DecoderDeps {
  win?: object;
  /** Test seam: how the WASM reader is loaded. */
  loadWasm?: () => Promise<WasmReader>;
  /** Force a kind (the ?decoder=wasm|native escape hatch and tests). */
  force?: DecoderKind;
}

function mapCodes(items: Array<{ raw: string; format?: string }>): DecodedCode[] {
  const seen = new Set<string>();
  const out: DecodedCode[] = [];
  for (const i of items) {
    const code = normaliseRetailCode(i.raw, i.format);
    if (code && !seen.has(code)) {
      seen.add(code);
      out.push({ code, ...(i.format ? { format: i.format } : {}) });
    }
  }
  return out;
}

/** The real WASM reader: dynamic import so the ~1 MB binary and its loader are fetched only when needed. */
export async function loadZxingReader(): Promise<WasmReader> {
  const mod = await import('zxing-wasm/reader');
  await mod.prepareZXingModule({
    overrides: { locateFile: (path: string, prefix: string) => (path.endsWith('.wasm') ? ZXING_WASM_URL : prefix + path) },
    fireImmediately: true,
  });
  return {
    async read(image) {
      const res = await mod.readBarcodes(image, {
        formats: [...WASM_FORMATS], maxNumberOfSymbols: 2, tryHarder: false, tryRotate: true, tryInvert: false, tryDownscale: false,
      });
      return res.map((r) => ({ text: r.text, format: r.format, isValid: r.isValid }));
    },
  };
}

function wasmDecoder(load: () => Promise<WasmReader>): FrameDecoder {
  let reader: Promise<WasmReader> | null = null;
  return {
    kind: 'wasm',
    async decode(canvas) {
      const ctx = canvas.getContext('2d');
      if (!ctx) return [];
      reader ??= load().catch((e) => { reader = null; throw e; });
      const r = await reader;
      const results = await r.read(ctx.getImageData(0, 0, canvas.width, canvas.height));
      return mapCodes(results.filter((x) => x.isValid !== false).map((x) => ({ raw: x.text, format: x.format })));
    },
    close() { reader = null; },
  };
}

function nativeDecoder(detector: NativeDetector, onUnsupported: () => void): FrameDecoder {
  return {
    kind: 'native',
    async decode(canvas) {
      try {
        const found = await detector.detect(canvas);
        return mapCodes(found.map((f) => ({ raw: f.rawValue, ...(f.format ? { format: f.format } : {}) })));
      } catch (e) {
        // NotSupportedError = this browser cannot actually decode here: hand over to the WASM reader for good.
        if ((e as { name?: string })?.name === 'NotSupportedError') onUnsupported();
        return [];
      }
    },
    close() { /* nothing to release */ },
  };
}

/**
 * Pick and build the decoder. Async because `BarcodeDetector.getSupportedFormats()` is. The returned decoder swaps itself
 * for the WASM one if the native one turns out unusable on the first frames.
 */
export async function createDecoder(deps: DecoderDeps = {}): Promise<FrameDecoder> {
  const win = deps.win ?? (typeof window === 'undefined' ? undefined : window);
  const Ctor = (win as { BarcodeDetector?: NativeCtor } | undefined)?.BarcodeDetector;
  const load = deps.loadWasm ?? loadZxingReader;
  let supported: string[] = [];
  if (Ctor) {
    try { supported = (await Ctor.getSupportedFormats?.()) ?? []; } catch { supported = []; }
  }
  const kind = deps.force ?? chooseDecoderKind({ hasNative: !!Ctor, supported });
  if (kind === 'wasm' || !Ctor) return wasmDecoder(load);
  let active: FrameDecoder;
  const wasm = wasmDecoder(load);
  try {
    const formats = NATIVE_FORMATS.filter((f) => supported.length === 0 || supported.includes(f));
    active = nativeDecoder(new Ctor({ formats: [...formats] }), () => { active = wasm; });
  } catch {
    return wasm;
  }
  return {
    get kind() { return active.kind; },
    decode: (c) => active.decode(c),
    close: () => { active.close(); wasm.close(); },
  };
}
