import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseImagePath } from '../images/paths';
import type { ImageStore } from '../images/store';
import type { ObjectReader, ObjectRef } from './port';

/**
 * Readers behind the DX1 export port (port.ts). Images are read through ST1's `ImageStore` (D190): the Supabase store
 * uses the signed-in user's client (Storage RLS decides), the local store serves dev / mock `/api/uploads/...` refs.
 * Deletion is NOT here: objects are removed by ST1's queue-driven cleanup (`runStorageCleanup`), which the purge job
 * calls.
 */
export function imageStoreReader(store: ImageStore): ObjectReader {
  return {
    async read(ref: ObjectRef) {
      try {
        if (ref.kind === 'local') {
          const kind = ref.file === 'cover.jpg' ? 'cover' : 'page';
          return (await store.get(kind, ref.uploadId, ref.file)) ?? null;
        }
        const p = parseImagePath(ref.path);
        if (!p || (p.kind === 'receipt' ? 'receipt-images' : 'recipe-images') !== ref.bucket) return null;
        return (await store.get(p.kind, p.id, p.file)) ?? null;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Fallback for in-household storage paths that are not in ST1's `<hh>/<kind>/<id>/<file>` layout (e.g. recipe_images
 * rows written by other tools): a plain download as the caller.
 */
export function supabaseObjectReader(client: SupabaseClient): ObjectReader {
  return {
    async read(ref: ObjectRef) {
      if (ref.kind !== 'storage' || parseImagePath(ref.path)) return null;
      try {
        const { data, error } = await client.storage.from(ref.bucket).download(ref.path);
        if (error || !data) return null;
        return new Uint8Array(await data.arrayBuffer());
      } catch {
        return null;
      }
    },
  };
}

/** First reader that returns bytes wins. */
export function compositeReader(...readers: ObjectReader[]): ObjectReader {
  return {
    async read(ref: ObjectRef) {
      for (const r of readers) {
        const out = await r.read(ref);
        if (out) return out;
      }
      return null;
    },
  };
}
