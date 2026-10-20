import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { FIXTURE_CODES, grayToRgba, placeOnCanvas, renderEanGray } from '@fr/product-sources';
import { WASM_FORMATS, chooseDecoderKind, createDecoder, type FrameCanvas, type WasmReader } from './decoder';

const BEANS = FIXTURE_CODES.bakedBeans;
const wasmPath = fileURLToPath(new URL('../../public/vendor/zxing/zxing_reader.wasm', import.meta.url));

/** A canvas-like holding an RGBA frame, for the decoders (which only call getContext('2d').getImageData). */
function frame(code: string, w = 480, h = 300, opts: Parameters<typeof renderEanGray>[1] = { moduleWidth: 3, barHeight: 110, quiet: 10 }): FrameCanvas {
  const gray = placeOnCanvas(renderEanGray(code, opts), w, h);
  const data = grayToRgba(gray);
  return {
    width: w, height: h,
    getContext: () => ({ getImageData: () => ({ data, width: w, height: h, colorSpace: 'srgb' }) as unknown as ImageData }),
  };
}

/** The real zxing-wasm reader, loaded from the vendored binary in Node (what the browser loads from /vendor/zxing/). */
async function nodeReader(): Promise<WasmReader> {
  const mod = await import('zxing-wasm/reader');
  await mod.prepareZXingModule({ overrides: { wasmBinary: readFileSync(wasmPath) as unknown as ArrayBuffer }, fireImmediately: true });
  return {
    async read(image) {
      const res = await mod.readBarcodes(image, { formats: [...WASM_FORMATS], maxNumberOfSymbols: 2, tryHarder: false, tryRotate: true, tryInvert: false, tryDownscale: false });
      return res.map((r) => ({ text: r.text, format: r.format, isValid: r.isValid }));
    },
  };
}

describe('chooseDecoderKind (WASM fallback selection)', () => {
  it('uses the platform detector only when it reads EAN-13', () => {
    expect(chooseDecoderKind({ hasNative: true, supported: ['ean_13', 'ean_8', 'qr_code'] })).toBe('native');
    expect(chooseDecoderKind({ hasNative: true, supported: [] })).toBe('wasm'); // desktop Chrome with no formats
    expect(chooseDecoderKind({ hasNative: true, supported: ['qr_code'] })).toBe('wasm');
    expect(chooseDecoderKind({ hasNative: false, supported: [] })).toBe('wasm'); // Safari, Firefox
  });
});

describe('createDecoder', () => {
  const stubWasm = (): { loadWasm: () => Promise<WasmReader>; load: ReturnType<typeof vi.fn> } => {
    const load = vi.fn(async () => ({ read: async () => [{ text: BEANS, format: 'EAN-13', isValid: true }] }) as WasmReader);
    return { loadWasm: load, load };
  };
  const canvas = frame(BEANS);

  it('without BarcodeDetector it lazy-loads the WASM reader, once, and returns normalised codes', async () => {
    const { loadWasm, load } = stubWasm();
    const d = await createDecoder({ win: {}, loadWasm });
    expect(d.kind).toBe('wasm');
    expect(load).not.toHaveBeenCalled(); // not loaded until the first frame
    expect(await d.decode(canvas)).toEqual([{ code: BEANS, format: 'EAN-13' }]);
    await d.decode(canvas);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('with a BarcodeDetector that reads retail codes it uses it and never loads the WASM', async () => {
    const { loadWasm, load } = stubWasm();
    const detect = vi.fn(async () => [{ rawValue: BEANS, format: 'ean_13' }, { rawValue: 'https://x.test', format: 'qr_code' }]);
    class BD { constructor(public o: { formats: string[] }) {} detect = detect; static getSupportedFormats = async () => ['ean_13', 'ean_8', 'upc_a', 'qr_code']; }
    const d = await createDecoder({ win: { BarcodeDetector: BD }, loadWasm });
    expect(d.kind).toBe('native');
    expect(await d.decode(canvas)).toEqual([{ code: BEANS, format: 'ean_13' }]); // the QR code is dropped
    expect(load).not.toHaveBeenCalled();
  });

  it('falls back to WASM when the platform detector reports no formats, or throws NotSupportedError', async () => {
    const { loadWasm } = stubWasm();
    class Empty { detect = async () => []; static getSupportedFormats = async () => [] as string[]; }
    expect((await createDecoder({ win: { BarcodeDetector: Empty }, loadWasm })).kind).toBe('wasm');

    class Broken { detect = async () => { throw Object.assign(new Error('x'), { name: 'NotSupportedError' }); }; static getSupportedFormats = async () => ['ean_13']; }
    const d = await createDecoder({ win: { BarcodeDetector: Broken }, loadWasm });
    expect(d.kind).toBe('native');
    expect(await d.decode(canvas)).toEqual([]); // that frame is lost...
    expect(d.kind).toBe('wasm'); // ...and the decoder has handed over for good
    expect(await d.decode(canvas)).toEqual([{ code: BEANS, format: 'EAN-13' }]);
  });

  it('expands UPC-E and drops codes with a bad check digit or invalid symbols', async () => {
    const loadWasm = async () => ({ read: async () => [
      { text: '04252614', format: 'UPC-E', isValid: true },
      { text: '5009000000011', format: 'EAN-13', isValid: true },
      { text: BEANS, format: 'EAN-13', isValid: false },
    ] }) as WasmReader;
    const d = await createDecoder({ win: {}, loadWasm });
    expect((await d.decode(canvas)).map((c) => c.code)).toEqual(['0042100005264']);
  });

  it('a force option overrides detection (escape hatch)', async () => {
    const { loadWasm } = stubWasm();
    class BD { detect = async () => []; static getSupportedFormats = async () => ['ean_13']; }
    expect((await createDecoder({ win: { BarcodeDetector: BD }, loadWasm, force: 'wasm' })).kind).toBe('wasm');
  });

  it('a failed WASM load is retried on the next frame rather than cached', async () => {
    let n = 0;
    const loadWasm = async (): Promise<WasmReader> => { if (++n === 1) throw new Error('offline'); return { read: async () => [{ text: BEANS, format: 'EAN-13' }] }; };
    const d = await createDecoder({ win: {}, loadWasm });
    await expect(d.decode(canvas)).rejects.toThrow('offline');
    expect(await d.decode(canvas)).toEqual([{ code: BEANS, format: 'EAN-13' }]);
  });
});

describe('the real zxing-wasm reader on rendered barcodes (what iPhone Safari runs)', () => {
  it('ships the binary the installed package expects', async () => {
    const { ZXING_WASM_SHA256 } = await import('zxing-wasm/reader');
    const mine = createHash('sha256').update(readFileSync(wasmPath)).digest('hex');
    // If this fails after a zxing-wasm upgrade: re-copy node_modules/zxing-wasm/dist/reader/zxing_reader.wasm to
    // apps/web/public/vendor/zxing/ (and update DECISIONS D271).
    expect(mine).toBe(ZXING_WASM_SHA256);
  });

  it('decodes EAN-13 frames, EAN-8 and a UPC-A (as its EAN-13), and ignores a blank frame', async () => {
    const reader = await nodeReader();
    const d = await createDecoder({ win: {}, loadWasm: async () => reader });
    expect((await d.decode(frame(BEANS))).map((c) => c.code)).toEqual([BEANS]);
    expect((await d.decode(frame(FIXTURE_CODES.wholewheatFusilli, 640, 400))).map((c) => c.code)).toEqual([FIXTURE_CODES.wholewheatFusilli]);
    expect((await d.decode(frame('96385074'))).map((c) => c.code)).toEqual(['96385074']);
    // 0 + 036000291452 renders as the EAN-13 0036000291452 (a UPC-A symbol is the same bars)
    expect((await d.decode(frame('0036000291452'))).map((c) => c.code)).toEqual(['0036000291452']);
    const blank: FrameCanvas = { width: 100, height: 100, getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(100 * 100 * 4).fill(255), width: 100, height: 100 }) as unknown as ImageData }) };
    expect(await d.decode(blank)).toEqual([]);
  }, 30_000);

  it('reads a smaller, lower-resolution barcode (2 px modules)', async () => {
    const reader = await nodeReader();
    const d = await createDecoder({ win: {}, loadWasm: async () => reader });
    const f = frame(BEANS, 320, 200, { moduleWidth: 2, barHeight: 80, quiet: 10 });
    expect((await d.decode(f)).map((c) => c.code)).toEqual([BEANS]);
  }, 30_000);
});
