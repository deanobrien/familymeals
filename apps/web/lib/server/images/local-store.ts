import 'server-only';
import { coverUrl, getUploadFiles, pageUrl, type UploadFiles } from '../uploads/dev-store';
import { isValidImageRef, type ImageKind } from './paths';
import type { ImageStore } from './store';

/** Local-file ImageStore (dev / mock mode): the existing `<APP_DATA_DIR>/uploads/<id>/...` layout, served by /api/uploads. */
export class LocalImageStore implements ImageStore {
  readonly backend = 'local' as const;
  constructor(private readonly files: UploadFiles = getUploadFiles()) {}

  private check(kind: ImageKind, id: string, file: string) {
    if (kind === 'receipt') throw new Error('Receipt images are only stored with the Supabase backend.');
    if (!isValidImageRef(kind, id, file)) throw new Error('bad image reference');
  }

  async put(kind: ImageKind, id: string, file: string, data: Uint8Array): Promise<string> {
    this.check(kind, id, file);
    if (kind === 'cover') {
      this.files.writeCover(id, data);
      return coverUrl(id);
    }
    const n = Number(/^page-(\d+)\.jpg$/.exec(file)![1]);
    this.files.writePage(id, n, data);
    return pageUrl(id, n);
  }

  async get(kind: ImageKind, id: string, file: string): Promise<Uint8Array | undefined> {
    if (kind === 'receipt' || !isValidImageRef(kind, id, file)) return undefined;
    return this.files.read(id, file);
  }

  async signedUrl(kind: ImageKind, id: string, file: string): Promise<string | undefined> {
    if (kind === 'receipt' || !isValidImageRef(kind, id, file)) return undefined;
    return this.files.read(id, file) ? `/api/uploads/${id}/${file}` : undefined;
  }

  async finishUpload(id: string): Promise<void> {
    this.files.markSaved(id);
  }

  async sweep(): Promise<void> {
    this.files.sweep();
  }
}
