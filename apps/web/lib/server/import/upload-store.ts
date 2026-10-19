import { randomUUID } from 'node:crypto';
import type { RecipeDraft } from '@fr/recipe-import';

export interface UploadOwner {
  userId: string;
  householdId: string;
}

/** Temp store of uploaded page images (and the built draft) so a failed/edited import can be retried or saved. */
export interface UploadRecord {
  id: string;
  images: Uint8Array[];
  title?: string;
  draft?: RecipeDraft;
  /** Who uploaded it (D102): only that user, in that household, can retry or save it. */
  owner?: UploadOwner;
  createdAt: number;
}

const TTL_MS = 60 * 60 * 1000;
const MAX_RECORDS = 50;

const g = globalThis as unknown as { __frUploads?: Map<string, UploadRecord> };
const map = (): Map<string, UploadRecord> => (g.__frUploads ??= new Map());

function sweep(now = Date.now()) {
  const m = map();
  for (const [k, v] of m) if (now - v.createdAt > TTL_MS) m.delete(k);
  while (m.size >= MAX_RECORDS) {
    const oldest = m.keys().next().value;
    if (oldest === undefined) break;
    m.delete(oldest);
  }
}

export function putUpload(images: Uint8Array[], title?: string, owner?: UploadOwner): UploadRecord {
  sweep();
  const rec: UploadRecord = { id: randomUUID(), images, createdAt: Date.now(), ...(owner ? { owner } : {}) };
  if (title !== undefined) rec.title = title;
  map().set(rec.id, rec);
  return rec;
}
export function getUpload(id: string): UploadRecord | undefined {
  sweep();
  return map().get(id);
}
export function deleteUpload(id: string): void {
  map().delete(id);
}
