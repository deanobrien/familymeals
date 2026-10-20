import { NextResponse } from 'next/server';
import { getPantryService } from '../../../lib/server/pantry/deps';
import type { AddItemInput, CorrectItemInput, LeftoverInput } from '../../../lib/server/pantry/service';
import type { ActionResult, PantrySettings } from '../../../lib/pantry/types';
import type { RestockResult, SetParInput } from '../../../lib/restock/types';
import { autoRestockAfterPantryChange, getRestockService } from '../../../lib/server/restock/deps';
import { apiError, badRequest, householdFromBody, householdFromUrl, readJsonBody, withApi, type ApiBody } from '../../../lib/server/api/handle';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET ?householdId=: the pantry view (stock by category, stale, expiring, "use what I have", pending purchases, leftovers). Read-only. */
export async function GET(req: Request) {
  return withApi(req, { householdId: householdFromUrl(req) }, async (ctx) => {
    // PR1 (D280-D289): `?part=restock` = minimums + running-low view; `?part=banner` = the below-minimum banner (shopping screen).
    const part = new URL(req.url).searchParams.get('part');
    if (part === 'restock') return NextResponse.json({ restock: await getRestockService(ctx.householdId).getView(ctx.householdId) });
    if (part === 'banner') return NextResponse.json({ banner: await getRestockService(ctx.householdId).getBanner(ctx.householdId) });
    const view = await getPantryService(ctx.householdId).getView(ctx.householdId);
    return NextResponse.json({ view });
  });
}

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const num = (v: unknown): number => (typeof v === 'number' ? v : Number.NaN);

/** Same messages the web server actions return, so both clients read identically. */
const failure = (error: string): ActionResult => ({ ok: false, error });
const refused = (message: string) => apiError(422, 'REFUSED', message);
const asResponse = (res: ActionResult) => (res.ok ? NextResponse.json(res) : refused(res.error));

function addInput(b: ApiBody): AddItemInput {
  const name = str(b.name);
  const ingredientId = str(b.ingredientId);
  const expiry = str(b.expiry);
  return {
    value: num(b.value), unit: str(b.unit) ?? '',
    ...(name !== undefined ? { name } : {}), ...(ingredientId ? { ingredientId } : {}), ...(expiry ? { expiry } : {}),
  };
}

function leftoverInput(b: ApiBody): LeftoverInput {
  return {
    title: str(b.title) ?? '', portionsCooked: num(b.portionsCooked), portionsEaten: num(b.portionsEaten),
    ...(typeof b.keepDays === 'number' && b.keepDays > 0 ? { keepDays: b.keepDays } : {}),
    ...(b.freezable === true ? { freezable: true } : {}),
  };
}

/**
 * POST { action, householdId, ... }. Actions (the same service methods as lib/server/pantry/actions.ts):
 * add, correct, confirm, remove, settings, acceptAdjustment, dismissAdjustment (ActionResult), leftovers (returns { ok, plan }).
 * A refused action answers 422 with the shared `{ error: { code: 'REFUSED', message } }` envelope (message = the web action's text).
 */
export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body) return badRequest('Send a JSON object.');
  const action = str(body.action);
  return withApi(req, { householdId: householdFromBody(body), write: true }, async (ctx) => {
    const hh = ctx.householdId;
    const svc = getPantryService(hh);
    /** A pantry write succeeded: let auto-add restock catch up (no-op unless the household turned it on; never throws). */
    const respond = async (res: ActionResult) => {
      if (res.ok) await autoRestockAfterPantryChange(hh, ctx.userId);
      return asResponse(res);
    };
    const restock = getRestockService(hh);
    const restockRes = (res: RestockResult) => (res.ok ? NextResponse.json(res) : refused(res.error));
    const id = str(body.id);
    const eventId = str(body.eventId);
    switch (action) {
      case 'add':
        return respond(await svc.addItem(hh, addInput(body)));
      case 'correct': {
        if (!id) return badRequest('Missing id.');
        const expiry = body.expiry === null ? null : str(body.expiry);
        const input: CorrectItemInput = { id, value: num(body.value), unit: str(body.unit) ?? '', ...(expiry !== undefined ? { expiry } : {}) };
        return respond(await svc.correctItem(hh, input));
      }
      case 'confirm':
        return id ? respond(await svc.confirmItem(hh, id)) : badRequest('Missing id.');
      case 'remove':
        return id ? respond(await svc.removeItem(hh, id)) : badRequest('Missing id.');
      case 'settings': {
        const mode = str(body.purchaseMode);
        if (!mode) return asResponse(failure('Choose off, suggest or auto.'));
        return respond(await svc.updateSettings(hh, { purchaseMode: mode as PantrySettings['purchaseMode'], staleAfterDays: num(body.staleAfterDays) }));
      }
      case 'acceptAdjustment':
        return eventId ? respond(await svc.acceptAdjustment(hh, eventId, str(body.expiry) || undefined)) : badRequest('Missing eventId.');
      case 'dismissAdjustment':
        return eventId ? respond(await svc.dismissAdjustment(hh, eventId)) : badRequest('Missing eventId.');
      // ---- PR1 minimum stock: the same service methods as lib/server/restock/actions.ts ----
      case 'setMinimum': {
        const ingredientId = str(body.ingredientId);
        const name = str(body.name);
        const nullableNum = (v: unknown): number | null | undefined => (v === null ? null : typeof v === 'number' ? v : undefined);
        const input: SetParInput = {
          unit: str(body.unit) ?? '', min: num(body.min),
          ...(ingredientId ? { ingredientId } : {}), ...(name !== undefined ? { name } : {}),
          ...(nullableNum(body.restockTo) !== undefined ? { restockTo: nullableNum(body.restockTo) as number | null } : {}),
          ...(nullableNum(body.packValue) !== undefined ? { packValue: nullableNum(body.packValue) as number | null } : {}),
          ...(body.packUnit === null || typeof body.packUnit === 'string' ? { packUnit: body.packUnit as string | null } : {}),
          ...(typeof body.enabled === 'boolean' ? { enabled: body.enabled } : {}),
        };
        return restockRes(await restock.setPar(hh, input));
      }
      case 'removeMinimum':
        return id ? restockRes(await restock.removePar(hh, id)) : badRequest('Missing id.');
      case 'snoozeRestock':
        return id ? restockRes(await restock.snooze(hh, id, typeof body.days === 'number' ? body.days : undefined)) : badRequest('Missing id.');
      case 'addRestock': {
        const ids = Array.isArray(body.parIds) ? body.parIds.filter((x): x is string => typeof x === 'string').slice(0, 300) : undefined;
        return restockRes(await restock.addToList(hh, ctx.userId, ids));
      }
      case 'restockSettings':
        if (typeof body.autoAdd !== 'boolean') return badRequest('Missing autoAdd.');
        return restockRes(await restock.updateSettings(hh, { autoAdd: body.autoAdd }));
      case 'leftovers': {
        const res = await svc.planLeftovers(hh, leftoverInput(body));
        return res.ok ? NextResponse.json(res) : refused(res.error);
      }
      default:
        return badRequest('Unknown action.');
    }
  });
}
