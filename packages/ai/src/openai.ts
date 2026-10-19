import { BaseAiProvider, type RunArgs, type SendResult } from './base.js';
import { AiError } from './errors.js';
import { DEFAULT_IMAGE_LIMITS, type ImageLimits } from './image.js';
import { jsonSchemaText, toStrictSchema, type StrictSchema } from './strict-schema.js';
import { allowAllLimits, noopSink, type LimitChecker, type UsageSink } from './usage.js';

export const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
/** Current vision-capable GPT model that supports strict structured outputs. Overridable (free text) in Settings. */
export const DEFAULT_OPENAI_MODEL = 'gpt-4.1';
export const DEFAULT_AZURE_API_VERSION = '2024-10-21';

export interface AzureOpenAiTarget {
  /** e.g. https://my-resource.openai.azure.com */
  endpoint: string;
  /** Name of the model DEPLOYMENT (not the model family). */
  deployment: string;
  apiVersion?: string;
}

export interface OpenAiProviderOptions {
  apiKey: string;
  /** OpenAI-compatible base URL incl. /v1. Ignored in Azure mode. */
  baseUrl?: string;
  organization?: string;
  /** Model for vision operations (and text ones unless textModel is given). */
  model?: string;
  textModel?: string;
  /** Set to use Azure OpenAI (deployment URL + `api-key` header). */
  azure?: AzureOpenAiTarget;
  /** 'auto' tries strict json_schema then falls back to json_object for endpoints that reject it. */
  structuredOutput?: 'auto' | 'json_schema' | 'json_object';
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxAttempts?: number;
  maxOutputTokens?: number;
  usageSink?: UsageSink;
  limits?: LimitChecker;
  imageLimits?: ImageLimits;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Thrown by the transport; carries only safe, key-redacted detail. */
class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly code?: string) { super(message); this.name = 'HttpError'; }
}
class NetworkError extends Error {
  constructor(message: string, readonly timedOut = false) { super(message); this.name = 'NetworkError'; }
}

interface Session {
  messages: any[];
  lastContent?: string;
}

const REPLY_TOOL_RE = /Reply only by calling the provided tool\.?/g;

export class OpenAiProvider extends BaseAiProvider {
  /** Shown in Settings / the import screen. Never contains the key. */
  readonly info: { provider: 'openai' | 'azure'; model: string; endpoint: string };

  private readonly o: {
    apiKey: string; organization?: string; model: string; textModel: string;
    url: string; azure: boolean; fetch: typeof fetch; timeoutMs: number; maxOutputTokens: number;
  };
  private schemaMode: 'json_schema' | 'json_object';
  private tokenParam: 'max_completion_tokens' | 'max_tokens';

  constructor(opts: OpenAiProviderOptions) {
    super({
      maxAttempts: Math.max(1, opts.maxAttempts ?? 3),
      usageSink: opts.usageSink ?? noopSink,
      limits: opts.limits ?? allowAllLimits,
      imageLimits: opts.imageLimits ?? DEFAULT_IMAGE_LIMITS,
      sleep: opts.sleep ?? realSleep,
      now: opts.now ?? Date.now,
    });
    if (!opts.apiKey) throw new AiError('PROVIDER_NOT_CONFIGURED', 'no API key');
    const azure = opts.azure;
    let url: string;
    if (azure) {
      if (!azure.endpoint || !azure.deployment) throw new AiError('PROVIDER_NOT_CONFIGURED', 'Azure endpoint/deployment missing');
      const base = azure.endpoint.trim().replace(/\/+$/, '');
      url = `${base}/openai/deployments/${encodeURIComponent(azure.deployment.trim())}/chat/completions?api-version=${encodeURIComponent(azure.apiVersion?.trim() || DEFAULT_AZURE_API_VERSION)}`;
    } else {
      const base = (opts.baseUrl?.trim() || DEFAULT_OPENAI_BASE_URL).replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
      url = `${base}/chat/completions`;
    }
    const model = azure ? azure.deployment.trim() : (opts.model?.trim() || DEFAULT_OPENAI_MODEL);
    this.o = {
      apiKey: opts.apiKey,
      ...(opts.organization?.trim() ? { organization: opts.organization.trim() } : {}),
      model, textModel: azure ? model : (opts.textModel?.trim() || model),
      url, azure: !!azure,
      fetch: opts.fetch ?? ((...a) => fetch(...a)),
      timeoutMs: opts.timeoutMs ?? 120_000,
      maxOutputTokens: opts.maxOutputTokens ?? 4096,
    };
    this.info = { provider: azure ? 'azure' : 'openai', model, endpoint: azure ? azure.endpoint.trim() : url.replace(/\/chat\/completions$/, '') };
    this.schemaMode = opts.structuredOutput === 'json_object' ? 'json_object' : 'json_schema';
    // The official API and Azure take max_completion_tokens; other compatible servers usually only know max_tokens.
    const official = azure !== undefined || /(^|\/\/)api\.openai\.com/.test(url);
    this.tokenParam = official ? 'max_completion_tokens' : 'max_tokens';
  }

  protected modelFor(kind: 'vision' | 'text') {
    return kind === 'vision' ? this.o.model : this.o.textModel;
  }

  protected newSession(a: RunArgs): Session {
    const hasImage = a.parts.some((p) => p.type === 'image');
    const content = hasImage
      ? a.parts.map((p) => p.type === 'text'
        ? { type: 'text', text: p.text }
        : { type: 'image_url', image_url: { url: `data:${p.image.mediaType};base64,${p.image.data.toString('base64')}`, detail: 'high' } })
      : a.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n');
    return { messages: [{ role: 'user', content }] };
  }

  protected classify(e: unknown): { error: AiError; transient: boolean } {
    if (e instanceof AiError) return { error: e, transient: false };
    if (e instanceof NetworkError) {
      return e.timedOut
        ? { error: new AiError('PROVIDER_UNAVAILABLE', e.message, { retryable: true, cause: e }), transient: true }
        : { error: new AiError('PROVIDER_UNREACHABLE', e.message, { retryable: true, cause: e }), transient: true };
    }
    if (e instanceof HttpError) {
      const s = e.status;
      const detail = `status ${s}${e.code ? ` (${e.code})` : ''}: ${e.message}`;
      if (s === 401 || s === 403) return { error: new AiError('PROVIDER_AUTH', detail, { cause: e }), transient: false };
      if (s === 404 || /model[^.]*(does not exist|not found|not_found)|DeploymentNotFound|model_not_found/i.test(`${e.message} ${e.code ?? ''}`)) {
        return { error: new AiError('MODEL_NOT_FOUND', detail, { cause: e }), transient: false };
      }
      if (s === 429) {
        const quota = /insufficient_quota|billing|quota/i.test(`${e.code ?? ''} ${e.message}`);
        return { error: new AiError('RATE_LIMITED', detail, { retryable: true, cause: e }), transient: !quota };
      }
      if (s === 400 || s === 413 || s === 422) return { error: new AiError('BAD_REQUEST', detail, { cause: e }), transient: false };
      return { error: new AiError('PROVIDER_UNAVAILABLE', detail, { retryable: true, cause: e }), transient: s === 408 || s === 409 || s >= 500 };
    }
    return { error: new AiError('PROVIDER_UNAVAILABLE', this.redact(String((e as Error)?.message ?? e)), { retryable: true, cause: e }), transient: false };
  }

  protected async send(a: RunArgs, session: unknown, feedback: string | undefined): Promise<SendResult> {
    const s = session as Session;
    if (feedback !== undefined && s.lastContent !== undefined) {
      s.messages.push({ role: 'assistant', content: s.lastContent });
      s.messages.push({ role: 'user', content: `Schema validation failed:\n${feedback}\nReply again with the corrected JSON object only.` });
    }
    const strict: StrictSchema = toStrictSchema(a.schema);
    let data: any;
    // Adapt to endpoint quirks (unsupported json_schema / token parameter) without burning a retry attempt.
    for (let adapt = 0; ; adapt++) {
      const body = this.buildBody(a, s, strict);
      try {
        data = await this.post(body);
        break;
      } catch (e) {
        if (adapt < 3 && e instanceof HttpError && e.status === 400 && this.adaptTo(e.message)) continue;
        throw e;
      }
    }

    const inputTokens = data?.usage?.prompt_tokens ?? 0;
    const outputTokens = data?.usage?.completion_tokens ?? 0;
    const choice = data?.choices?.[0];
    const msg = choice?.message;
    if (msg?.refusal) return { inputTokens, outputTokens, missingReason: `model refused: ${String(msg.refusal).slice(0, 200)}` };
    const text = typeof msg?.content === 'string' ? msg.content : undefined;
    s.lastContent = text;
    if (text === undefined || text.trim() === '') {
      return { inputTokens, outputTokens, missingReason: choice?.finish_reason === 'length' ? 'output truncated (max tokens)' : 'empty response' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stripFences(text));
    } catch {
      return { inputTokens, outputTokens, missingReason: choice?.finish_reason === 'length' ? 'output truncated (max tokens)' : 'response was not valid JSON' };
    }
    return { candidate: strict.decode(parsed), inputTokens, outputTokens };
  }

  private buildBody(a: RunArgs, s: Session, strict: StrictSchema): Record<string, unknown> {
    const sys = a.system.replace(REPLY_TOOL_RE, 'Reply only with a single JSON object that matches the required schema, with no other text.');
    const system = this.schemaMode === 'json_object'
      ? `${sys}\n\nThe JSON object must match this JSON Schema (omit optional properties you have no value for):\n${jsonSchemaText(a.schema)}`
      : sys;
    const body: Record<string, unknown> = {
      messages: [{ role: 'system', content: system }, ...s.messages],
      [this.tokenParam]: this.o.maxOutputTokens,
      response_format: this.schemaMode === 'json_schema'
        ? { type: 'json_schema', json_schema: { name: a.toolName, strict: true, schema: strict.schema } }
        : { type: 'json_object' },
    };
    if (!this.o.azure) body.model = a.model;
    return body;
  }

  /** Switch off an unsupported feature named in a 400. Returns true when something changed (so retry the request). */
  private adaptTo(message: string): boolean {
    if (this.tokenParam === 'max_completion_tokens' && /max_completion_tokens/i.test(message) && /unrecognized|unknown|unexpected|not supported|extra/i.test(message)) {
      this.tokenParam = 'max_tokens';
      return true;
    }
    if (this.tokenParam === 'max_tokens' && /max_tokens/i.test(message) && /max_completion_tokens|not supported/i.test(message)) {
      this.tokenParam = 'max_completion_tokens';
      return true;
    }
    if (this.schemaMode === 'json_schema' && /response_format|json_schema|structured output|invalid schema|schema/i.test(message)) {
      this.schemaMode = 'json_object';
      return true;
    }
    return false;
  }

  private redact(text: string): string {
    return this.o.apiKey ? text.split(this.o.apiKey).join('[redacted]') : text;
  }

  private async post(body: Record<string, unknown>): Promise<any> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (this.o.azure) headers['api-key'] = this.o.apiKey;
    else headers.authorization = `Bearer ${this.o.apiKey}`;
    if (this.o.organization) headers['openai-organization'] = this.o.organization;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.o.timeoutMs);
    let res: Response;
    try {
      res = await this.o.fetch(this.o.url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctrl.signal });
    } catch (e) {
      const aborted = ctrl.signal.aborted || (e as Error)?.name === 'AbortError';
      throw new NetworkError(this.redact(aborted ? 'request timed out' : String((e as Error)?.message ?? e)), aborted);
    } finally {
      clearTimeout(timer);
    }
    const raw = await res.text().catch(() => '');
    if (!res.ok) {
      let message = raw.slice(0, 500);
      let code: string | undefined;
      try {
        const j = JSON.parse(raw);
        message = String(j?.error?.message ?? j?.message ?? message);
        code = typeof j?.error?.code === 'string' ? j.error.code : undefined;
      } catch { /* non-JSON error body */ }
      throw new HttpError(res.status, this.redact(message).slice(0, 500), code);
    }
    try {
      return JSON.parse(raw);
    } catch {
      throw new HttpError(502, 'response was not JSON');
    }
  }
}

function stripFences(t: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(t);
  return m ? m[1]! : t;
}

/** Build from env: OPENAI_API_KEY (+ OPENAI_BASE_URL, OPENAI_MODEL, OPENAI_ORG, AI_MAX_ATTEMPTS). */
export function createOpenAiProvider(
  env: Record<string, string | undefined> = process.env,
  extra: Partial<OpenAiProviderOptions> = {},
): OpenAiProvider {
  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) throw new AiError('PROVIDER_NOT_CONFIGURED', 'OPENAI_API_KEY is not set');
  return new OpenAiProvider({
    apiKey,
    baseUrl: env.OPENAI_BASE_URL || undefined,
    model: env.OPENAI_MODEL || undefined,
    organization: env.OPENAI_ORG || undefined,
    maxAttempts: env.AI_MAX_ATTEMPTS ? Number(env.AI_MAX_ATTEMPTS) : undefined,
    ...extra,
  });
}

/** Build from env: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_DEPLOYMENT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_API_VERSION. */
export function createAzureOpenAiProvider(
  env: Record<string, string | undefined> = process.env,
  extra: Partial<OpenAiProviderOptions> = {},
): OpenAiProvider {
  const apiKey = env.AZURE_OPENAI_API_KEY;
  const endpoint = env.AZURE_OPENAI_ENDPOINT;
  const deployment = env.AZURE_OPENAI_DEPLOYMENT;
  if (!apiKey || !endpoint || !deployment) throw new AiError('PROVIDER_NOT_CONFIGURED', 'AZURE_OPENAI_ENDPOINT / _DEPLOYMENT / _API_KEY not all set');
  return new OpenAiProvider({
    apiKey,
    azure: { endpoint, deployment, ...(env.AZURE_OPENAI_API_VERSION ? { apiVersion: env.AZURE_OPENAI_API_VERSION } : {}) },
    maxAttempts: env.AI_MAX_ATTEMPTS ? Number(env.AI_MAX_ATTEMPTS) : undefined,
    ...extra,
  });
}
