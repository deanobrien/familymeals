/**
 * EAN-13 / EAN-8 bar patterns and a grayscale bitmap renderer. TEST SUPPORT (BS1): used to generate camera frames for the
 * WASM decoder unit test and the fake-camera e2e video, so scanning is exercised end to end without a physical barcode.
 * Not used at runtime.
 */

const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = ['0100111', '0110011', '0011011', '0100001', '0011101', '0111001', '0000101', '0010001', '0001001', '0010111'];
const R = ['1110010', '1100110', '1101100', '1000010', '1011100', '1001110', '1010000', '1000100', '1001000', '1110100'];
const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];

/** The module pattern ('1' = bar) for an EAN-13 (13 digits) or EAN-8 (8 digits) code. Does not check the check digit. */
export function eanModules(code: string): string {
  if (/^\d{13}$/.test(code)) {
    const parity = PARITY[Number(code[0])]!;
    let out = '101';
    for (let i = 1; i <= 6; i++) out += (parity[i - 1] === 'L' ? L : G)[Number(code[i])]!;
    out += '01010';
    for (let i = 7; i <= 12; i++) out += R[Number(code[i])]!;
    return out + '101';
  }
  if (/^\d{8}$/.test(code)) {
    let out = '101';
    for (let i = 0; i < 4; i++) out += L[Number(code[i])]!;
    out += '01010';
    for (let i = 4; i < 8; i++) out += R[Number(code[i])]!;
    return out + '101';
  }
  throw new Error(`eanModules: expected 8 or 13 digits, got "${code}"`);
}

export interface RenderedBitmap {
  width: number;
  height: number;
  /** One byte per pixel, 0 = black, 255 = white. */
  gray: Uint8Array;
}

export interface RenderOptions {
  moduleWidth?: number;
  barHeight?: number;
  /** Quiet zone, in modules, left and right and top and bottom. */
  quiet?: number;
}

/** A barcode as a grayscale bitmap (bars black on white), with quiet zones. */
export function renderEanGray(code: string, o: RenderOptions = {}): RenderedBitmap {
  const mw = o.moduleWidth ?? 3;
  const bh = o.barHeight ?? 120;
  const q = o.quiet ?? 12;
  const modules = eanModules(code);
  const width = (modules.length + 2 * q) * mw;
  const height = bh + 2 * q * mw;
  const gray = new Uint8Array(width * height).fill(255);
  for (let m = 0; m < modules.length; m++) {
    if (modules[m] !== '1') continue;
    for (let y = q * mw; y < q * mw + bh; y++) {
      for (let x = (q + m) * mw; x < (q + m + 1) * mw; x++) gray[y * width + x] = 0;
    }
  }
  return { width, height, gray };
}

/** Centre `bitmap` on a white `width` x `height` canvas (cropped if larger). */
export function placeOnCanvas(bitmap: RenderedBitmap, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height).fill(255);
  const ox = Math.floor((width - bitmap.width) / 2);
  const oy = Math.floor((height - bitmap.height) / 2);
  for (let y = 0; y < bitmap.height; y++) {
    const ty = y + oy;
    if (ty < 0 || ty >= height) continue;
    for (let x = 0; x < bitmap.width; x++) {
      const tx = x + ox;
      if (tx < 0 || tx >= width) continue;
      out[ty * width + tx] = bitmap.gray[y * bitmap.width + x]!;
    }
  }
  return out;
}

/** Grayscale -> RGBA (the shape of canvas ImageData). */
export function grayToRgba(gray: Uint8Array): Uint8ClampedArray {
  const out = new Uint8ClampedArray(gray.length * 4);
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i]!;
    out[i * 4] = v;
    out[i * 4 + 1] = v;
    out[i * 4 + 2] = v;
    out[i * 4 + 3] = 255;
  }
  return out;
}
