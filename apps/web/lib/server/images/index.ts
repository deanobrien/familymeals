import 'server-only';
import type { RequestAuth } from '../auth/request-auth';
import { useSupabaseBackend } from '../supabase/backend';
import { sessionDataContext } from '../supabase/session-context';
import { LocalImageStore } from './local-store';
import { SupabaseImageStore } from './supabase-store';
import type { ImageStore } from './store';

export type { ImageStore } from './store';
export { imageSrc, imagePath, parseImagePath, isStoragePath } from './paths';

let local: ImageStore | undefined;

/** The Supabase image store for the current web session (server actions / pages with no Request). Supabase mode only. */
export async function sessionImageStore(): Promise<ImageStore> {
  const ctx = await sessionDataContext();
  return new SupabaseImageStore(ctx.client, ctx.householdId);
}

/**
 * The image store for an authenticated caller. DATA_BACKEND=supabase -> Supabase Storage through the caller's own client
 * and household (a bearer token from the Android app, or the web session); otherwise the local-file store (dev / mock).
 */
export function imageStoreFor(auth: Pick<RequestAuth, 'dataContext'>): ImageStore {
  const ctx = auth.dataContext;
  if (ctx && useSupabaseBackend()) return new SupabaseImageStore(ctx.client, ctx.householdId);
  return (local ??= new LocalImageStore());
}
