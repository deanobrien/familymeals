import { allConfigProblems } from '../../../lib/server/config/production';

export const dynamic = 'force-dynamic';

/**
 * Liveness/readiness probe for the App Service "Health check" and uptime monitors (D151). Public (see
 * lib/server/auth/routes.ts), read-only. When configuration is invalid it returns 503 with the list of problems
 * (setting names and guidance only, never values) so the owner can see why without the Log stream.
 */
export function GET() {
  let problems: string[];
  try {
    problems = allConfigProblems();
  } catch {
    problems = ['Configuration check failed unexpectedly; see the Log stream.'];
  }
  const headers = { 'cache-control': 'no-store' };
  if (problems.length > 0) return Response.json({ status: 'misconfigured', problems }, { status: 503, headers });
  return Response.json({ status: 'ok', version: process.env.APP_VERSION ?? 'dev', commit: process.env.APP_COMMIT ?? null }, { status: 200, headers });
}
