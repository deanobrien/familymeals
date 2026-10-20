/**
 * Client for the web app's data-export endpoints (DX1, D250; Bearer support added by P0-A, D322):
 *   POST /api/export  { scope: 'member' | 'household', householdId }  ->  201 { id, downloadUrl, expiresAt }
 *   GET  /api/export/<id>                                              ->  application/zip (streamed)
 * Both carry `Authorization: Bearer <supabase access token>`. The download link works for 1 hour, only for the same user,
 * at most 5 times; one export per scope per 24 hours. The token is never logged and never put in a URL.
 */
export type ExportScope = 'member' | 'household';

export type ExportErrorCode = 'unconfigured' | 'unauthenticated' | 'forbidden' | 'rate_limited' | 'network' | 'unknown';

export class ExportError extends Error {
  constructor(
    readonly code: ExportErrorCode,
    message: string,
    /** ISO time the next export of this kind is allowed (rate_limited only) */
    readonly retryAfter?: string,
  ) {
    super(message);
    this.name = 'ExportError';
  }
}

export interface ExportTicket {
  id: string;
  /** Absolute URL of the zip (GET with the same Bearer token). */
  downloadUrl: string;
  expiresAt: string;
}

export interface ExportClient {
  readonly configured: boolean;
  start(scope: ExportScope, householdId: string): Promise<ExportTicket>;
}

const DOWNLOAD_PATH_RE = /^\/api\/export\/[0-9a-f-]{8,64}$/i;

export function createExportClient(opts: {
  baseUrl?: string | undefined;
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}): ExportClient {
  const base = opts.baseUrl?.trim().replace(/\/+$/, '') || undefined;
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  return {
    configured: !!base,
    async start(scope, householdId) {
      if (!base) throw new ExportError('unconfigured', 'Export is not set up on this build (EXPO_PUBLIC_API_BASE_URL is empty).');
      const token = await opts.getToken();
      if (!token) throw new ExportError('unauthenticated', 'Please sign in again to export your data.');
      let res: Response;
      try {
        res = await doFetch(`${base}/api/export`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ scope, householdId }),
        });
      } catch {
        throw new ExportError('network', 'Could not reach the server. Check your connection and try again.');
      }
      const body = (await res.json().catch(() => ({}))) as { id?: unknown; downloadUrl?: unknown; expiresAt?: unknown; retryAfter?: unknown };
      if (res.status === 201 && typeof body.id === 'string' && typeof body.downloadUrl === 'string' && typeof body.expiresAt === 'string') {
        // Only ever follow a download path on OUR server: the bearer token must not be sent anywhere a response points.
        if (!DOWNLOAD_PATH_RE.test(body.downloadUrl)) throw new ExportError('unknown', 'The server returned an unexpected response.');
        return { id: body.id, downloadUrl: `${base}${body.downloadUrl}`, expiresAt: body.expiresAt };
      }
      if (res.status === 429) {
        throw new ExportError(
          'rate_limited',
          'You can request one export every 24 hours.',
          typeof body.retryAfter === 'string' ? body.retryAfter : undefined,
        );
      }
      if (res.status === 403) throw new ExportError('forbidden', 'Only an owner can export the whole household.');
      if (res.status === 401) throw new ExportError('unauthenticated', 'The server did not accept your sign-in. Please sign in again.');
      throw new ExportError('unknown', 'The export could not be started. Please try again.');
    },
  };
}
