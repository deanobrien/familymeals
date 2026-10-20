/**
 * Generic client for the web app's JSON API (apps/web `/api/plan`, `/api/pantry`, `/api/receipts`, `/api/shopping/...`,
 * D340). The server logic stays on the server: the app sends the user's Supabase access token as a Bearer header plus the
 * household id, and gets view models back. Same envelope as `/api/extract`: errors are
 * `{ error: { code, message, retryable } }` (extra fields such as `violations` are kept in `details`).
 */

export class ServerApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly code?: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ServerApiError';
  }
}

export type Query = Record<string, string | number | boolean | undefined | null>;

export interface ServerApi {
  /** False when EXPO_PUBLIC_API_BASE_URL is empty (mock mode): screens show "needs the server" instead of failing. */
  readonly configured: boolean;
  get<T>(path: string, query?: Query): Promise<T>;
  post<T>(path: string, body: unknown): Promise<T>;
  /** Multipart upload; no Content-Type header so React Native sets the boundary itself. */
  postForm<T>(path: string, form: FormData): Promise<T>;
  /** Absolute web URL, for "open on web" links and authenticated photo URLs (null when no base URL). */
  webUrl(path: string): string | null;
  /** The Bearer header for an authenticated image/file request (e.g. a receipt photo), or null when signed out. */
  authHeaders(): Promise<Record<string, string>>;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function queryString(q?: Query): string {
  if (!q) return '';
  const parts = Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

async function readError(res: Response): Promise<ServerApiError> {
  let message = `The server could not process this (HTTP ${res.status}).`;
  let code: string | undefined;
  let retryable = res.status >= 500 || res.status === 429;
  let details: Record<string, unknown> | undefined;
  try {
    const body: unknown = await res.json();
    if (isObj(body)) {
      details = body;
      const e = body.error;
      if (isObj(e)) {
        if (typeof e.message === 'string') message = e.message;
        if (typeof e.code === 'string') code = e.code;
        if (typeof e.retryable === 'boolean') retryable = e.retryable;
      }
    }
  } catch {
    /* non-JSON body */
  }
  if (res.status === 401 || res.status === 403) {
    if (code !== 'READ_ONLY') message = 'The server did not accept your sign-in. Sign in again, or use the web app.';
  }
  return new ServerApiError(message, res.status, retryable, code, details);
}

export function createServerApi(opts: {
  baseUrl?: string | undefined;
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}): ServerApi {
  const base = opts.baseUrl?.trim().replace(/\/+$/, '') || undefined;
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await opts.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function call<T>(path: string, init: RequestInit): Promise<T> {
    if (!base) throw new ServerApiError('This needs the Family Recipes server (EXPO_PUBLIC_API_BASE_URL is empty).', 0, false, 'NOT_CONFIGURED');
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined), ...(await authHeaders()) };
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { ...init, headers });
    } catch {
      throw new ServerApiError('Could not reach the server. Check your connection and try again.', 0, true, 'NETWORK');
    }
    if (!res.ok) throw await readError(res);
    try {
      return (await res.json()) as T;
    } catch {
      throw new ServerApiError('The server returned an unexpected response.', res.status, false, 'BAD_RESPONSE');
    }
  }

  return {
    configured: !!base,
    webUrl: (path) => (base ? `${base}${path.startsWith('/') ? '' : '/'}${path}` : null),
    authHeaders,
    get: (path, query) => call(`${path}${queryString(query)}`, { method: 'GET' }),
    post: (path, body) => call(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    postForm: (path, form) => call(path, { method: 'POST', body: form }),
  };
}
