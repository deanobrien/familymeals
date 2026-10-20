import { describe, expect, it } from 'vitest';
import { crc32, safeZipPath, zipChunks, zipStream } from './zip';
import { unzip, unzipText } from './unzip';

async function collect(gen: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  for await (const p of gen) parts.push(p);
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

describe('zip writer', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('round-trips deflated text and stored binary entries (UTF-8 names)', async () => {
    const bin = new Uint8Array(5000).map((_, i) => (i * 31) % 256);
    const buf = await collect(
      zipChunks([
        { name: 'README.txt', data: 'hello '.repeat(200) },
        { name: 'data/recipes.json', data: JSON.stringify({ title: 'Crème brûlée' }) },
        { name: 'images/recipe-images/recipes/a/1.jpg', data: bin },
      ]),
    );
    const files = unzip(buf);
    expect([...files.keys()]).toEqual(['README.txt', 'data/recipes.json', 'images/recipe-images/recipes/a/1.jpg']);
    expect(unzipText(files, 'README.txt')).toBe('hello '.repeat(200));
    expect(JSON.parse(unzipText(files, 'data/recipes.json'))).toEqual({ title: 'Crème brûlée' });
    expect(files.get('images/recipe-images/recipes/a/1.jpg')).toEqual(bin);
    expect(buf.length).toBeLessThan(5000 + 1200 + 500); // README compressed
  });

  it('rejects unsafe and duplicate names', async () => {
    for (const bad of ['/etc/passwd', '../x', 'a/../b', 'a\\b', 'a//b', '', 'a\u0000b']) {
      expect(() => safeZipPath(bad)).toThrow();
    }
    await expect(collect(zipChunks([{ name: 'a', data: '1' }, { name: 'a', data: '2' }]))).rejects.toThrow(/duplicate/);
  });

  it('streams as a web ReadableStream and reports the byte count when done', async () => {
    let done = -1;
    const stream = zipStream([{ name: 'x.txt', data: 'x' }], { onDone: (b) => void (done = b) });
    const buf = new Uint8Array(await new Response(stream).arrayBuffer());
    expect(unzipText(unzip(buf), 'x.txt')).toBe('x');
    expect(done).toBe(buf.length);
  });

  it('reports a failure mid-stream through onError', async () => {
    let failed = false;
    async function* bad() {
      yield { name: 'ok.txt', data: 'ok' };
      throw new Error('boom');
    }
    const stream = zipStream(bad(), { onError: () => void (failed = true) });
    await expect(new Response(stream).arrayBuffer()).rejects.toThrow();
    expect(failed).toBe(true);
  });
});
