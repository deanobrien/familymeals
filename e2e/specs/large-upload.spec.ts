// Regression: phone photos over 10MB used to be truncated by the auth middleware body buffer ("That upload could not be read").
import { expect, test } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { randomBytes } from 'node:crypto';

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** Noise RGB PNG (incompressible), so the file is large (~3 bytes/pixel). */
function noisePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const stride = width * 3 + 1;
  const raw = randomBytes(stride * height);
  for (let y = 0; y < height; y++) raw[y * stride] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 1 })), chunk('IEND', Buffer.alloc(0))]);
}

test.describe('large photo upload', () => {
  const big = noisePng(2200, 2200); // ~14.5MB

  test('a >10MB photo is downscaled in the browser and imports', async ({ page }) => {
    expect(big.length).toBeGreaterThan(10 * 1024 * 1024);
    await page.goto('/recipes/import');
    const uploads: number[] = [];
    page.on('request', (r) => {
      if (r.url().endsWith('/api/extract') && r.method() === 'POST') uploads.push(r.postDataBuffer()?.length ?? 0);
    });
    await page.getByTestId('photo-input').setInputFiles({ name: 'huge.png', mimeType: 'image/png', buffer: big });
    await expect(page.getByTestId('page-item')).toHaveCount(1);
    await page.getByRole('button', { name: 'Extract recipe' }).click();
    await expect(page.getByRole('heading', { name: 'Review recipe' })).toBeVisible();
    expect(uploads).toHaveLength(1);
    expect(uploads[0]).toBeLessThan(10 * 1024 * 1024);
  });

  test('server accepts an un-downscaled 11-40MB body (middleware body limit raised)', async ({ request }) => {
    const res = await request.post('/api/extract', {
      multipart: { images: { name: 'huge.png', mimeType: 'image/png', buffer: big } },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).draft).toBeTruthy();
  });
});
