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
import { imageSrc } from '../images/paths';
import type { ReceiptRepository } from './ports';
import { getPantryService } from '../pantry/deps';
import { ensureDemoReceipts, getMemoryServices } from './memory';
import { PantryServiceReceiptPort } from './pantry-port';
import { ShoppingOutstandingSource, ShoppingPurchaseSink } from './shopping-ports';
import { confirmReceipt, loadReview, processReceiptUpload, ReceiptError, type PipelineDeps } from './pipeline';

/**
 * Production wiring (D34): household + user from the session (getAppContext), AI provider from Settings (else env,
 * else the dev mock). Outstanding items come from the household's shopping list; confirmed lines
 * are recorded on that list and as receipt price observations in the shared price store.
 * With DATA_BACKEND=supabase: receipts/receipt_lines (SupabaseReceiptRepository), purchases through record_purchase on the
 * household's list, prices in ingredient_prices (D123, D124).
 */
function receiptRepository(): ReceiptRepository {
  return useSupabaseBackend() ? createSupabaseReceiptRepository() : getMemoryServices().receipts;
}

export async function getPipelineDeps(): Promise<PipelineDeps> {
  const ctx = await getAppContext();
  const provider = settingsAiProvider; // Settings > AI provider, else env, else the dev mock (D41)
  const catalogue = getIngredientCatalogue();
  const shopping = getShoppingStore();
  return {
    householdId: ctx.householdId,
    userId: ctx.userId,
    prepareImage: async (bytes) => (await prepareImage(bytes)).data,
    parser: { parseReceipt: (image) => provider.parseReceipt(image, { householdId: ctx.householdId }) },
    outstanding: new ShoppingOutstandingSource(shopping, { converter: catalogue.converter }, catalogue.get),
    receipts: receiptRepository(),
    // Extras the shopper adds to the pantry go to the household's pantry service (D103); prices to the household's store.
    purchases: new ShoppingPurchaseSink(ctx.householdId, shopping, getPriceStore(), new PantryServiceReceiptPort(ctx.householdId, getPantryService(ctx.householdId))),
    newId: () => randomUUID(),
    ...(useSupabaseBackend() ? { images: await sessionImageStore() } : {}),
    now: () => new Date(),
  };
}

export async function listReceipts(): Promise<ReceiptListEntry[]> {
  const { householdId } = await getAppContext();
  const receipts = receiptRepository();
  if (!useSupabaseBackend()) await ensureDemoReceipts(receipts, householdId); // demo history in memory mode only
  return receipts.list(householdId);
}

export async function getReview(receiptId: string) {
  const deps = await getPipelineDeps();
  const review = await loadReview(deps, receiptId);
  if (!review) return undefined;
  const receipt = await deps.receipts.get(deps.householdId, receiptId);
  return { review, reconciliation: receipt?.reconciliation, imageName: receipt?.imageName, photoUrl: imageSrc(receipt?.imagePaths?.[0]) };
}

export type UploadResult = { ok: true; receiptId: string } | { ok: false; error: string };

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export async function uploadReceipt(file: File | null): Promise<UploadResult> {
  if (!file || file.size === 0) return { ok: false, error: 'Choose or take a photo of your receipt first.' };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: 'That image is too large. Please use a smaller photo.' };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const record = await processReceiptUpload(await getPipelineDeps(), { bytes, imageName: file.name || undefined });
    return { ok: true, receiptId: record.id };
  } catch (e) {
    if (e instanceof AiError) return { ok: false, error: e.userMessage };
    console.error('receipt upload failed', e instanceof Error ? e.message : 'unknown error'); // never log receipt contents
    return { ok: false, error: 'We could not process that receipt. Please try again.' };
  }
}

export type ConfirmResult =
  | { ok: true; purchases: number; extras: number; pantryAdds: number; leftOutstanding: number }
  | { ok: false; error: string };

export async function confirmReceiptDecisions(receiptId: string, decisions: LineDecision[]): Promise<ConfirmResult> {
  try {
    const s = await confirmReceipt(await getPipelineDeps(), receiptId, decisions);
    return { ok: true, ...s };
  } catch (e) {
    if (e instanceof ReceiptError) return { ok: false, error: e.message };
    console.error('receipt confirm failed', e instanceof Error ? e.message : 'unknown error');
    return { ok: false, error: 'We could not save that. Please try again.' };
  }
}
