/**
 * Storage abstraction used by data export and the purge job (DX1, D255). Pure types + ref parsing; no I/O here.
 *
 * Images live in one of two places while the move to Supabase Storage (lane ST1) is in flight:
 *  - Supabase Storage: private buckets `recipe-images` / `receipt-images`, object path `<household_id>/...`
 *    (stored in recipe_images.storage_path, recipes.cover_image_path, receipts.image_paths)
 *  - the legacy local photo store: `/api/uploads/<uploadId>/<cover.jpg|page-N.jpg>` (recipe_versions.corrected.imageUrl
 *    / source_image_paths), files under APP_DATA_DIR/uploads/<uploadId>/
 *
 * Export reads through an `ObjectReader`; the purge job deletes through an `ObjectRemover` per bucket. ST1 (or any
 * later storage lane) plugs in by implementing these interfaces; callers never touch a concrete store directly.
 */
export const STORAGE_BUCKETS = ['recipe-images', 'receipt-images'] as const;
export type StorageBucket = (typeof STORAGE_BUCKETS)[number];
/** Pseudo-bucket in storage_cleanup_queue for the legacy local photo store (object_path = upload id). */
export const LOCAL_UPLOADS_BUCKET = 'local-uploads';
export type CleanupBucket = StorageBucket | typeof LOCAL_UPLOADS_BUCKET;

export type ObjectRef =
  | { kind: 'storage'; bucket: StorageBucket; path: string }
  | { kind: 'local'; uploadId: string; file: string };

export interface ObjectReader {
  /** Bytes of the object, or null when it does not exist / is not readable by the caller. Never throws for "missing". */
  read(ref: ObjectRef): Promise<Uint8Array | null>;
}

export interface RemoveResult {
  removed: string[];
  failed: { path: string; error: string }[];
}

export interface ObjectRemover {
  /** Deletes objects by path. Deleting something that does not exist counts as removed (idempotent). */
  remove(paths: string[]): Promise<RemoveResult>;
}

export type ObjectRemovers = Partial<Record<CleanupBucket, ObjectRemover>>;

const UUID = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
const LOCAL_RE = new RegExp(`^/api/uploads/(${UUID})/((?:page-\\d{1,2}|cover)\\.jpg)$`);
const UUID_RE = new RegExp(`^${UUID}$`);
// One safe path segment: no traversal, no separators, no control characters.
const SEGMENT_RE = /^(?!\.{1,2}$)[A-Za-z0-9._-]{1,200}$/;

export function isUploadId(v: string): boolean {
  return UUID_RE.test(v);
}

/** A storage object path is safe when it is `<householdId>/<segment>/.../<segment>` with safe segments only. */
export function isSafeObjectPath(path: string, householdId: string): boolean {
  if (!path.startsWith(`${householdId}/`) || path.length > 1024) return false;
  return path.split('/').every((s) => SEGMENT_RE.test(s));
}

/**
 * Interprets a stored image reference. Returns null for external URLs (e.g. TheMealDB covers: not ours to export or
 * delete) and for anything malformed or outside the household's folder (fail closed).
 */
export function parseObjectRef(value: unknown, householdId: string, bucket: StorageBucket): ObjectRef | null {
  if (typeof value !== 'string' || value === '') return null;
  const local = LOCAL_RE.exec(value);
  if (local) return { kind: 'local', uploadId: local[1]!.toLowerCase(), file: local[2]! };
  if (isSafeObjectPath(value, householdId)) return { kind: 'storage', bucket, path: value };
  return null;
}

export function refKey(ref: ObjectRef): string {
  return ref.kind === 'local' ? `local:${ref.uploadId}/${ref.file}` : `${ref.bucket}:${ref.path}`;
}

/** Path inside the export archive. Storage paths drop the household prefix (every file is from that household). */
export function archivePathFor(ref: ObjectRef, householdId: string): string {
  if (ref.kind === 'local') return `images/uploads/${ref.uploadId}/${ref.file}`;
  return `images/${ref.bucket}/${ref.path.slice(householdId.length + 1)}`;
}
