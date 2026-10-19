import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { DEFAULT_IMAGE_LIMITS, prepareImage, prepareImages, sniffImageType } from '../src/index.js';
import { jpeg } from './helpers.js';

const noise = async (w: number, h: number) => {
  const raw = Buffer.alloc(w * h * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24;
  return new Uint8Array(await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png().toBuffer());
};
const heic = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63, 0, 0, 0, 0]);

describe('image preprocessing', () => {
  it('sniffs types from magic bytes', async () => {
    expect(sniffImageType(await jpeg())).toBe('image/jpeg');
    expect(sniffImageType(await noise(8, 8))).toBe('image/png');
    const webp = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: '#fff' } }).webp().toBuffer());
    expect(sniffImageType(webp)).toBe('image/webp');
    expect(sniffImageType(heic)).toBe('heic');
    expect(sniffImageType(new Uint8Array([1, 2, 3, 4]))).toBeNull();
  });

  it('rejects HEIC with a helpful message', async () => {
    const e: any = await prepareImage(heic).catch((x) => x);
    expect(e.code).toBe('UNSUPPORTED_IMAGE_TYPE');
    expect(e.userMessage).toMatch(/HEIC/);
  });

  it('rejects unknown types and corrupt images', async () => {
    expect(((await prepareImage(new Uint8Array(100)).catch((x) => x)) as any).code).toBe('UNSUPPORTED_IMAGE_TYPE');
    const corrupt = new Uint8Array([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03, 0x04]);
    expect(((await prepareImage(corrupt).catch((x) => x)) as any).code).toBe('IMAGE_INVALID');
  });

  it('rejects input over byte limit', async () => {
    const e: any = await prepareImage(await jpeg(), { ...DEFAULT_IMAGE_LIMITS, maxInputBytes: 10 }).catch((x) => x);
    expect(e.code).toBe('IMAGE_TOO_LARGE');
  });

  it('resizes to max long edge without enlarging, output is jpeg', async () => {
    const big = await prepareImage(await jpeg(4000, 2000), { ...DEFAULT_IMAGE_LIMITS, maxLongEdge: 1000 });
    expect(Math.max(big.width, big.height)).toBe(1000);
    expect(big.mediaType).toBe('image/jpeg');
    const small = await prepareImage(await jpeg(300, 200));
    expect([small.width, small.height]).toEqual([300, 200]);
  });

  it('enforces output byte cap', async () => {
    const e: any = await prepareImage(await noise(600, 600), { ...DEFAULT_IMAGE_LIMITS, maxOutputBytes: 1000 }).catch((x) => x);
    expect(e.code).toBe('IMAGE_TOO_LARGE');
  });

  it('limits image count', async () => {
    const imgs = await Promise.all([jpeg(), jpeg(), jpeg()]);
    expect(((await prepareImages(imgs, { ...DEFAULT_IMAGE_LIMITS, maxImages: 2 }).catch((x) => x)) as any).code).toBe('TOO_MANY_IMAGES');
    expect(((await prepareImages([]).catch((x) => x)) as any).code).toBe('BAD_REQUEST');
  });
});
