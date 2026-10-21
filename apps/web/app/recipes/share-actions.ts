'use server';

import { revalidatePath } from 'next/cache';
import { webShareCaller, webShareViewer } from '../../lib/server/sharing/callers';
import { createShare, listShares, previewShare, revokeShare, saveShareCopy } from '../../lib/server/sharing/service';
import type { CreatedShare, SharePreview, ShareResult, ShareSummary } from '../../lib/sharing/types';

/**
 * Shared cookbook (P3-A, D420-D424): thin wrappers over lib/server/sharing, the same module the Android app reaches through
 * /api/shares. The household and user always come from the server-resolved session, never the form.
 */

export async function createShareAction(input: {
  scope: 'recipe' | 'collection';
  recipeIds?: string[];
  collection?: 'favourites' | 'quick' | 'budget' | 'vegetarian';
  title?: string;
  expiresInDays: number | null;
  publicPreview: boolean;
}): Promise<ShareResult<{ share: CreatedShare }>> {
  const r = await createShare(await webShareCaller(), input);
  if (r.ok) revalidatePath('/recipes/shared');
  return r;
}

export async function listSharesAction(): Promise<ShareResult<{ shares: ShareSummary[] }>> {
  return listShares(await webShareCaller());
}

export async function revokeShareAction(shareId: string): Promise<ShareResult> {
  const r = await revokeShare(await webShareCaller(), shareId);
  if (r.ok) revalidatePath('/recipes/shared');
  return r;
}

export async function previewShareAction(token: string): Promise<ShareResult<{ preview: SharePreview }>> {
  return previewShare(await webShareViewer(), token);
}

export async function saveShareCopyAction(token: string, recipeId: string): Promise<ShareResult<{ recipeId: string; title: string; imageCopied: boolean }>> {
  const r = await saveShareCopy(await webShareCaller(), token, recipeId);
  if (r.ok) revalidatePath('/recipes');
  return r;
}
