// One place for "what a money write does" so the web server actions and the Android JSON routes cannot drift (D340 pattern).
import 'server-only';
import { parseSpendInput } from '../../money/types';
import { getPriceService, getSpendingService } from './deps';
import { MoneyError } from './repository';

export type HandlerResult = { ok: true; [k: string]: unknown } | { ok: false; error: string; status: number };

const bad = (error: string, status = 400): HandlerResult => ({ ok: false, error, status });
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

async function guard(fn: () => Promise<HandlerResult>): Promise<HandlerResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof MoneyError || (e instanceof Error && e.name === 'MoneyError')) return bad(e.message, (e as MoneyError).code === 'not_found' ? 404 : 422);
    throw e;
  }
}

/** POST body of /api/money/spending: { action: 'add' | 'update' | 'delete' | 'link', ... }. */
export function runSpendingAction(householdId: string, body: Record<string, unknown>): Promise<HandlerResult> {
  return guard(async () => {
    const svc = getSpendingService();
    switch (body.action) {
      case 'add': {
        const p = parseSpendInput(body);
        if (!p.ok) return bad(p.error);
        return { ok: true, entry: await svc.addSpend(householdId, p.value) };
      }
      case 'update': {
        const id = str(body.id);
        const p = parseSpendInput(body);
        if (!id) return bad('Missing entry id.');
        if (!p.ok) return bad(p.error);
        return { ok: true, entry: await svc.updateSpend(householdId, id, p.value) };
      }
      case 'delete': {
        const id = str(body.id);
        if (!id) return bad('Missing entry id.');
        await svc.deleteSpend(householdId, id);
        return { ok: true };
      }
      case 'link': {
        const retailer = str(body.retailer)?.trim();
        const storeId = body.storeId === null ? null : str(body.storeId);
        if (!retailer || storeId === undefined) return bad('Choose a retailer and a store.');
        await svc.linkRetailer(householdId, retailer, storeId);
        return { ok: true };
      }
      default:
        return bad('Unknown action.');
    }
  });
}

/** POST body of /api/money/prices: { action: 'add', ingredientId, storeId | retailer, pricePence, packValue, packUnit, observedOn? }. */
export function runPriceAction(householdId: string, body: Record<string, unknown>): Promise<HandlerResult> {
  return guard(async () => {
    if (body.action !== 'add') return bad('Unknown action.');
    const ingredientId = str(body.ingredientId);
    if (!ingredientId) return bad('Choose an ingredient.');
    const r = await getPriceService().addPrice(householdId, {
      ingredientId, storeId: str(body.storeId) ?? null, retailer: str(body.retailer) ?? null,
      pricePence: typeof body.pricePence === 'number' ? body.pricePence : Number.NaN,
      packValue: typeof body.packValue === 'number' ? body.packValue : Number.NaN,
      packUnit: str(body.packUnit) ?? '', ...(str(body.observedOn) ? { observedOn: str(body.observedOn)! } : {}),
    });
    return r.ok ? { ok: true } : bad(r.error, 422);
  });
}
