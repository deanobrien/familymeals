import 'server-only';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** Thrown for configuration problems that the Settings screen can explain to the owner. */
export class SettingsError extends Error {
  constructor(readonly code: 'NO_APP_SECRET' | 'WEAK_APP_SECRET' | 'DECRYPT_FAILED' | 'INVALID', message: string) {
    super(message);
    this.name = 'SettingsError';
  }
}

/**
 * Local data directory (gitignored). TODO(Supabase): replaced by an encrypted column / vault.
 * Production (only reachable with ALLOW_LOCAL_FILE_STORE=true, D150): APP_DATA_DIR, default /home/data, which App Service
 * persists across restarts and deployments (the wwwroot content is replaced on every deploy, so never write there).
 */
export function dataDir(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.APP_DATA_DIR?.trim();
  if (explicit) return explicit;
  if (env.NODE_ENV === 'production') return '/home/data';
  return join(process.cwd(), '.data');
}

const DEV_SECRET_NOTE =
  '# Dev-only encryption secret for .data/ai-settings.json (AES-256-GCM). Gitignored, never commit.\n' +
  '# Delete this file and the stored keys become unreadable (you would re-enter them in Settings).\n' +
  '# In production set APP_SECRET (>= 16 chars) instead; the app refuses to store keys without it.\n';

/**
 * The secret that protects stored API keys.
 * - APP_SECRET env var when set (min 16 chars).
 * - production without APP_SECRET: refuse (we never store keys under an auto-generated secret in production).
 * - development: auto-generate once into `<dataDir>/app-secret`.
 */
export function getAppSecret(env: Record<string, string | undefined> = process.env, dir: string = dataDir(env)): string {
  const fromEnv = env.APP_SECRET?.trim();
  if (fromEnv) {
    if (fromEnv.length < 16) throw new SettingsError('WEAK_APP_SECRET', 'APP_SECRET must be at least 16 characters.');
    return fromEnv;
  }
  if (env.NODE_ENV === 'production') {
    throw new SettingsError('NO_APP_SECRET', 'APP_SECRET is not set, so API keys cannot be stored. Set APP_SECRET (at least 16 characters) on the server.');
  }
  const file = join(dir, 'app-secret');
  if (existsSync(file)) {
    const v = readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#'))[0]?.trim();
    if (v && v.length >= 16) return v;
  }
  mkdirSync(dir, { recursive: true });
  const secret = randomBytes(32).toString('hex');
  writeFileSync(file, `${DEV_SECRET_NOTE}${secret}\n`, { mode: 0o600 });
  try { chmodSync(file, 0o600); } catch { /* best effort on Windows */ }
  return secret;
}

const keyCache = new Map<string, Buffer>();
function deriveKey(secret: string): Buffer {
  let k = keyCache.get(secret);
  if (!k) {
    k = scryptSync(secret, 'family-recipes/ai-settings/v1', 32);
    keyCache.set(secret, k);
  }
  return k;
}

/** AES-256-GCM. `aad` binds the ciphertext to its slot (e.g. "openai") so blobs cannot be swapped between providers. */
export function encryptSecret(plain: string, secret: string, aad: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  c.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64'), c.getAuthTag().toString('base64'), ct.toString('base64')].join('.');
}

export function decryptSecret(blob: string, secret: string, aad: string): string {
  try {
    const [v, iv, tag, ct] = blob.split('.');
    if (v !== 'v1' || !iv || !tag || !ct) throw new Error('format');
    const d = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(iv, 'base64'));
    d.setAAD(Buffer.from(aad));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(ct, 'base64')), d.final()]).toString('utf8');
  } catch {
    throw new SettingsError('DECRYPT_FAILED', 'The stored key could not be decrypted (APP_SECRET changed?). Enter the key again.');
  }
}

/** "sk-…abcd" style hint: never enough to reconstruct the key. */
export function maskKey(key: string): string {
  const k = key.trim();
  const tail = k.slice(-4);
  if (k.length < 12) return `…${k.slice(-2)}`;
  const prefix = /^sk-/.test(k) ? 'sk-' : '';
  return `${prefix}…${tail}`;
}
