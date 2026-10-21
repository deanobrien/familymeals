import { apiError, bodyHousehold, guarded, isRecord, json, readJson } from '../../../../lib/server/api/bearer-route';
import { desktopStore, errorBody, isScannerPurpose, startSession, statusFor } from '../../../../lib/server/scanner/service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST { householdId?, purpose: 'pantry' | 'receipt' } -> { id, token, expiresAt }: start a "use my phone as the scanner" session
 * (P3-C, D447). The raw token is returned ONCE, to put in the QR code's URL fragment; only its SHA-256 is stored. The session is
 * bound to the signed-in user and household, lasts at most 10 minutes, and replaces any earlier session of this user.
 */
export async function POST(req: Request) {
  const body = await readJson(req);
  return guarded(req, bodyHousehold(body), { write: true }, async (auth) => {
    if (!isRecord(body) || !isScannerPurpose(body.purpose)) return apiError(400, 'BAD_REQUEST', 'Say what the phone is scanning for.');
    const r = await startSession(desktopStore(auth), { householdId: auth.householdId, userId: auth.userId }, body.purpose);
    if (!r.ok) return json(errorBody(r.error), statusFor(r.error));
    return json({ id: r.id, token: r.token, expiresAt: r.expiresAt });
  });
}
