import sharp from 'sharp';
import { AiError } from './errors.js';

export interface ImageLimits {
  maxInputBytes: number;   // reject uploads bigger than this
  maxOutputBytes: number;  // post-resize cap sent to provider
  maxLongEdge: number;
  maxImages: number;
}
export const DEFAULT_IMAGE_LIMITS: ImageLimits = {
  maxInputBytes: 15 * 1024 * 1024,
  maxOutputBytes: 3 * 1024 * 1024,
  maxLongEdge: 1568,
  maxImages: 6,
};

export type AiMediaType = 'image/jpeg' | 'image/png' | 'image/webp';
export interface PreparedImage { mediaType: AiMediaType; data: Buffer; width: number; height: number; }

type Sniffed = AiMediaType | 'heic' | null;

const ascii = (b: Uint8Array, s: number, e: number) => String.fromCharCode(...b.subarray(s, e));

/** Detect type from magic bytes (never trust client-declared MIME). */
export function sniffImageType(b: Uint8Array): Sniffed {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return 'image/webp';
  if (b.length >= 12 && ascii(b, 4, 8) === 'ftyp' && /^(heic|heix|hevc|hevx|mif1|msf1|heim|heis)/.test(ascii(b, 8, 12))) return 'heic';
  return null;
}

/**
 * Validate and normalise one image: magic-byte type check, input size cap, EXIF-rotate,
 * resize to max long edge, strip metadata, re-encode as JPEG, enforce output byte cap.
 */
export async function prepareImage(input: Uint8Array, limits: ImageLimits = DEFAULT_IMAGE_LIMITS): Promise<PreparedImage> {
  if (input.byteLength > limits.maxInputBytes) {
    throw new AiError('IMAGE_TOO_LARGE', `${input.byteLength} > ${limits.maxInputBytes}`);
  }
  const type = sniffImageType(input);
  if (type === null || type === 'heic') throw new AiError('UNSUPPORTED_IMAGE_TYPE', type ?? 'unknown');
  const buf = Buffer.from(input);
  let tooBig = false;
  try {
    for (const quality of [85, 70, 55, 40]) {
      const { data, info } = await sharp(buf, { failOn: 'error', limitInputPixels: 100_000_000 })
        .rotate()
        .resize({ width: limits.maxLongEdge, height: limits.maxLongEdge, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality })
        .toBuffer({ resolveWithObject: true });
      if (data.length <= limits.maxOutputBytes) {
        return { mediaType: 'image/jpeg', data, width: info.width, height: info.height };
      }
      tooBig = true;
    }
  } catch (e) {
    throw new AiError('IMAGE_INVALID', String(e), { cause: e });
  }
  throw new AiError('IMAGE_TOO_LARGE', tooBig ? 'could not compress under output cap' : 'unknown');
}

export async function prepareImages(inputs: Uint8Array[], limits: ImageLimits = DEFAULT_IMAGE_LIMITS): Promise<PreparedImage[]> {
  if (inputs.length === 0) throw new AiError('BAD_REQUEST', 'no images');
  if (inputs.length > limits.maxImages) throw new AiError('TOO_MANY_IMAGES', `${inputs.length} > ${limits.maxImages}`);
  return Promise.all(inputs.map((i) => prepareImage(i, limits)));
}

/** Snap any angle to 0/90/180/270 clockwise. */
export function normaliseRotation(degrees: number | undefined): 0 | 90 | 180 | 270 {
  if (degrees === undefined || !Number.isFinite(degrees)) return 0;
  return ((((Math.round(degrees / 90) * 90) % 360) + 360) % 360) as 0 | 90 | 180 | 270;
}

/** Rotate an already-prepared image clockwise by 0/90/180/270 and re-encode as JPEG (used for cover images). */
export async function rotateJpeg(data: Uint8Array, degrees: number): Promise<Buffer> {
  const deg = normaliseRotation(degrees);
  const img = sharp(Buffer.from(data), { failOn: 'error', limitInputPixels: 100_000_000 });
  return (deg === 0 ? img : img.rotate(deg)).jpeg({ quality: 85 }).toBuffer();
}
