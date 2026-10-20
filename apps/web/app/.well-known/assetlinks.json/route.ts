import { assetLinksStatement, parseFingerprints } from '../../../lib/server/auth/app-links';

export const dynamic = 'force-dynamic';

/** Digital Asset Links for the Android app (P0-A, D323): public, read-only; 404 until ANDROID_APP_CERT_SHA256 is set. */
export function GET() {
  const statement = assetLinksStatement(parseFingerprints(process.env.ANDROID_APP_CERT_SHA256));
  if (!statement) return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
  return Response.json(statement, { headers: { 'cache-control': 'public, max-age=3600' } });
}
