import 'server-only';
import { randomUUID } from 'node:crypto';
import { AiError, createAiProvider, prepareImage } from '@fr/ai';
import type { LineDecision, ReceiptListEntry } from '../../receipts/types';
import { DEMO_HOUSEHOLD_ID, DEMO_USER_ID, getMemoryServices } from './memory';
import { confirmReceipt, loadReview, processReceiptUpload, ReceiptError, type PipelineDeps } from './pipeline';

/**
 * Production wiring: AI provider from env (AI_PROVIDER=mock by default), in-memory persistence for now.
 * TODO(auth/L1): resolve the household + user from the session and swap the in-memory ports for Supabase.
 */
export function getPipelineDeps(env: Record<string, string | undefined> = process.env): PipelineDeps {
  const mem = getMemoryServices();
  const provider = createAiProvider({ ...env, AI_PROVIDER: env.AI_PROVIDER ?? 'mock' });
  return {
    householdId: DEMO_HOUSEHOLD_ID,
    userId: DEMO_USER_ID,
    prepareImage: async (bytes) => (await prepareImage(bytes)).data,
    parser: { parseReceipt: (image) => provider.parseReceipt(image, { householdId: DEMO_HOUSEHOLD_ID }) },
    outstanding: mem.outstanding,
    receipts: mem.receipts,
    purchases: mem.purchases,
    newId: () => randomUUID(),
    now: () => new Date(),
  };
}

export async function listReceipts(): Promise<ReceiptListEntry[]> {
  return getMemoryServices().receipts.list(DEMO_HOUSEHOLD_ID);
}

export async function getReview(receiptId: string) {
  const deps = getPipelineDeps();
  const review = await loadReview(deps, receiptId);
  if (!review) return undefined;
  const receipt = await deps.receipts.get(deps.householdId, receiptId);
  return { review, reconciliation: receipt?.reconciliation, imageName: receipt?.imageName };
}

export type UploadResult = { ok: true; receiptId: string } | { ok: false; error: string };

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export async function uploadReceipt(file: File | null): Promise<UploadResult> {
  if (!file || file.size === 0) return { ok: false, error: 'Choose or take a photo of your receipt first.' };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: 'That image is too large. Please use a smaller photo.' };
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const record = await processReceiptUpload(getPipelineDeps(), { bytes, imageName: file.name || undefined });
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
    const s = await confirmReceipt(getPipelineDeps(), receiptId, decisions);
    return { ok: true, ...s };
  } catch (e) {
    if (e instanceof ReceiptError) return { ok: false, error: e.message };
    console.error('receipt confirm failed', e instanceof Error ? e.message : 'unknown error');
    return { ok: false, error: 'We could not save that. Please try again.' };
  }
}
