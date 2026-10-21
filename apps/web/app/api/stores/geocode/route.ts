import { NextResponse } from 'next/server';
import { apiError, householdFromUrl, withApi } from '../../../../lib/server/api/handle';
import { createLimiter, lookupPostcode } from '../../../../lib/server/stores/geocode';
import { POSTCODES_IO_ATTRIBUTION } from '../../../../lib/stores/locations';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const allow = createLimiter(20, 5 * 60 * 1000);

/**
 * GET ?postcode=NE1 7RU -> { postcode, lat, lng, area, attribution } (P2-A, D391). Signed-in members only; the lookup is
 * done by the server (postcodes.io, no key) and only the postcode is sent to it. Nothing is stored here: the member
 * saves the result as a store's location through /api/stores/locations.
 */
export async function GET(req: Request) {
  return withApi(req, { householdId: householdFromUrl(req) }, async (ctx) => {
    if (!allow(ctx.userId)) return apiError(429, 'RATE_LIMITED', 'Too many postcode lookups. Wait a few minutes and try again.', {}, true);
    const r = await lookupPostcode(new URL(req.url).searchParams.get('postcode') ?? '');
    if (r.ok) {
      return NextResponse.json(
        { postcode: r.postcode, lat: r.lat, lng: r.lng, area: r.area, attribution: POSTCODES_IO_ATTRIBUTION },
        { headers: { 'cache-control': 'private, no-store' } },
      );
    }
    if (r.reason === 'invalid') return apiError(400, 'BAD_POSTCODE', 'That does not look like a UK postcode. Try something like NE1 7RU.');
    if (r.reason === 'not_found') return apiError(404, 'NOT_FOUND', 'That postcode was not found.');
    return apiError(503, 'UNAVAILABLE', 'The postcode lookup is not available right now. Use your current location instead, or try again later.', {}, true);
  });
}
