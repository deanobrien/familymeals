import 'server-only';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { dataDir } from '../ai/secret';
import { getUploadFiles } from '../uploads/dev-store';
import {
  isUploadId,
  type ObjectReader,
  type ObjectRef,
  type ObjectRemover,
  type RemoveResult,
  type StorageBucket,
} from './port';

/**
 * Concrete stores behind the DX1 storage port (port.ts). Supabase Storage reads use whatever client the caller passes
 * (export: the signed-in user's client, so Storage RLS decides); removals use the service-role client and are only
 * constructed by the purge job.
 */
export function supabaseObjectReader(client: SupabaseClient): ObjectReader {
  return {
    async read(ref: ObjectRef) {
      if (ref.kind !== 'storage') return null;
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

/** Legacy local photo store (`/api/uploads/<id>/<file>`). */
export function localUploadsReader(): ObjectReader {
  return {
    async read(ref: ObjectRef) {
      if (ref.kind !== 'local') return null;
      const data = getUploadFiles().read(ref.uploadId, ref.file);
      return data ? new Uint8Array(data) : null;
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

const BATCH = 100;

export function supabaseBucketRemover(admin: SupabaseClient, bucket: StorageBucket): ObjectRemover {
  return {
    async remove(paths: string[]): Promise<RemoveResult> {
      const out: RemoveResult = { removed: [], failed: [] };
      for (let i = 0; i < paths.length; i += BATCH) {
        const chunk = paths.slice(i, i + BATCH);
        try {
          // Storage answers success for paths that do not exist, so retries are idempotent.
          const { error } = await admin.storage.from(bucket).remove(chunk);
          if (error) for (const p of chunk) out.failed.push({ path: p, error: error.message.slice(0, 200) });
          else out.removed.push(...chunk);
        } catch (e) {
          for (const p of chunk) out.failed.push({ path: p, error: (e as Error).message.slice(0, 200) });
        }
      }
      return out;
    },
  };
}

/** Deletes `<APP_DATA_DIR>/uploads/<uploadId>/` folders (object_path = upload id). */
export function localUploadsRemover(root: string = join(dataDir(), 'uploads')): ObjectRemover {
  return {
    async remove(paths: string[]): Promise<RemoveResult> {
      const out: RemoveResult = { removed: [], failed: [] };
      for (const id of paths) {
        if (!isUploadId(id)) {
          out.failed.push({ path: id, error: 'not an upload id' });
          continue;
        }
        try {
          const dir = join(root, id.toLowerCase());
          if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
          out.removed.push(id);
        } catch (e) {
          out.failed.push({ path: id, error: (e as Error).message.slice(0, 200) });
        }
      }
      return out;
    },
  };
}
