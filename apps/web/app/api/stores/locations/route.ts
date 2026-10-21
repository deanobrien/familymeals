import { NextResponse } from 'next/server';
import { apiError, badRequest, householdFromBody, householdFromUrl, readJsonBody, withApi } from '../../../../lib/server/api/handle';
import { getStoreLocations } from '../../../../lib/server/stores/location-store';
import { applyLocationChange, viewLocations } from '../../../../lib/server/stores/location-service';
import { getStoreBook } from '../../../../lib/server/stores/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET -> { stores, locations }: the household's stores and the location each member saved for them (P2-A, D390).
 * Web (cookie session) and Android (Bearer) call this; the live position is never part of any request here.
 */
export async function GET(req: Request) {
  return withApi(req, { householdId: householdFromUrl(req) }, async (ctx) => {
    const view = await viewLocations(getStoreBook(), getStoreLocations(), ctx.householdId);
    return NextResponse.json({ householdId: ctx.householdId, ...view }, { headers: { 'cache-control': 'private, no-store' } });
  });
}

/** POST JSON { storeId, action: 'set' | 'clear', lat, lng, radiusM?, source: 'device' | 'postcode', postcode?, householdId? }. */
export async function POST(req: Request) {
  const body = await readJsonBody(req);
  if (!body) return badRequest('That request could not be read.');
  return withApi(req, { householdId: householdFromBody(body), write: true }, async (ctx) => {
    const r = await applyLocationChange(getStoreBook(), getStoreLocations(), ctx.householdId, body);
    if (!r.ok) return apiError(r.status, r.code, r.message);
    return NextResponse.json({ ok: true, householdId: ctx.householdId, stores: r.stores, locations: r.locations }, { headers: { 'cache-control': 'private, no-store' } });
  });
}
