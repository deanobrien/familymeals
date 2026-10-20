import 'server-only';
import { bucketFor, imagePath, type ImageKind } from './paths';
import { SIGNED_URL_TTL_SECONDS, type ImageStore } from './store';

type StorageError = { message: string } | null;

/** The slice of a supabase-js storage bucket client the store uses (structural, so tests can record calls). */
export interface StorageBucketLike {
  upload(path: string, body: Uint8Array, opts: { contentType: string; upsert: boolean }): Promise<{ error: StorageError }>;
  download(path: string): Promise<{ data: Blob | null; error: StorageError }>;
  createSignedUrl(path: string, expiresIn: number): Promise<{ data: { signedUrl: string } | null; error: StorageError }>;
  remove(paths: string[]): Promise<{ error: StorageError }>;
}
export interface StorageClientLike {
  storage: { from(bucket: string): StorageBucketLike };
}

export class ImageStorageError extends Error {
  constructor(op: string, detail: string) {
    super(`image storage ${op} failed: ${detail}`);
    this.name = 'ImageStorageError';
  }
}

/**
 * Supabase Storage ImageStore. `client` is the CALLER's user-scoped client (never service role): the storage RLS policies
 * allow a member of the household named by the first path segment, so another household's objects are invisible
 * (download / signed URL fail) and un-writable. Paths: `<household_id>/<kind>/<id>/<file>` (images/paths.ts).
 */
export class SupabaseImageStore implements ImageStore {
  readonly backend = 'supabase' as const;
  constructor(private readonly client: StorageClientLike, private readonly householdId: string) {}

  private bucket(kind: ImageKind) {
    return this.client.storage.from(bucketFor(kind));
  }

  async put(kind: ImageKind, id: string, file: string, data: Uint8Array): Promise<string> {
    const path = imagePath(this.householdId, kind, id, file);
    const { error } = await this.bucket(kind).upload(path, data, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new ImageStorageError('upload', error.message);
    return path;
  }

  async get(kind: ImageKind, id: string, file: string): Promise<Uint8Array | undefined> {
    const { data, error } = await this.bucket(kind).download(imagePath(this.householdId, kind, id, file));
    if (error || !data) return undefined;
    return new Uint8Array(await data.arrayBuffer());
  }

  async signedUrl(kind: ImageKind, id: string, file: string, ttlSeconds = SIGNED_URL_TTL_SECONDS): Promise<string | undefined> {
    const { data, error } = await this.bucket(kind).createSignedUrl(imagePath(this.householdId, kind, id, file), ttlSeconds);
    return error || !data ? undefined : data.signedUrl;
  }

  /** Recipe saved: the temporary page photos are no longer needed (the cover stays). Best effort; the 24h job is the backstop. */
  async finishUpload(id: string, pageCount: number): Promise<void> {
    if (pageCount <= 0) return;
    const paths = Array.from({ length: pageCount }, (_, i) => imagePath(this.householdId, 'page', id, `page-${i + 1}.jpg`));
    const { error } = await this.bucket('page').remove(paths);
    if (error) console.warn('[images] could not delete temporary page photos:', error.message);
  }

  async sweep(): Promise<void> {
    /* expiry is the storage-cleanup job's work (app/api/jobs/storage-cleanup) */
  }
}
