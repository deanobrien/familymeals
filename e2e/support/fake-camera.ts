import { existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { placeOnCanvas, renderEanGray } from '../../packages/product-sources/src/ean13-render';

/**
 * A Y4M video for Chromium's fake camera (--use-file-for-fake-video-capture) that shows barcodes one after another with
 * blank gaps, looping: BEANS, gap, BEANS (a deliberate re-scan), gap, FUSILLI, gap, UNKNOWN (valid, not in the mock
 * catalogue), gap. 10 fps, 2.5 s per segment. Generated into the temp folder (idempotent, race-safe), never committed.
 */
export const CAMERA_CODES = {
  beans: '5009000000015',
  fusilli: '5009000000046',
  unknown: '4006381333931',
} as const;

const W = 320;
const H = 240;
const FPS = 10;
const SEGMENT_FRAMES = 25;

export function fakeCameraVideoPath(): string {
  const dir = join(tmpdir(), 'fr-e2e-fake-camera');
  const file = join(dir, 'barcodes-v1.y4m');
  if (existsSync(file)) return file;
  mkdirSync(dir, { recursive: true });
  const chroma = Buffer.alloc((W * H) / 4, 128);
  const frameOf = (code: string | null): Buffer => {
    const y = code ? placeOnCanvas(renderEanGray(code, { moduleWidth: 2, barHeight: 80, quiet: 10 }), W, H) : new Uint8Array(W * H).fill(235);
    return Buffer.concat([Buffer.from('FRAME\n'), Buffer.from(y), chroma, chroma]);
  };
  const sequence: Array<string | null> = [
    CAMERA_CODES.beans, null, CAMERA_CODES.beans, null, CAMERA_CODES.fusilli, null, CAMERA_CODES.unknown, null,
  ];
  const parts: Buffer[] = [Buffer.from(`YUV4MPEG2 W${W} H${H} F${FPS}:1 Ip A1:1 C420jpeg\n`)];
  for (const code of sequence) {
    const f = frameOf(code);
    for (let i = 0; i < SEGMENT_FRAMES; i++) parts.push(f);
  }
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, Buffer.concat(parts));
  renameSync(tmp, file);
  return file;
}
