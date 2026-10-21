// The QR we draw must actually be readable: decode it with the same zxing reader the barcode scanner ships.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildPhoneLink } from '@fr/engine/scanner';
import { QUIET, qrMatrix, qrPath, qrViewBox } from './qr';

const wasmPath = fileURLToPath(new URL('../../public/vendor/zxing/zxing_reader.wasm', import.meta.url));
const LINK = buildPhoneLink('https://family-recipes-dean-cph4g5cuh9fmhhfy.ukwest-01.azurewebsites.net', '3f2b8c1e-9a4d-4e6b-8c7f-0a1b2c3d4e5f', 'abcdefghijklmnopqrstuvwxyz0123456789_-ABCDE');

/** Rasterise the matrix (with its quiet zone) at `scale` px per module into an RGBA ImageData-like. */
function raster(matrix: boolean[][], scale: number) {
  const size = qrViewBox(matrix) * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  matrix.forEach((row, r) => row.forEach((dark, c) => {
    if (!dark) return;
    for (let y = 0; y < scale; y++) for (let x = 0; x < scale; x++) {
      const i = (((r + QUIET) * scale + y) * size + (c + QUIET) * scale + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  }));
  return { data, width: size, height: size, colorSpace: 'srgb' } as unknown as ImageData;
}

describe('qr', () => {
  it('draws a square matrix with finder patterns and a path for the dark modules', () => {
    const m = qrMatrix(LINK);
    expect(m.length).toBeGreaterThanOrEqual(25);
    expect(m.every((row) => row.length === m.length)).toBe(true);
    expect([m[0]![0], m[0]![6], m[6]![0], m[6]![6]]).toEqual([true, true, true, true]); // top-left finder corners
    const d = qrPath(m);
    expect(d.startsWith('M')).toBe(true);
    expect(d.length).toBeGreaterThan(200);
  });

  it('decodes back to exactly the link', async () => {
    const mod = await import('zxing-wasm/reader');
    await mod.prepareZXingModule({ overrides: { wasmBinary: readFileSync(wasmPath) as unknown as ArrayBuffer }, fireImmediately: true });
    const res = await mod.readBarcodes(raster(qrMatrix(LINK), 6), { formats: ['QRCode'], maxNumberOfSymbols: 1, tryHarder: true });
    expect(res[0]?.isValid).toBe(true);
    expect(res[0]?.text).toBe(LINK);
  });
});
