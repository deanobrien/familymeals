import { buildExtractionForm, type UploadImage } from './extraction';

/**
 * Client for the web app's recipe-import endpoints (apps/web/app/api/extract and /save). The AI provider key
 * stays on the server; the app only ever sends photos and the user's Supabase access token.
 *
 * Server side (DECISIONS D102, done): the routes accept `Authorization: Bearer <supabase access token>`, verify it with
 * supabase.auth.getUser(token), check the user is an active member of the multipart `householdId`, and save through
 * the caller's own RecipeSink (the Supabase repository when DATA_BACKEND=supabase). The save call needs no household:
 * the upload remembers who made it.
 */

export class ImportApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ImportApiError';
  }
}

export interface ReviewIngredient {
  text: string;
  /** Low confidence / unparsed quantity / unmatched: the cook should check this line. */
  needsCheck: boolean;
}

export interface ReviewIssue {
  message: string;
  blocking: boolean;
}

/** Read-only summary of the server's RecipeDraft. The full draft is kept opaque and sent back unchanged on save. */
export interface DraftSummary {
  title: string;
  servings?: number;
  ingredients: ReviewIngredient[];
  steps: string[];
  issues: ReviewIssue[];
  warnings: string[];
}

export interface ExtractionOutcome {
  uploadId: string;
  draft: unknown;
  summary: DraftSummary;
  /** Recipes already in the library that look like this one. */
  existing: Array<{ id: string; title: string }>;
}

export interface ImportClient {
  readonly configured: boolean;
  extract(householdId: string, images: UploadImage[]): Promise<ExtractionOutcome>;
  save(outcome: ExtractionOutcome): Promise<{ id: string }>;
  /** Absolute web URL for "finish on web" / "open on web" links (null when no base URL is configured). */
  webUrl(path: string): string | null;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const field = (v: unknown): Obj | undefined => (isObj(v) ? v : undefined);
const fieldValue = (v: unknown): unknown => (isObj(v) && 'value' in v ? v.value : undefined);

/** Defensive: the draft shape belongs to @fr/recipe-import and may grow; unknown parts are simply not shown. */
export function summariseDraft(draft: unknown): DraftSummary {
  const d: Obj = isObj(draft) ? draft : {};
  const title = fieldValue(d.title);
  const servings = fieldValue(d.servings);
  const ingredients = (Array.isArray(d.ingredients) ? d.ingredients : []).filter(isObj).map((i) => {
    const name = fieldValue(i.name);
    const status = [field(i.name)?.status, field(i.quantity)?.status];
    return {
      text: typeof i.originalText === 'string' && i.originalText ? i.originalText : typeof name === 'string' ? name : '(unreadable line)',
      needsCheck: status.some((s) => typeof s === 'string' && s !== 'ok'),
    };
  });
  const steps = (Array.isArray(d.steps) ? d.steps : [])
    .filter(isObj)
    .map((s) => (typeof s.text === 'string' ? s.text : ''))
    .filter(Boolean);
  const issues = (Array.isArray(d.issues) ? d.issues : [])
    .filter(isObj)
    .map((i) => ({ message: typeof i.message === 'string' ? i.message : 'Needs attention', blocking: i.blocking === true }));
  const warnings = (Array.isArray(d.warnings) ? d.warnings : []).filter((w): w is string => typeof w === 'string');
  return {
    title: typeof title === 'string' && title ? title : 'Untitled recipe',
    ...(typeof servings === 'number' ? { servings } : {}),
    ingredients,
    steps,
    issues,
    warnings,
  };
}

async function readError(res: Response): Promise<ImportApiError> {
  let message = `The server could not process this (HTTP ${res.status}).`;
  let code: string | undefined;
  let retryable = res.status >= 500 || res.status === 429;
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string; retryable?: boolean } };
    if (body.error?.message) message = body.error.message;
    code = body.error?.code;
    if (typeof body.error?.retryable === 'boolean') retryable = body.error.retryable;
  } catch {
    /* non-JSON body */
  }
  if (res.status === 401 || res.status === 403) {
    message = 'The server did not accept your sign-in for recipe import. Finish this recipe on the web app instead.';
  }
  return new ImportApiError(message, res.status, retryable, code);
}

export function createImportClient(opts: {
  baseUrl?: string | undefined;
  getToken: () => Promise<string | null>;
  fetchImpl?: typeof fetch;
}): ImportClient {
  const base = opts.baseUrl?.trim().replace(/\/+$/, '') || undefined;
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));

  async function call(path: string, init: RequestInit): Promise<Response> {
    if (!base) throw new ImportApiError('Recipe import is not set up (EXPO_PUBLIC_API_BASE_URL is empty).', 0, false);
    const token = await opts.getToken();
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers as Record<string, string> | undefined) };
    if (token) headers.Authorization = `Bearer ${token}`;
    let res: Response;
    try {
      res = await doFetch(`${base}${path}`, { ...init, headers });
    } catch {
      throw new ImportApiError('Could not reach the server. Check your connection and try again.', 0, true);
    }
    if (!res.ok) throw await readError(res);
    return res;
  }

  return {
    configured: !!base,
    webUrl: (path) => (base ? `${base}${path.startsWith('/') ? '' : '/'}${path}` : null),
    async extract(householdId, images) {
      // No Content-Type header: React Native sets the multipart boundary itself.
      const res = await call('/api/extract', { method: 'POST', body: buildExtractionForm(householdId, images) });
      const body = (await res.json()) as { uploadId?: unknown; draft?: unknown; existing?: unknown };
      if (typeof body.uploadId !== 'string' || !isObj(body.draft)) {
        throw new ImportApiError('The server returned an unexpected response.', res.status, false);
      }
      const existing = (Array.isArray(body.existing) ? body.existing : [])
        .filter(isObj)
        .filter((e) => typeof e.id === 'string' && typeof e.title === 'string')
        .map((e) => ({ id: e.id as string, title: e.title as string }));
      return { uploadId: body.uploadId, draft: body.draft, summary: summariseDraft(body.draft), existing };
    },
    async save(outcome) {
      const res = await call('/api/extract/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId: outcome.uploadId, draft: outcome.draft }),
      });
      const body = (await res.json()) as { id?: unknown };
      if (typeof body.id !== 'string') throw new ImportApiError('The server returned an unexpected response.', res.status, false);
      return { id: body.id };
    },
  };
}
