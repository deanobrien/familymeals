import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AiError, OpenAiProvider } from '@fr/ai';
import { getAiProvider, resolveAi, testConnection } from './provider';
import { SettingsError, decryptSecret, encryptSecret, getAppSecret, maskKey } from './secret';
import { AiSettingsStore, defaultSettings } from './settings-store';

const KEY = 'sk-proj-SuperSecretKeyValue1234567890wxyz';
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fr-ai-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

const mk = (env: Record<string, string | undefined> = {}) => new AiSettingsStore({ dir, env: { NODE_ENV: 'development', ...env } });
const filesText = () => readdirSync(dir).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n');

describe('encryption', () => {
  it('AES-256-GCM round trip; blob is not plaintext; random IV; wrong secret / AAD / tamper fail', () => {
    const a = encryptSecret(KEY, 'a-secret-of-16-chars', 'ai-key:openai');
    const b = encryptSecret(KEY, 'a-secret-of-16-chars', 'ai-key:openai');
    expect(a).not.toBe(b);
    expect(a).not.toContain(KEY);
    expect(a.startsWith('v1.')).toBe(true);
    expect(decryptSecret(a, 'a-secret-of-16-chars', 'ai-key:openai')).toBe(KEY);
    expect(() => decryptSecret(a, 'another-secret-16chars', 'ai-key:openai')).toThrowError(SettingsError);
    expect(() => decryptSecret(a, 'a-secret-of-16-chars', 'ai-key:azure')).toThrowError(/could not be decrypted/);
    const parts = a.split('.');
    parts[3] = Buffer.from('tampered').toString('base64');
    expect(() => decryptSecret(parts.join('.'), 'a-secret-of-16-chars', 'ai-key:openai')).toThrowError(SettingsError);
  });

  it('masks keys without revealing them', () => {
    expect(maskKey(KEY)).toBe('sk-…wxyz');
    expect(maskKey('abcdef1234567890')).toBe('…7890');
    expect(maskKey('short-key')).toBe('…ey');
    expect(maskKey(KEY)).not.toContain('Secret');
  });
});

describe('app secret', () => {
  it('uses APP_SECRET when set and rejects a weak one', () => {
    expect(getAppSecret({ APP_SECRET: 'x'.repeat(20) }, dir)).toBe('x'.repeat(20));
    expect(() => getAppSecret({ APP_SECRET: 'short' }, dir)).toThrowError(/at least 16/);
  });
  it('production without APP_SECRET refuses (and writes nothing)', () => {
    expect(() => getAppSecret({ NODE_ENV: 'production' }, dir)).toThrowError(SettingsError);
    expect(readdirSync(dir)).toEqual([]);
  });
  it('development auto-generates a stable secret file with a clear note', () => {
    const s1 = getAppSecret({ NODE_ENV: 'development' }, dir);
    const s2 = getAppSecret({ NODE_ENV: 'development' }, dir);
    expect(s1).toBe(s2);
    expect(s1.length).toBeGreaterThanOrEqual(32);
    const text = readFileSync(join(dir, 'app-secret'), 'utf8');
    expect(text).toMatch(/^# Dev-only encryption secret/);
    expect(text).toMatch(/production set APP_SECRET/);
  });
});

describe('AiSettingsStore', () => {
  it('stores the key encrypted at rest: plaintext never appears in any file on disk', () => {
    const store = mk();
    const r = store.save({ provider: 'openai', openai: { apiKey: KEY, model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' } });
    expect(r.ok).toBe(true);
    const onDisk = filesText();
    expect(onDisk).not.toContain(KEY);
    expect(onDisk).not.toContain('SuperSecretKeyValue');
    const saved = JSON.parse(readFileSync(store.file, 'utf8'));
    expect(saved.keys.openai.enc).toMatch(/^v1\./);
    expect(saved.keys.openai.hint).toBe('sk-…wxyz');
    // server-side read decrypts
    expect(store.getKey('openai')).toBe(KEY);
  });

  it('never returns the key to callers of getPublic / save results', () => {
    const store = mk();
    const r = store.save({ provider: 'openai', openai: { apiKey: KEY } });
    const pub = store.getPublic();
    for (const obj of [r, pub]) {
      const text = JSON.stringify(obj);
      expect(text).not.toContain(KEY);
      expect(text).not.toContain('SuperSecret');
      expect(text).not.toMatch(/"enc"/);
      expect(text).not.toMatch(/"apiKey"/);
    }
    expect(pub.keys.openai).toEqual({ hasKey: true, hint: 'sk-…wxyz' });
    expect(pub.keys.azure).toEqual({ hasKey: false });
    expect(pub.provider).toBe('openai');
  });

  it('empty key on save keeps the stored key; removeKey deletes it and falls back to mock', () => {
    const store = mk();
    store.save({ provider: 'openai', openai: { apiKey: KEY, model: 'gpt-4o' } });
    const r2 = store.save({ provider: 'openai', openai: { apiKey: '', model: 'gpt-4.1' } });
    expect(r2.ok).toBe(true);
    expect(store.getKey('openai')).toBe(KEY);
    expect(store.getPublic().openai.model).toBe('gpt-4.1');
    const r3 = store.removeKey('openai');
    expect(r3.ok && r3.settings.keys.openai.hasKey).toBe(false);
    expect(store.getKey('openai')).toBeUndefined();
    expect(store.getPublic().provider).toBe('mock');
    expect(filesText()).not.toContain('"enc": "v1');
  });

  it('keys are per provider, so switching does not lose them', () => {
    const store = mk();
    store.save({ provider: 'openai', openai: { apiKey: KEY } });
    store.save({ provider: 'azure', azure: { apiKey: 'azure-key-0123456789', endpoint: 'https://r.openai.azure.com', deployment: 'gpt4o' } });
    store.save({ provider: 'openai' });
    expect(store.getKey('openai')).toBe(KEY);
    expect(store.getKey('azure')).toBe('azure-key-0123456789');
  });

  it('refuses a real provider with no key, and Azure without endpoint/deployment', () => {
    const store = mk();
    expect(store.save({ provider: 'openai' })).toMatchObject({ ok: false, field: 'apiKey' });
    expect(store.save({ provider: 'azure', azure: { apiKey: 'azure-key-0123456789' } })).toMatchObject({ ok: false, field: 'endpoint' });
    expect(store.save({ provider: 'azure', azure: { apiKey: 'azure-key-0123456789', endpoint: 'https://r.openai.azure.com' } })).toMatchObject({ ok: false, field: 'deployment' });
    expect(store.read()).toBeNull();
  });

  it('an env key satisfies the key requirement (settings override, env still works)', () => {
    const store = mk({ OPENAI_API_KEY: 'sk-from-env-0123456789' });
    expect(store.save({ provider: 'openai', openai: { model: 'gpt-4o' } }).ok).toBe(true);
    expect(store.getPublic().keys.openai).toEqual({ hasKey: false, fromEnv: true });
  });

  it('validates input: bad URL, http to a remote host, spaces in key, unknown provider', () => {
    const store = mk();
    expect(store.save({ provider: 'openai', openai: { apiKey: KEY, baseUrl: 'not a url' } })).toMatchObject({ ok: false });
    expect(store.save({ provider: 'openai', openai: { apiKey: KEY, baseUrl: 'http://evil.example.com/v1' } })).toMatchObject({ ok: false });
    expect(store.save({ provider: 'openai', openai: { apiKey: KEY, baseUrl: 'http://localhost:11434/v1' } }).ok).toBe(true);
    expect(store.save({ provider: 'openai', openai: { apiKey: 'sk has spaces in it' } })).toMatchObject({ ok: false });
    expect(store.save({ provider: 'gemini' as never })).toMatchObject({ ok: false });
  });

  it('production without APP_SECRET refuses to store a key and leaves no file', () => {
    const store = mk({ NODE_ENV: 'production' });
    const r = store.save({ provider: 'openai', openai: { apiKey: KEY } });
    expect(r).toMatchObject({ ok: false });
    expect(r.ok === false && r.message).toMatch(/APP_SECRET/);
    expect(readdirSync(dir)).toEqual([]);
    expect(store.getPublic().storageProblem).toMatch(/APP_SECRET/);
  });

  it('production with APP_SECRET works; changing APP_SECRET makes the key unreadable and says so', () => {
    const a = mk({ NODE_ENV: 'production', APP_SECRET: 'prod-secret-aaaaaaaaaaaa' });
    expect(a.save({ provider: 'openai', openai: { apiKey: KEY } }).ok).toBe(true);
    expect(a.getKey('openai')).toBe(KEY);
    const b = mk({ NODE_ENV: 'production', APP_SECRET: 'prod-secret-bbbbbbbbbbbb' });
    expect(b.getKey('openai')).toBeUndefined();
    expect(b.getPublic().keys.openai).toEqual({ hasKey: false, unreadable: true });
  });

  it('survives a corrupt file (treated as unconfigured)', () => {
    const store = mk();
    writeFileSync(store.file, '{ not json');
    expect(store.read()).toBeNull();
    expect(store.getPublic().configured).toBe(false);
  });

  it('defaults are sensible', () => {
    const d = defaultSettings();
    expect(d.openai).toMatchObject({ baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1' });
    expect(d.azure.apiVersion).toBe('2024-10-21');
  });
});

describe('provider resolution (settings > env > default)', () => {
  it('defaults to the mock when nothing is configured (D6)', () => {
    const r = resolveAi(mk(), {});
    expect(r.info).toMatchObject({ kind: 'mock', source: 'default', isMock: true, configured: true });
  });

  it('env works on its own', () => {
    const r = resolveAi(mk(), { AI_PROVIDER: 'openai', OPENAI_API_KEY: 'sk-env', OPENAI_MODEL: 'gpt-4o' });
    expect(r.info).toMatchObject({ kind: 'openai', source: 'env', model: 'gpt-4o' });
    expect(resolveAi(mk(), { AI_PROVIDER: 'openai' }).info).toMatchObject({ configured: false, kind: 'openai' });
  });

  it('saved settings override env', () => {
    const store = mk();
    store.save({ provider: 'openai', openai: { apiKey: KEY, model: 'gpt-4o-mini', baseUrl: 'https://proxy.example.com/v1' } });
    const r = resolveAi(store, { AI_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'sk-ant-env', OPENAI_MODEL: 'gpt-3' });
    expect(r.config).toMatchObject({ kind: 'openai', apiKey: KEY, model: 'gpt-4o-mini', baseUrl: 'https://proxy.example.com/v1' });
    expect(r.info.source).toBe('settings');
    expect(JSON.stringify(r.info)).not.toContain(KEY);
  });

  it('a saved real provider with a lost key is "not configured", never a silent mock', () => {
    const a = mk({ NODE_ENV: 'production', APP_SECRET: 'prod-secret-aaaaaaaaaaaa' });
    a.save({ provider: 'openai', openai: { apiKey: KEY } });
    const b = new AiSettingsStore({ dir, env: { NODE_ENV: 'production', APP_SECRET: 'prod-secret-bbbbbbbbbbbb' } });
    const r = resolveAi(b, {});
    expect(r.info.configured).toBe(false);
    expect(r.config).toBeUndefined();
    expect(() => getAiProvider(b, {})).toThrowError(/PROVIDER_NOT_CONFIGURED/);
  });

  it('builds the right provider kinds, including Azure', () => {
    const store = mk();
    store.save({ provider: 'azure', azure: { apiKey: 'azure-key-0123456789', endpoint: 'https://r.openai.azure.com', deployment: 'vision-1' } });
    const p = getAiProvider(store, {}) as OpenAiProvider;
    expect(p).toBeInstanceOf(OpenAiProvider);
    expect(p.info).toMatchObject({ provider: 'azure', model: 'vision-1' });
    expect(resolveAi(store, {}).info.label).toBe('Azure OpenAI - vision-1');
  });
});

describe('testConnection', () => {
  it('reports unconfigured providers without calling anything', async () => {
    const r = await testConnection(mk(), { AI_PROVIDER: 'openai' });
    expect(r).toMatchObject({ ok: false, code: 'PROVIDER_NOT_CONFIGURED' });
  });

  it('succeeds for the mock and reports typed errors for a real provider via fetch', async () => {
    const ok = await testConnection(mk(), {});
    expect(ok).toMatchObject({ ok: true, model: 'mock' });

    const store = mk();
    store.save({ provider: 'openai', openai: { apiKey: KEY, baseUrl: 'http://localhost:9/v1' } });
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${KEY}` } }), { status: 401 })) as typeof fetch;
    try {
      const bad = await testConnection(store, {});
      expect(bad).toMatchObject({ ok: false, code: 'PROVIDER_AUTH' });
      expect(JSON.stringify(bad)).not.toContain(KEY);
      expect(bad.ok === false && bad.message).toMatch(/rejected the API key/);

      globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3 } }), { status: 200 })) as typeof fetch;
      const good = await testConnection(store, {});
      expect(good).toMatchObject({ ok: true, model: 'gpt-4.1' });

      globalThis.fetch = (async () => { throw new TypeError('fetch failed'); }) as typeof fetch;
      expect(await testConnection(store, {})).toMatchObject({ ok: false, code: 'PROVIDER_UNREACHABLE' });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('AiError type is exported for callers', () => {
    expect(new AiError('MODEL_NOT_FOUND').userMessage).toMatch(/model/i);
  });
});
