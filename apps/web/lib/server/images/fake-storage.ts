// Test double for the Supabase Storage client slice the ImageStore uses: an in-memory bucket map that records calls.
// Not imported by production code.
import type { StorageBucketLike, StorageClientLike } from './supabase-store';

export interface FakeStorage extends StorageClientLike {
  /** `<bucket>/<path>` -> bytes */
  objects: Map<string, Uint8Array>;
  calls: { op: string; bucket: string; args: unknown[] }[];
  /** Make the next upload fail with this message. */
  failNextUpload?: string;
}

export function fakeStorage(): FakeStorage {
  const fake: FakeStorage = {
    objects: new Map(),
    calls: [],
    storage: {
      from(bucket: string): StorageBucketLike {
        return {
          async upload(path, body, opts) {
            fake.calls.push({ op: 'upload', bucket, args: [path, body.byteLength, opts] });
            if (fake.failNextUpload) {
              const message = fake.failNextUpload;
              fake.failNextUpload = undefined;
              return { error: { message } };
            }
            fake.objects.set(`${bucket}/${path}`, body);
            return { error: null };
          },
          async download(path) {
            fake.calls.push({ op: 'download', bucket, args: [path] });
            const v = fake.objects.get(`${bucket}/${path}`);
            return v ? { data: new Blob([v as BlobPart]), error: null } : { data: null, error: { message: 'Object not found' } };
          },
          async createSignedUrl(path, expiresIn) {
            fake.calls.push({ op: 'sign', bucket, args: [path, expiresIn] });
            return fake.objects.has(`${bucket}/${path}`)
              ? { data: { signedUrl: `http://storage.test/object/sign/${bucket}/${path}?token=t&exp=${expiresIn}` }, error: null }
              : { data: null, error: { message: 'Object not found' } };
          },
          async remove(paths) {
            fake.calls.push({ op: 'remove', bucket, args: [paths] });
            for (const p of paths) fake.objects.delete(`${bucket}/${p}`);
            return { error: null };
          },
        };
      },
    },
  };
  return fake;
}
