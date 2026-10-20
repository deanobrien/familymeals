import { AiError } from './errors.js';

export type AiOperation =
  | 'extractRecipe' | 'parseReceipt' | 'suggestTags' | 'parsePlanPrompt'
  | 'suggestIngredientMatches' | 'suggestSubstitutions' | 'scanPantry' | 'scanShoppingList' | 'ping';

export interface UsageRecord {
  householdId?: string;
  operation: AiOperation;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  status: 'ok' | 'error';
  errorCode?: string;
  attempts: number;
}

/** Injectable sink (e.g. writes an AiUsage row). Failures are swallowed so tracking never breaks a user flow. */
export interface UsageSink { record(r: UsageRecord): void | Promise<void>; }

/** Per-household limit check. Throw AiError('LIMIT_EXCEEDED') or return false to block. */
export interface LimitChecker {
  check(householdId: string | undefined, operation: AiOperation): void | boolean | Promise<void | boolean>;
}

export const noopSink: UsageSink = { record() {} };
export const allowAllLimits: LimitChecker = { check() { return true; } };

export class MemoryUsageSink implements UsageSink {
  readonly records: UsageRecord[] = [];
  record(r: UsageRecord) { this.records.push(r); }
}

export async function enforceLimit(l: LimitChecker, householdId: string | undefined, op: AiOperation): Promise<void> {
  const r = await l.check(householdId, op);
  if (r === false) throw new AiError('LIMIT_EXCEEDED');
}

export async function safeRecord(s: UsageSink, r: UsageRecord): Promise<void> {
  try { await s.record(r); } catch { /* ignore */ }
}
