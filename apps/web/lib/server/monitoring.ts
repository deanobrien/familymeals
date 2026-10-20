/**
 * Application Insights for the Next.js server through OpenTelemetry (P0-D, D355). Opt-in: nothing starts unless
 * APPLICATIONINSIGHTS_CONNECTION_STRING is set, so dev, tests, e2e and any environment without the setting never load the SDK.
 *
 * Privacy: the distro records request metadata (method, route, status, duration, dependency timings) and errors. It never
 * records request or response BODIES or headers/cookies (OpenTelemetry's HTTP instrumentation does not capture them). To keep
 * URLs free of anything sensitive, incoming requests to the auth callback, image-signing and health endpoints are not traced at
 * all, outgoing calls to the Supabase auth endpoint are not traced, and console capture is limited to errors. The connection
 * string is a secret-ish identifier: it is read from the environment only and never logged.
 */

export const MONITORING_ENV = 'APPLICATIONINSIGHTS_CONNECTION_STRING';

/** Incoming paths that are never traced: health probes (noise, every few seconds) and URLs that carry tokens or signed links. */
const SKIP_INCOMING = [/^\/api\/health(\/|$)/, /^\/_next\//, /^\/auth(\/|$)/, /^\/api\/images(\/|$)/, /^\/invite\//];

export function skipIncomingPath(url: string | undefined): boolean {
  const path = (url ?? '').split('?')[0] ?? '';
  return SKIP_INCOMING.some((re) => re.test(path));
}

/** Outgoing calls that are not traced: Supabase auth (emails and tokens travel in these URLs and bodies). */
export function skipOutgoing(path: string | undefined): boolean {
  return /\/auth\/v1\//.test(path ?? '');
}

/** The connection string when monitoring should run, else null (unset or blank). */
export function monitoringConnectionString(env: Record<string, string | undefined> = process.env): string | null {
  const v = env[MONITORING_ENV]?.trim();
  return v ? v : null;
}

/** Never throws: monitoring must not be able to take the site down. Returns whether it started. */
export async function startMonitoring(env: Record<string, string | undefined> = process.env): Promise<boolean> {
  const connectionString = monitoringConnectionString(env);
  if (!connectionString) return false;
  try {
    env.APPLICATIONINSIGHTS_INSTRUMENTATION_LOGGING_LEVEL ??= 'ERROR';
    const { useAzureMonitor } = await import('@azure/monitor-opentelemetry');
    useAzureMonitor({
      azureMonitorExporterOptions: { connectionString },
      samplingRatio: 1,
      enableLiveMetrics: false,
      instrumentationOptions: {
        http: {
          enabled: true,
          ignoreIncomingRequestHook: (req: { url?: string }) => skipIncomingPath(req.url),
          ignoreOutgoingRequestHook: (opts: { path?: string }) => skipOutgoing(opts.path),
        },
        azureSdk: { enabled: false },
        mongoDb: { enabled: false },
        mySql: { enabled: false },
        postgreSql: { enabled: false },
        redis: { enabled: false },
        redis4: { enabled: false },
        bunyan: { enabled: false },
        winston: { enabled: false },
      } as never,
    });
    return true;
  } catch (err) {
    console.error('[monitoring] Application Insights failed to start:', err instanceof Error ? err.name : 'unknown error');
    return false;
  }
}
