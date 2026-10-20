import 'server-only';
import { randomUUID } from 'node:crypto';
import { AiError, prepareImage } from '@fr/ai';
import { settingsAiProvider } from '../ai/provider';
import type { LineDecision, ReceiptListEntry } from '../../receipts/types';
import { getAppContext } from '../context';
import { getPriceStore } from '../prices/store';
import { getIngredientCatalogue } from '../refdata/catalogue';
import { getShoppingStore } from '../shopping/store';
import { createSupabaseReceiptRepository, useSupabaseBackend } from '../supabase/backend';
import { sessionImageStore } from '../images';
import type { ImageStore } from '../images/store';
import { imageSrc, parseImagePath } from '../images/paths';
import type { ReceiptRepository } from './ports';
import { getPantryService } from '../pantry/deps';
import { ensureDemoReceipts, getMemoryServices } from './memory';
import { PantryServiceReceiptPort } from './pantry-port';
import { autoRestockAfterPantryChange } from '../restock/deps';
import { ShoppingOutstandingSource, ShoppingPurchaseSink } from './shopping-ports';
import { confirmReceipt, loadReview, processReceiptUpload, ReceiptError, type PipelineDeps } from './pipeline';

/**
 * Production wiring (D34): household + user from the session (getAppContext), AI provider from Settings (else env,
 * else the dev mock). Outstanding items come from the household's shopping list; confirmed lines
 * are recorded on that list and as receipt price observations in the shared price store.
 * With DATA_BACKEND=supabase: receipts/receipt_lines (SupabaseReceiptRepository), purchases through record_purchase on the
 * household's list, prices in ingredient_prices (D123, D124).
 *
 * Every entry point takes an optional PipelineIdentity (D345): the JSON API for the Android app passes the caller it has
 * already verified (withApi), the web server actions pass nothing and get the cookie session.
 */
function receiptRepository(): ReceiptRepository {
  return useSupabaseBackend() ? createSupabaseReceiptRepository() : getMemoryServices().receipts;
}

/** An explicit, already-verified caller: a household withApi narrowed to a real membership, plus the caller's own image store. */
export interface PipelineIdentity {
  householdId: string;
  userId: string;
  images?: ImageStore;
}

async function resolveIdentity(identity?: PipelineIdentity): Promise<PipelineIdentity> {
  if (identity) return identity;
  const ctx = await getAppContext();
  return { householdId: ctx.householdId, userId: ctx.userId, ...(useSupabaseBackend() ? { images: await sessionImageStore() } : {}) };
}

export async function getPipelineDeps(identity?: PipelineIdentity): Promise<PipelineDeps> {
  const ctx = await resolveIdentity(identity);
  const provider = settingsAiProvider; // Settings > AI provider, else env, else the dev mock (D41)
  const catalogue = getIngredientCatalogue();
  const shopping = getShoppingStore();
  return {
    householdId: ctx.householdId,
    userId: ctx.userId,
    prepareImage: async (bytes) => (await prepareImage(bytes)).data,
    parser: { parseReceipt: (image) => provider.parseReceipt(image, { householdId: ctx.householdId }) },
    outstanding: new ShoppingOutstandingSource(shopping, { converter: catalogue.converter }, catalogue.get, (name) => {
      const m = catalogue.matcher.match(name);
      return m.status === 'matched' ? m.ingredientId : undefined;
    }),
    receipts: receiptRepository(),
    // Extras the shopper adds to the pantry go to the household's pantry service (D103); prices to the household's store.
    purchases: new ShoppingPurchaseSink(ctx.householdId, shopping, getPriceStore(), new PantryServiceReceiptPort(ctx.householdId, getPantryService(ctx.householdId), () => autoRestockAfterPantryChange(ctx.householdId, ctx.userId))),
    newId: () => randomUUID(),
    ...(ctx.images ? { images: ctx.images } : {}),
    now: () => new Date(),
  };
}

export async function listReceipts(identity?: PipelineIdentity): Promise<ReceiptListEntry[]> {
  const { householdId } = await resolveIdentity(identity);
  const receipts = receiptRepository();
  if (!useSupabaseBackend()) await ensureDemoReceipts(receipts, householdId); // demo history in memory mode only
  return receipts.list(householdId);
}

export async function getReview(receiptId: string, identity?: PipelineIdentity) {
  const deps = await getPipelineDeps(identity);
  const review = await loadReview(deps, receiptId);
  if (!review) return undefined;
  const receipt = await deps.receipts.get(deps.householdId, receiptId);
  return {
    review,
    reconciliation: receipt?.reconciliation,
    imageName: receipt?.imageName,
    photoUrl: imageSrc(receipt?.imagePaths?.[0]),
    hasPhoto: !!parseImagePath(receipt?.imagePaths?.[0] ?? ''),
  };
}

/**
 * The kept photo of the caller's own receipt: bytes + content type, or undefined when the receipt is unknown / not theirs
 * / has no kept photo (local mode never keeps one). Read through the caller's own image store.
 */
export async function getReceiptPhoto(receiptId: string, identity: PipelineIdentity): Promise<{ bytes: Uint8Array; contentType: string } | undefined> {
  const receipt = await receiptRepository().get(identity.householdId, receiptId);
  const parsed = parseImagePath(receipt?.imagePaths?.[0] ?? '');
  if (!receipt || !parsed || parsed.kind !== 'receipt' || parsed.householdId !== identity.householdId.toLowerCase() || !identity.images) return undefined;
  const bytes = await identity.images.get('receipt', parsed.id, parsed.file);
  return bytes ? { bytes, contentType: 'image/jpeg' } : undefined; // prepareImage always re-encodes to JPEG
}

export type UploadResult = { ok: true; receiptId: string } | { ok: false; error: string; status?: number; retryable?: boolean };

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export async function uploadReceipt(file: File | null, identity?: PipelineIdentity): Promise<UploadResult> {
  if (!file || file.size === 0) return { ok: false, error: 'Choose or take a photo of your receipt first.', status: 400 };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: 'That image is too large. Please use a smaller photo.', status: 413 };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const record = await processReceiptUpload(await getPipelineDeps(identity), { bytes, imageName: file.name || undefined });
    return { ok: true, receiptId: record.id };
  } catch (e) {
    if (e instanceof AiError) return { ok: false, error: e.userMessage, status: 422, retryable: e.retryable };
    console.error('receipt upload failed', e instanceof Error ? e.message : 'unknown error'); // never log receipt contents
    return { ok: false, error: 'We could not process that receipt. Please try again.', status: 500, retryable: true };
  }
}

export type ConfirmResult =
  | { ok: true; purchases: number; extras: number; pantryAdds: number; leftOutstanding: number }
  | { ok: false; error: string; code?: ReceiptError['code'] };

export async function confirmReceiptDecisions(receiptId: string, decisions: LineDecision[], identity?: PipelineIdentity): Promise<ConfirmResult> {
  try {
    const s = await confirmReceipt(await getPipelineDeps(identity), receiptId, decisions);
    return { ok: true, ...s };
  } catch (e) {
    if (e instanceof ReceiptError) return { ok: false, error: e.message, code: e.code };
    console.error('receipt confirm failed', e instanceof Error ? e.message : 'unknown error');
    return { ok: false, error: 'We could not save that. Please try again.' };
  }
}
