import { deflateRawSync } from 'node:zlib';

/**
 * Minimal streaming ZIP writer (PKZIP 2.0, no ZIP64) for data exports (DX1, D251). Entries are produced lazily by an
 * async iterable and written one at a time, so only the current entry is held in memory (images are never all
 * buffered together). Text entries are deflated; images are stored (JPEG/PNG do not compress).
 * Limits: < 65,535 entries and < 4 GiB in total, enforced (an export that large fails instead of corrupting).
 */
export interface ZipEntry {
  /** Forward-slash path inside the archive; validated by safeZipPath(). */
  name: string;
  data: Uint8Array | string;
  /** Deflate this entry (default: true for strings, false for bytes). */
  compress?: boolean;
  mtime?: Date;
}

const MAX_ENTRIES = 65_534;
const MAX_U32 = 0xffffffff;

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Rejects absolute paths, traversal, backslashes, empty or control-character segments. */
export function safeZipPath(name: string): string {
  if (!name || name.length > 500 || name.startsWith('/') || name.includes('\\') || [...name].some((c) => c.charCodeAt(0) < 0x20)) {
    throw new Error('unsafe zip entry name');
  }
  for (const seg of name.split('/')) {
    if (seg === '' || seg === '.' || seg === '..') throw new Error('unsafe zip entry name');
  }
  return name;
}

function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | Math.floor(d.getUTCSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

interface CentralRecord {
  name: Uint8Array;
  method: number;
  time: number;
  date: number;
  crc: number;
  compSize: number;
  size: number;
  offset: number;
}

const enc = new TextEncoder();

function localHeader(r: CentralRecord): Uint8Array {
  const b = new Uint8Array(30 + r.name.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x04034b50, true);
  v.setUint16(4, 20, true);
  v.setUint16(6, 0x0800, true); // UTF-8 names
  v.setUint16(8, r.method, true);
  v.setUint16(10, r.time, true);
  v.setUint16(12, r.date, true);
  v.setUint32(14, r.crc, true);
  v.setUint32(18, r.compSize, true);
  v.setUint32(22, r.size, true);
  v.setUint16(26, r.name.length, true);
  v.setUint16(28, 0, true);
  b.set(r.name, 30);
  return b;
}

function centralHeader(r: CentralRecord): Uint8Array {
  const b = new Uint8Array(46 + r.name.length);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x02014b50, true);
  v.setUint16(4, 20, true);
  v.setUint16(6, 20, true);
  v.setUint16(8, 0x0800, true);
  v.setUint16(10, r.method, true);
  v.setUint16(12, r.time, true);
  v.setUint16(14, r.date, true);
  v.setUint32(16, r.crc, true);
  v.setUint32(20, r.compSize, true);
  v.setUint32(24, r.size, true);
  v.setUint16(28, r.name.length, true);
  // extra, comment, disk, internal attrs = 0
  v.setUint32(38, 0, true); // external attrs
  v.setUint32(42, r.offset, true);
  b.set(r.name, 46);
  return b;
}

function endRecord(count: number, cdSize: number, cdOffset: number): Uint8Array {
  const b = new Uint8Array(22);
  const v = new DataView(b.buffer);
  v.setUint32(0, 0x06054b50, true);
  v.setUint16(8, count, true);
  v.setUint16(10, count, true);
  v.setUint32(12, cdSize, true);
  v.setUint32(16, cdOffset, true);
  return b;
}

/** Async generator of archive chunks. */
export async function* zipChunks(entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>): AsyncGenerator<Uint8Array> {
  const central: CentralRecord[] = [];
  const seen = new Set<string>();
  let offset = 0;
  for await (const e of entries) {
    const name = safeZipPath(e.name);
    if (seen.has(name)) throw new Error('duplicate zip entry name');
    seen.add(name);
    if (central.length >= MAX_ENTRIES) throw new Error('too many entries for a zip export');
    const raw = typeof e.data === 'string' ? enc.encode(e.data) : e.data;
    const compress = e.compress ?? typeof e.data === 'string';
    const body = compress ? new Uint8Array(deflateRawSync(raw)) : raw;
    const { time, date } = dosTime(e.mtime ?? new Date());
    const rec: CentralRecord = {
      name: enc.encode(name),
      method: compress ? 8 : 0,
      time,
      date,
      crc: crc32(raw),
      compSize: body.length,
      size: raw.length,
      offset,
    };
    const header = localHeader(rec);
    if (offset + header.length + body.length > MAX_U32) throw new Error('export too large for a zip archive');
    offset += header.length + body.length;
    central.push(rec);
    yield header;
    yield body;
  }
  const cdOffset = offset;
  let cdSize = 0;
  for (const r of central) {
    const h = centralHeader(r);
    cdSize += h.length;
    yield h;
  }
  yield endRecord(central.length, cdSize, cdOffset);
}

/** Web ReadableStream over zipChunks (for a streamed Response). onDone/onError fire once at the end. */
export function zipStream(
  entries: AsyncIterable<ZipEntry> | Iterable<ZipEntry>,
  hooks: { onDone?: (bytes: number) => void | Promise<void>; onError?: (e: unknown) => void | Promise<void> } = {},
): ReadableStream<Uint8Array> {
  const it = zipChunks(entries);
  let bytes = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await it.next();
        if (done) {
          controller.close();
          await hooks.onDone?.(bytes);
          return;
        }
        bytes += value.length;
        controller.enqueue(value);
      } catch (e) {
        await hooks.onError?.(e);
        controller.error(e);
      }
    },
    async cancel() {
      await it.return(undefined);
      await hooks.onError?.(new Error('download cancelled'));
    },
  });
}
