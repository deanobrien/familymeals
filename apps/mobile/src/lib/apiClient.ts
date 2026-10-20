/**
 * Minimal bearer-token JSON client for the web app's server routes (D213, D330). The AI key and every piece of business
 * logic (matching, cost, nutrition, exclusions) stay on the server; the app only sends the user's Supabase access token.
 */

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly code?: string,
    /** The parsed JSON body of the failed response, when there was one (validation errors carry their detail here). */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClientOptions {
  baseUrl?: string | undefined;
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}

export interface ApiClient {
  readonly configured: boolean;
  /** Absolute URL for a path on the web app (null when no base URL is configured). */
  url(path: string): string | null;
  get<T>(path: string, query?: Record<string, string | number | undefined | string[]>): Promise<T>;
  /** JSON request; a non-2xx answer throws ApiError unless its status is in `accept` (then the parsed body is returned). */
  send<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, accept?: number[]): Promise<T>;
  /** Auth header for image requests (React Native <Image source={{ uri, headers }}>). */
  authHeaders(): Promise<Record<string, string>>;
}

export function queryString(query: Record<string, string | number | undefined | string[]> = {}): string {
  const p: string[] = [];
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === '') continue;
    for (const one of Array.isArray(v) ? v : [v]) p.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(one))}`);
  }
  return p.length ? `?${p.join('&')}` : '';
}

async function readError(res: Response): Promise<ApiError> {
  let message = `The server could not process this (HTTP ${res.status}).`;
  let code: string | undefined;
  let retryable = res.status >= 500 || res.status === 429;
  let body: unknown;
  try {
    body = await res.json();
    const e = (body as { error?: { code?: string; message?: string; retryable?: boolean } }).error;
    if (e?.message) message = e.message;
    code = e?.code;
    if (typeof e?.retryable === 'boolean') retryable = e.retryable;
  } catch {
    /* non-JSON body */
  }
  if (res.status === 401 || res.status === 403) {
    message = res.status === 401 ? 'The server did not accept your sign-in. Please sign in again.' : message;
  }
  return new ApiError(message, res.status, retryable, code, body);
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const base = opts.baseUrl?.trim().replace(/\/+$/, '') || undefined;
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await opts.getToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function call(path: string, init: RequestInit, accept: number[] = []): Promise<Response> {
    if (!base) throw new ApiError('This feature needs the web app address (EXPO_PUBLIC_API_BASE_URL is empty).', 0, false);
    const headers: Record<string, string> = { Accept: 'application/json', ...(await authHeaders()), ...(init.headers as Record<string, string> | undefined) };
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { ...init, headers });
    } catch {
      throw new ApiError('Could not reach the server. Check your connection and try again.', 0, true);
    }
    if (!res.ok && !accept.includes(res.status)) throw await readError(res);
    return res;
  }

  return {
    configured: !!base,
    url: (path) => (base ? `${base}${path.startsWith('/') ? '' : '/'}${path}` : null),
    authHeaders,
    async get<T>(path: string, query?: Record<string, string | number | undefined | string[]>) {
      const res = await call(`${path}${queryString(query)}`, { method: 'GET' });
      return (await res.json()) as T;
    },
    async send<T>(method: 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, accept: number[] = []) {
      const res = await call(
        path,
        { method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) },
        accept,
      );
      return (await res.json()) as T;
    },
  };
}
