/**
 * Image path rules (ST1, D190). Pure and client-safe (no node / server-only imports): components use `imageSrc`.
 *
 * Supabase Storage object path:  `<household_id>/<kind>/<id>/<file>`   (first segment is what the RLS policy checks)
 *   page     recipe-images   <hh>/page/<uploadId>/page-N.jpg       TEMPORARY photo of a recipe page (deleted on save / 24h)
 *   cover    recipe-images   <hh>/cover/<uploadId>/cover.jpg       the recipe's cover; stored on recipes.cover_image_path
 *   receipt  receipt-images  <hh>/receipt/<receiptId>/receipt.jpg  receipts.image_paths
 */
export type ImageKind = 'page' | 'cover' | 'receipt';
export type ImageBucket = 'recipe-images' | 'receipt-images';

export const IMAGE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE_RE: Record<ImageKind, RegExp> = {
  page: /^page-\d{1,2}\.jpg$/,
  cover: /^cover\.jpg$/,
  receipt: /^receipt\.jpg$/,
};
const KINDS: readonly ImageKind[] = ['page', 'cover', 'receipt'];

export const bucketFor = (kind: ImageKind): ImageBucket => (kind === 'receipt' ? 'receipt-images' : 'recipe-images');

export const isImageKind = (v: string): v is ImageKind => (KINDS as readonly string[]).includes(v);

export function isValidImageRef(kind: ImageKind, id: string, file: string): boolean {
  return IMAGE_ID_RE.test(id) && FILE_RE[kind].test(file);
}

export function imagePath(householdId: string, kind: ImageKind, id: string, file: string): string {
  if (!IMAGE_ID_RE.test(householdId) || !isValidImageRef(kind, id, file)) throw new Error('bad image reference');
  return `${householdId.toLowerCase()}/${kind}/${id.toLowerCase()}/${file}`;
}

export interface ParsedImagePath {
  householdId: string;
  kind: ImageKind;
  id: string;
  file: string;
}

/** `<hh>/<kind>/<id>/<file>` -> parts, or null when it is not one of our storage paths. */
export function parseImagePath(path: string): ParsedImagePath | null {
  const [householdId, kind, id, file, ...rest] = path.split('/');
  if (rest.length > 0 || !householdId || !kind || !id || !file) return null;
  if (!IMAGE_ID_RE.test(householdId) || !isImageKind(kind) || !isValidImageRef(kind, id, file)) return null;
  return { householdId: householdId.toLowerCase(), kind, id: id.toLowerCase(), file };
}

export const isStoragePath = (v: string | null | undefined): v is string => !!v && parseImagePath(v) !== null;

/**
 * What to put in `<img src>` for a stored recipe image reference: a storage path becomes the authenticated
 * `/api/images/<path>` route (which hands the browser a short-lived signed URL); anything else (an external https
 * URL, a local-mode `/api/uploads/...` URL, null) is returned unchanged. Never put a raw storage path in `src`.
 */
export function imageSrc(ref: string | null | undefined): string | null {
  if (!ref) return null;
  return isStoragePath(ref) ? `/api/images/${ref}` : ref;
}
