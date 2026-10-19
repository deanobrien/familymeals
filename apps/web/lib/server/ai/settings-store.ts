import 'server-only';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  DEFAULT_AZURE_API_VERSION, DEFAULT_OPENAI_BASE_URL, DEFAULT_OPENAI_MODEL,
} from '@fr/ai';
import { SettingsError, dataDir, decryptSecret, encryptSecret, getAppSecret, maskKey } from './secret';

/**
 * Household-level AI provider settings (single household for now).
 * TODO(Supabase): move to a household settings row with the key in an encrypted column / vault secret,
 * writable by the household owner only. Until then: a gitignored local file, key encrypted at rest.
 */
export const KEYED_PROVIDERS = ['openai', 'azure', 'anthropic'] as const;
export type KeyedProvider = (typeof KEYED_PROVIDERS)[number];
export const PROVIDER_CHOICES = ['mock', ...KEYED_PROVIDERS] as const;
export type ProviderChoice = (typeof PROVIDER_CHOICES)[number];

export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';

export interface StoredSettings {
  version: 1;
  provider: ProviderChoice;
  openai: { baseUrl: string; model: string; organization: string };
  azure: { endpoint: string; deployment: string; apiVersion: string };
  anthropic: { model: string };
  /** AES-256-GCM blobs + a masked hint (so showing the hint never needs a decrypt). */
  keys: Partial<Record<KeyedProvider, { enc: string; hint: string }>>;
  updatedAt: string;
}

export function defaultSettings(): StoredSettings {
  return {
    version: 1,
    provider: 'mock',
    openai: { baseUrl: DEFAULT_OPENAI_BASE_URL, model: DEFAULT_OPENAI_MODEL, organization: '' },
    azure: { endpoint: '', deployment: '', apiVersion: DEFAULT_AZURE_API_VERSION },
    anthropic: { model: DEFAULT_ANTHROPIC_MODEL },
    keys: {},
    updatedAt: new Date(0).toISOString(),
  };
}

/** What the browser is allowed to see. Never contains a key. */
export interface PublicAiSettings {
  provider: ProviderChoice;
  /** True once the owner has saved a choice (otherwise env / the dev default applies). */
  configured: boolean;
  openai: StoredSettings['openai'];
  azure: StoredSettings['azure'];
  anthropic: StoredSettings['anthropic'];
  keys: Record<KeyedProvider, { hasKey: boolean; hint?: string; unreadable?: boolean; fromEnv?: boolean }>;
  /** Why keys cannot be stored here (e.g. production without APP_SECRET), if so. */
  storageProblem?: string;
  defaults: { openaiBaseUrl: string; openaiModel: string; azureApiVersion: string; anthropicModel: string };
}

const optionalText = (max: number) => z.string().trim().max(max).optional();
const httpUrl = (label: string) =>
  z.string().trim().max(300).refine((v) => {
    try {
      const u = new URL(v);
      if (u.protocol === 'https:') return true;
      // plain http only to a machine on this computer (e.g. a local model server)
      return u.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
    } catch { return false; }
  }, `${label} must be a full https:// address`);

const apiKey = z.string().trim().min(8, 'That does not look like an API key').max(500).regex(/^\S+$/, 'API keys do not contain spaces');

export const saveInputSchema = z.object({
  provider: z.enum(PROVIDER_CHOICES),
  openai: z.object({
    baseUrl: httpUrl('Base URL').or(z.literal('')).optional(),
    model: optionalText(100),
    organization: optionalText(100),
    /** Omitted/empty = keep the stored key. */
    apiKey: apiKey.or(z.literal('')).optional(),
  }).optional(),
  azure: z.object({
    endpoint: httpUrl('Endpoint').or(z.literal('')).optional(),
    deployment: z.string().trim().max(64).regex(/^[\w. -]*$/, 'Deployment names use letters, numbers, - . _').optional(),
    apiVersion: z.string().trim().max(40).regex(/^[\w.-]*$/, 'API version looks like 2024-10-21').optional(),
    apiKey: apiKey.or(z.literal('')).optional(),
  }).optional(),
  anthropic: z.object({
    model: optionalText(100),
    apiKey: apiKey.or(z.literal('')).optional(),
  }).optional(),
});
export type SaveInput = z.input<typeof saveInputSchema>;

export type SaveResult =
  | { ok: true; settings: PublicAiSettings }
  | { ok: false; message: string; field?: string };

export interface StoreOptions {
  dir?: string;
  env?: Record<string, string | undefined>;
  /** Injectable for tests. */
  getSecret?: () => string;
  now?: () => Date;
}

export class AiSettingsStore {
  private readonly dir: string;
  private readonly env: Record<string, string | undefined>;
  private readonly secret: () => string;
  private readonly now: () => Date;

  constructor(opts: StoreOptions = {}) {
    this.env = opts.env ?? process.env;
    this.dir = opts.dir ?? dataDir(this.env);
    this.secret = opts.getSecret ?? (() => getAppSecret(this.env, this.dir));
    this.now = opts.now ?? (() => new Date());
  }

  get file(): string { return join(this.dir, 'ai-settings.json'); }

  /** Raw stored settings (encrypted keys inside). Server-internal. */
  read(): StoredSettings | null {
    if (!existsSync(this.file)) return null;
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<StoredSettings>;
      const d = defaultSettings();
      return {
        version: 1,
        provider: PROVIDER_CHOICES.includes(raw.provider as ProviderChoice) ? (raw.provider as ProviderChoice) : 'mock',
        openai: { ...d.openai, ...raw.openai },
        azure: { ...d.azure, ...raw.azure },
        anthropic: { ...d.anthropic, ...raw.anthropic },
        keys: raw.keys ?? {},
        updatedAt: raw.updatedAt ?? d.updatedAt,
      };
    } catch {
      return null;
    }
  }

  /** The decrypted key for a provider, or undefined when none is stored / it cannot be decrypted. SERVER ONLY. */
  getKey(kind: KeyedProvider): string | undefined {
    const k = this.read()?.keys[kind];
    if (!k) return undefined;
    try {
      return decryptSecret(k.enc, this.secret(), `ai-key:${kind}`);
    } catch {
      return undefined;
    }
  }

  /** Browser-safe view: masked hints only. */
  getPublic(): PublicAiSettings {
    const stored = this.read();
    const s = stored ?? defaultSettings();
    let storageProblem: string | undefined;
    try { this.secret(); } catch (e) { storageProblem = e instanceof SettingsError ? e.message : 'Key storage is unavailable.'; }
    const envKey: Record<KeyedProvider, boolean> = {
      openai: !!this.env.OPENAI_API_KEY, azure: !!this.env.AZURE_OPENAI_API_KEY, anthropic: !!this.env.ANTHROPIC_API_KEY,
    };
    const keys = {} as PublicAiSettings['keys'];
    for (const kind of KEYED_PROVIDERS) {
      const k = s.keys[kind];
      let unreadable = false;
      if (k) {
        try { decryptSecret(k.enc, this.secret(), `ai-key:${kind}`); } catch { unreadable = true; }
      }
      keys[kind] = {
        hasKey: !!k && !unreadable,
        ...(k && !unreadable ? { hint: k.hint } : {}),
        ...(unreadable ? { unreadable: true } : {}),
        ...(envKey[kind] ? { fromEnv: true } : {}),
      };
    }
    return {
      provider: s.provider,
      configured: stored !== null,
      openai: s.openai, azure: s.azure, anthropic: s.anthropic,
      keys,
      ...(storageProblem ? { storageProblem } : {}),
      defaults: {
        openaiBaseUrl: DEFAULT_OPENAI_BASE_URL, openaiModel: DEFAULT_OPENAI_MODEL,
        azureApiVersion: DEFAULT_AZURE_API_VERSION, anthropicModel: DEFAULT_ANTHROPIC_MODEL,
      },
    };
  }

  save(input: unknown): SaveResult {
    const parsed = saveInputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      return { ok: false, message: issue.message, field: issue.path.join('.') };
    }
    const v = parsed.data;
    const cur = this.read() ?? defaultSettings();
    const next: StoredSettings = structuredClone(cur);
    next.provider = v.provider;

    if (v.openai) {
      next.openai = {
        baseUrl: v.openai.baseUrl || cur.openai.baseUrl || DEFAULT_OPENAI_BASE_URL,
        model: v.openai.model || cur.openai.model || DEFAULT_OPENAI_MODEL,
        organization: v.openai.organization ?? cur.openai.organization,
      };
    }
    if (v.azure) {
      next.azure = {
        endpoint: v.azure.endpoint ?? cur.azure.endpoint,
        deployment: v.azure.deployment ?? cur.azure.deployment,
        apiVersion: v.azure.apiVersion || cur.azure.apiVersion || DEFAULT_AZURE_API_VERSION,
      };
    }
    if (v.anthropic) next.anthropic = { model: v.anthropic.model || cur.anthropic.model || DEFAULT_ANTHROPIC_MODEL };

    // New keys: encrypt before anything touches disk. Refuse (never store plaintext) if there is no secret.
    const incoming: Partial<Record<KeyedProvider, string>> = {};
    for (const kind of KEYED_PROVIDERS) {
      const k = v[kind]?.apiKey;
      if (k) incoming[kind] = k;
    }
    if (Object.keys(incoming).length) {
      let secret: string;
      try { secret = this.secret(); } catch (e) {
        return { ok: false, message: e instanceof SettingsError ? e.message : 'Key storage is unavailable.', field: 'apiKey' };
      }
      for (const [kind, key] of Object.entries(incoming) as Array<[KeyedProvider, string]>) {
        next.keys[kind] = { enc: encryptSecret(key, secret, `ai-key:${kind}`), hint: maskKey(key) };
      }
    }

    // A real provider needs everything it requires before it can be selected.
    const problem = this.missingFor(next, next.provider);
    if (problem) return { ok: false, message: problem.message, field: problem.field };

    next.updatedAt = this.now().toISOString();
    this.write(next);
    return { ok: true, settings: this.getPublic() };
  }

  removeKey(kind: KeyedProvider): SaveResult {
    const cur = this.read();
    if (!cur) return { ok: true, settings: this.getPublic() };
    delete cur.keys[kind];
    // Selecting a provider with no key would just fail every import: drop back to mock-by-default.
    if (cur.provider === kind && !this.envHasKey(kind)) cur.provider = 'mock';
    cur.updatedAt = this.now().toISOString();
    this.write(cur);
    return { ok: true, settings: this.getPublic() };
  }

  /** Forget all stored settings (keys included). */
  clear(): void {
    try { if (existsSync(this.file)) unlinkSync(this.file); } catch { /* ignore */ }
  }

  private envHasKey(kind: KeyedProvider): boolean {
    return !!(kind === 'openai' ? this.env.OPENAI_API_KEY : kind === 'azure' ? this.env.AZURE_OPENAI_API_KEY : this.env.ANTHROPIC_API_KEY);
  }

  private missingFor(s: StoredSettings, provider: ProviderChoice): { message: string; field?: string } | undefined {
    if (provider === 'mock') return undefined;
    if (!s.keys[provider] && !this.envHasKey(provider)) return { message: 'Enter an API key to use this provider.', field: 'apiKey' };
    if (provider === 'azure') {
      if (!s.azure.endpoint) return { message: 'Enter your Azure OpenAI endpoint, e.g. https://my-resource.openai.azure.com', field: 'endpoint' };
      if (!s.azure.deployment) return { message: 'Enter the deployment name from your Azure OpenAI resource.', field: 'deployment' };
    }
    return undefined;
  }

  private write(s: StoredSettings): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(s, null, 2), { mode: 0o600 });
    renameSync(tmp, this.file);
  }
}

const g = globalThis as unknown as { __frAiSettings?: AiSettingsStore };
export function getAiSettingsStore(): AiSettingsStore {
  return (g.__frAiSettings ??= new AiSettingsStore());
}
