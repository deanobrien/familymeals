'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import {
  confirmReceiptDecisions,
  uploadReceipt,
  type ConfirmResult,
} from '../../lib/server/receipts/service';
import type { LineDecision } from '../../lib/receipts/types';

export interface UploadState {
  error?: string;
}

/** Upload a receipt photo, run parse + match, then go to the review screen. Server-only; mock AI by default. */
export async function uploadReceiptAction(_prev: UploadState, formData: FormData): Promise<UploadState> {
  const file = formData.get('receipt');
  const result = await uploadReceipt(file instanceof File ? file : null);
  if (!result.ok) return { error: result.error };
  revalidatePath('/receipts');
  redirect(`/receipts/${result.receiptId}/review`);
}

/** Confirm the lines the user explicitly confirmed. Returns a result; the client refreshes into the summary. */
export async function confirmReceiptAction(receiptId: string, decisions: LineDecision[]): Promise<ConfirmResult> {
  const result = await confirmReceiptDecisions(receiptId, decisions);
  if (result.ok) {
    revalidatePath('/receipts');
    revalidatePath(`/receipts/${receiptId}/review`);
  }
  return result;
}
