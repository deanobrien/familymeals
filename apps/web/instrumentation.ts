/**
 * Runs once when the Next server starts (not during `next build`). Reports unsafe production config (D150) by logging
 * it; it must NEVER throw: a throwing register() makes Next answer every request, /api/health included, with a bare 500.
 * /api/health (503 JSON) and middleware (503 page) surface the same problems.
 * Also starts Application Insights (OpenTelemetry) when APPLICATIONINSIGHTS_CONNECTION_STRING is set; otherwise nothing loads (D355).
 */
export async function register(): Promise<void> {
  try {
    if (process.env.NEXT_RUNTIME !== 'nodejs') return;
    const { allConfigProblems } = await import('./lib/server/config/production');
    const problems = allConfigProblems();
    for (const problem of problems) console.error(`[config] ${problem}`);
    if (problems.length > 0) console.error(`[config] ${problems.length} configuration problem(s): the site answers 503 until fixed. See /api/health.`);
  } catch (err) {
    console.error('[config] startup configuration check failed:', err instanceof Error ? err.message : 'unknown error');
  }
  try {
    if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.APPLICATIONINSIGHTS_CONNECTION_STRING) {
      const { startMonitoring } = await import('./lib/server/monitoring');
      await startMonitoring();
    }
  } catch (err) {
    console.error('[monitoring] startup failed:', err instanceof Error ? err.name : 'unknown error');
  }
}
