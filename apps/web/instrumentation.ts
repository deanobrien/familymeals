/** Runs once when the Next server starts (not during `next build`). Fails fast on unsafe production config (D150). */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { assertProductionConfig } = await import('./lib/server/config/production');
  assertProductionConfig();
}
