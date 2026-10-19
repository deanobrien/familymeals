import { productionConfigProblems } from '../../../lib/server/config/production';

export const dynamic = 'force-dynamic';

/**
 * Liveness/readiness probe for the App Service "Health check" and uptime monitors (D151). Public (see
 * lib/server/auth/routes.ts), read-only, returns no secrets, env values or configuration detail.
 */
export function GET() {
  const configOk = productionConfigProblems().length === 0;
  return Response.json(
    { status: configOk ? 'ok' : 'degraded', version: process.env.APP_VERSION ?? 'dev', commit: process.env.APP_COMMIT ?? null },
    { status: configOk ? 200 : 503, headers: { 'cache-control': 'no-store' } },
  );
}
