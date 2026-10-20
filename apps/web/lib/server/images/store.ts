import type { ImageKind } from './paths';

/**
 * Where uploaded images live (ST1, D190). Two implementations: local files (dev / mock, `DATA_BACKEND` != supabase) and
 * Supabase Storage (`DATA_BACKEND=supabase`: the caller's own user-scoped client, private buckets, RLS by household
 * folder). Buckets are never public: browsers only ever see short-lived signed URLs.
 */
export interface ImageStore {
  readonly backend: 'local' | 'supabase';
  /** Store one image. Returns the reference to persist: a storage path (supabase) or a local `/api/uploads/...` URL. */
  put(kind: ImageKind, id: string, file: string, data: Uint8Array): Promise<string>;
  /** Bytes, or undefined when absent / not visible to the caller. */
  get(kind: ImageKind, id: string, file: string): Promise<Uint8Array | undefined>;
  /** A URL a browser can load for this image (signed + expiring in supabase mode), or undefined when absent. */
  signedUrl(kind: ImageKind, id: string, file: string, ttlSeconds?: number): Promise<string | undefined>;
  /** The recipe import finished (saved): supabase deletes the temporary page photos; local marks the folder saved. */
  finishUpload(id: string, pageCount: number): Promise<void>;
  /** Drop expired unsaved uploads (local only; supabase uses the cleanup job). */
  sweep(): Promise<void>;
}

/** Signed URL lifetime: long enough to render a page, short enough that a leaked URL is not a standing link. */
export const SIGNED_URL_TTL_SECONDS = 300;
