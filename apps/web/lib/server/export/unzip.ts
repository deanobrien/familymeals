import { inflateRawSync } from 'node:zlib';
import { crc32 } from './zip';

/**
 * Reader for the archives zip.ts writes (tests and the live suite verify exports with it). Supports stored and
 * deflated entries, no ZIP64; verifies every CRC.
 */
export function unzip(buf: Uint8Array): Map<string, Uint8Array> {
  const v = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip archive');
  const count = v.getUint16(eocd + 10, true);
  let p = v.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const out = new Map<string, Uint8Array>();
  for (let n = 0; n < count; n++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new Error('bad central directory');
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    const compSize = v.getUint32(p + 20, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const local = v.getUint32(p + 42, true);
    const name = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    const lNameLen = v.getUint16(local + 26, true);
    const lExtraLen = v.getUint16(local + 28, true);
    const start = local + 30 + lNameLen + lExtraLen;
    const body = buf.subarray(start, start + compSize);
    const data = method === 8 ? new Uint8Array(inflateRawSync(body)) : method === 0 ? body.slice() : null;
    if (!data) throw new Error(`unsupported method ${method}`);
    if (crc32(data) !== crc) throw new Error(`crc mismatch for ${name}`);
    out.set(name, data);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export function unzipText(files: Map<string, Uint8Array>, name: string): string {
  const f = files.get(name);
  if (!f) throw new Error(`missing ${name}`);
  return new TextDecoder().decode(f);
}
