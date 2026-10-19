/** Browser-side photo downscale applied before upload, so phone photos stay well under server body limits. */

export const MAX_EDGE = 2400;
export const JPEG_QUALITY = 0.85;
/** Files at or under this size with dimensions within MAX_EDGE are sent untouched. */
export const SKIP_BELOW_BYTES = 1_500_000;

/** Pure: target size that fits the long edge within maxEdge, never upscaling, keeping aspect ratio. */
export function targetDimensions(width: number, height: number, maxEdge = MAX_EDGE): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= maxEdge || long <= 0) return { width, height };
  const scale = maxEdge / long;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/** Pure: canvas size after `quarterTurns` clockwise quarter turns (odd turns swap the axes). */
export function rotatedDimensions(width: number, height: number, quarterTurns: number): { width: number; height: number } {
  const turns = ((quarterTurns % 4) + 4) % 4;
  return turns % 2 === 1 ? { width: height, height: width } : { width, height };
}

/** Pure: should this file be re-encoded at all? */
export function needsDownscale(bytes: number, width: number, height: number, quarterTurns = 0, maxEdge = MAX_EDGE): boolean {
  return quarterTurns % 4 !== 0 || bytes > SKIP_BELOW_BYTES || Math.max(width, height) > maxEdge;
}

export interface DownscaleOptions {
  maxEdge?: number;
  quality?: number;
  /** Extra clockwise quarter turns applied in the same canvas pass (EXIF orientation is always baked in). */
  quarterTurns?: number;
}

/**
 * Decode (EXIF orientation applied), optionally rotate, shrink to maxEdge and re-encode as JPEG. Returns the
 * original file untouched if it is already small or cannot be decoded (e.g. HEIC outside Safari), so the
 * server can give its own clear message.
 */
export async function downscaleImage(file: File, opts: DownscaleOptions = {}): Promise<File> {
  const maxEdge = opts.maxEdge ?? MAX_EDGE;
  const turns = ((((opts.quarterTurns ?? 0) % 4) + 4) % 4);
  try {
    if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return file;
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      if (!needsDownscale(file.size, bmp.width, bmp.height, turns, maxEdge)) return file;
      const fitted = targetDimensions(bmp.width, bmp.height, maxEdge);
      const out = rotatedDimensions(fitted.width, fitted.height, turns);
      const canvas = document.createElement('canvas');
      canvas.width = out.width;
      canvas.height = out.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.translate(out.width / 2, out.height / 2);
      ctx.rotate((turns * Math.PI) / 2);
      ctx.drawImage(bmp, -fitted.width / 2, -fitted.height / 2, fitted.width, fitted.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', opts.quality ?? JPEG_QUALITY));
      if (!blob || (turns === 0 && blob.size >= file.size && file.type === 'image/jpeg')) return file;
      return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Date.now() });
    } finally {
      bmp.close();
    }
  } catch {
    return file;
  }
}

export const downscaleAll = (files: File[], opts?: DownscaleOptions): Promise<File[]> => Promise.all(files.map((f) => downscaleImage(f, opts)));
