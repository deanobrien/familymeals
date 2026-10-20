import 'server-only';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataDir } from '../ai/secret';

/**
 * Local dev store for uploaded recipe photos: `<dataDir>/uploads/<uploadId>/{page-N.jpg,cover.jpg,.saved}`.
 * Gitignored. Served by `app/api/uploads/[id]/[file]/route.ts`.
 * Local-mode implementation behind `ImageStore` (lib/server/images); with DATA_BACKEND=supabase images live in Supabase
 * Storage instead (ST1, D190).
 */
export const UPLOAD_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const UPLOAD_FILE_RE = /^(?:page-\d{1,2}|cover)\.jpg$/;

const UNSAVED_TTL_MS = 24 * 60 * 60 * 1000;

export const coverUrl = (id: string) => `/api/uploads/${id}/cover.jpg`;
export const pageUrl = (id: string, n: number) => `/api/uploads/${id}/page-${n}.jpg`;

export interface UploadFiles {
  writePages(id: string, pages: Uint8Array[]): void;
  writePage(id: string, n: number, data: Uint8Array): void;
  writeCover(id: string, data: Uint8Array): void;
  /** Returns undefined for unknown ids/files and for anything that is not a plain expected file name. */
  read(id: string, file: string): Buffer | undefined;
  markSaved(id: string): void;
  /** Remove unsaved upload folders older than the TTL (saved recipes keep theirs). */
  sweep(now?: number): void;
}

export class DiskUploadFiles implements UploadFiles {
  constructor(private readonly root: string = join(dataDir(), 'uploads')) {}

  private dirFor(id: string): string | undefined {
    return UPLOAD_ID_RE.test(id) ? join(this.root, id) : undefined;
  }

  writePages(id: string, pages: Uint8Array[]): void {
    const dir = this.dirFor(id);
    if (!dir) throw new Error('bad upload id');
    mkdirSync(dir, { recursive: true });
    pages.forEach((p, i) => writeFileSync(join(dir, `page-${i + 1}.jpg`), p));
  }

  writePage(id: string, n: number, data: Uint8Array): void {
    const dir = this.dirFor(id);
    if (!dir || !UPLOAD_FILE_RE.test(`page-${n}.jpg`)) throw new Error('bad upload id');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `page-${n}.jpg`), data);
  }

  writeCover(id: string, data: Uint8Array): void {
    const dir = this.dirFor(id);
    if (!dir) throw new Error('bad upload id');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'cover.jpg'), data);
  }

  read(id: string, file: string): Buffer | undefined {
    const dir = this.dirFor(id);
    if (!dir || !UPLOAD_FILE_RE.test(file)) return undefined;
    const p = join(dir, file);
    return existsSync(p) ? readFileSync(p) : undefined;
  }

  markSaved(id: string): void {
    const dir = this.dirFor(id);
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '.saved'), new Date().toISOString());
  }

  sweep(now = Date.now()): void {
    if (!existsSync(this.root)) return;
    for (const name of readdirSync(this.root)) {
      const dir = join(this.root, name);
      try {
        if (!UPLOAD_ID_RE.test(name) || existsSync(join(dir, '.saved'))) continue;
        if (now - statSync(dir).mtimeMs > UNSAVED_TTL_MS) rmSync(dir, { recursive: true, force: true });
      } catch { /* best effort */ }
    }
  }
}

const g = globalThis as unknown as { __frUploadFiles?: UploadFiles };
export function getUploadFiles(): UploadFiles {
  return (g.__frUploadFiles ??= new DiskUploadFiles());
}
