// Phone-as-scanner sessions (P3-C, D447-D449): storage contracts, the in-memory demo store and the Supabase stores. The rules are
// enforced twice on purpose: in SQL (the SECURITY DEFINER functions of migration 20261021003200, which are what protect a real
// deployment) and here (the in-memory store used in mock mode and by unit tests). Both answer with the same error codes.
import 'server-only';
import { createHash } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  MAX_PHOTO_BYTES, MAX_PUSHES_PER_MINUTE, MAX_SESSION_ITEMS, MAX_SESSION_PHOTOS, SESSION_TTL_SECONDS, sessionState,
  type ScannerErrorCode, type ScannerItem, type ScannerPurpose, type ScannerSessionView,
} from '@fr/engine/scanner';
import { readPublicEnv } from '../../supabase/env';

export type StoreResult<T = object> = ({ ok: true } & T) | { ok: false; error: ScannerErrorCode };

export interface DesktopCtx {
  householdId: string;
  userId: string;
}

export interface PhonePush {
  clientId: string;
  kind: 'barcode' | 'photo';
  /** Canonical EAN-8 / EAN-13 (validated by the route). */
  barcode?: string;
  count?: number;
  photo?: { mime: 'image/jpeg' | 'image/png' | 'image/webp'; bytes: Buffer };
}

/** What the signed-in desktop user does with a session. */
export interface DesktopScannerStore {
  create(ctx: DesktopCtx, purpose: ScannerPurpose, tokenHash: string): Promise<StoreResult<{ id: string; expiresAt: string }>>;
  status(ctx: DesktopCtx, sessionId: string, afterSeq: number): Promise<StoreResult<{ session: ScannerSessionView; items: ScannerItem[] }>>;
  revoke(ctx: DesktopCtx, sessionId: string): Promise<StoreResult>;
  release(ctx: DesktopCtx, sessionId: string): Promise<StoreResult>;
  photo(ctx: DesktopCtx, itemId: string): Promise<StoreResult<{ mime: string; bytes: Buffer }>>;
}

/** What a phone does with the capability (session id + token) in the QR code. */
export interface PhoneScannerStore {
  connect(sessionId: string, token: string, device: string): Promise<StoreResult<{ purpose: ScannerPurpose; expiresAt: string; itemCount: number }>>;
  push(sessionId: string, token: string, device: string, push: PhonePush): Promise<StoreResult<{ duplicate: boolean; itemCount: number }>>;
}

export const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');
const hashDevice = hashToken;

// ---------------------------------------------------------------------------------------------------------------------
// In-memory (mock mode and tests): same rules as the SQL functions
// ---------------------------------------------------------------------------------------------------------------------

interface MemSession {
  id: string;
  householdId: string;
  userId: string;
  purpose: ScannerPurpose;
  tokenHash: string;
  deviceHash: string | null;
  expiresAt: number;
  createdAt: number;
  revokedAt: number | null;
  connected: boolean;
  failedAttempts: number;
  itemCount: number;
  photoCount: number;
}
interface MemItem extends ScannerItem {
  sessionId: string;
  clientId: string;
  createdAt: number;
  photo?: { mime: string; bytes: Buffer };
}

export class MemoryScannerStore implements DesktopScannerStore, PhoneScannerStore {
  private sessions = new Map<string, MemSession>();
  private items: MemItem[] = [];
  private seq = 0;

  constructor(private readonly now: () => number = Date.now, private readonly newId: () => string = () => crypto.randomUUID()) {}

  reset(): void {
    this.sessions.clear();
    this.items = [];
    this.seq = 0;
  }

  async create(ctx: DesktopCtx, purpose: ScannerPurpose, tokenHash: string): Promise<StoreResult<{ id: string; expiresAt: string }>> {
    if (!/^[0-9a-f]{64}$/.test(tokenHash) || (purpose !== 'pantry' && purpose !== 'receipt')) return { ok: false, error: 'invalid_input' };
    const t = this.now();
    const mine = [...this.sessions.values()].filter((s) => s.userId === ctx.userId);
    if (mine.filter((s) => s.createdAt > t - 3_600_000).length >= 20) return { ok: false, error: 'rate_limited' };
    for (const s of mine) if (s.revokedAt === null && s.expiresAt > t) this.close(s);
    const id = this.newId();
    const s: MemSession = {
      id, householdId: ctx.householdId, userId: ctx.userId, purpose, tokenHash, deviceHash: null, expiresAt: t + SESSION_TTL_SECONDS * 1000,
      createdAt: t, revokedAt: null, connected: false, failedAttempts: 0, itemCount: 0, photoCount: 0,
    };
    this.sessions.set(id, s);
    return { ok: true, id, expiresAt: new Date(s.expiresAt).toISOString() };
  }

  private close(s: MemSession): void {
    s.revokedAt ??= this.now();
    this.items = this.items.filter((i) => i.sessionId !== s.id);
  }

  private view(s: MemSession): ScannerSessionView {
    return {
      id: s.id, purpose: s.purpose, expiresAt: new Date(s.expiresAt).toISOString(), itemCount: s.itemCount, photoCount: s.photoCount,
      state: sessionState({ expiresAt: new Date(s.expiresAt).toISOString(), revokedAt: s.revokedAt ? 'x' : null, connected: s.connected }, this.now()),
    };
  }

  private own(ctx: DesktopCtx, id: string): MemSession | null {
    const s = this.sessions.get(id);
    return s && s.userId === ctx.userId && s.householdId === ctx.householdId ? s : null;
  }

  async status(ctx: DesktopCtx, sessionId: string, afterSeq: number): Promise<StoreResult<{ session: ScannerSessionView; items: ScannerItem[] }>> {
    const s = this.own(ctx, sessionId);
    if (!s) return { ok: false, error: 'not_found' };
    const items = this.items.filter((i) => i.sessionId === s.id && i.seq > afterSeq).sort((a, b) => a.seq - b.seq).slice(0, 200)
      .map((i): ScannerItem => ({ id: i.id, seq: i.seq, kind: i.kind, ...(i.barcode ? { barcode: i.barcode } : {}), count: i.count }));
    return { ok: true, session: this.view(s), items };
  }

  async revoke(ctx: DesktopCtx, sessionId: string): Promise<StoreResult> {
    const s = this.own(ctx, sessionId);
    if (!s) return { ok: false, error: 'not_found' };
    this.close(s);
    return { ok: true };
  }

  async release(ctx: DesktopCtx, sessionId: string): Promise<StoreResult> {
    const s = this.own(ctx, sessionId);
    if (!s || s.revokedAt !== null || s.expiresAt <= this.now()) return { ok: false, error: 'not_found' };
    s.deviceHash = null;
    s.connected = false;
    return { ok: true };
  }

  async photo(ctx: DesktopCtx, itemId: string): Promise<StoreResult<{ mime: string; bytes: Buffer }>> {
    const item = this.items.find((i) => i.id === itemId);
    if (!item?.photo || !this.own(ctx, item.sessionId)) return { ok: false, error: 'not_found' };
    return { ok: true, mime: item.photo.mime, bytes: item.photo.bytes };
  }

  private validate(sessionId: string, token: string, device: string): { error: ScannerErrorCode } | { session: MemSession } {
    if (!token || token.length < 20 || token.length > 128 || !device || device.length < 16 || device.length > 128) return { error: 'invalid' };
    const s = this.sessions.get(sessionId);
    if (!s) return { error: 'invalid' };
    if (s.tokenHash !== hashToken(token)) {
      s.failedAttempts += 1;
      if (s.failedAttempts >= 10) s.revokedAt ??= this.now();
      return { error: 'invalid' };
    }
    if (s.revokedAt !== null) return { error: 'revoked' };
    if (s.expiresAt <= this.now()) return { error: 'expired' };
    const d = hashDevice(device);
    if (s.deviceHash !== null && s.deviceHash !== d) return { error: 'scanner_in_use' };
    if (s.deviceHash === null) {
      s.deviceHash = d;
      s.connected = true;
    }
    return { session: s };
  }

  async connect(sessionId: string, token: string, device: string): Promise<StoreResult<{ purpose: ScannerPurpose; expiresAt: string; itemCount: number }>> {
    const v = this.validate(sessionId, token, device);
    if ('error' in v) return { ok: false, error: v.error };
    return { ok: true, purpose: v.session.purpose, expiresAt: new Date(v.session.expiresAt).toISOString(), itemCount: v.session.itemCount };
  }

  async push(sessionId: string, token: string, device: string, p: PhonePush): Promise<StoreResult<{ duplicate: boolean; itemCount: number }>> {
    const v = this.validate(sessionId, token, device);
    if ('error' in v) return { ok: false, error: v.error };
    const s = v.session;
    if (typeof p.clientId !== 'string' || p.clientId.length < 8 || p.clientId.length > 64 || (p.kind !== 'barcode' && p.kind !== 'photo')) return { ok: false, error: 'invalid_input' };
    if (this.items.some((i) => i.sessionId === s.id && i.clientId === p.clientId)) return { ok: true, duplicate: true, itemCount: s.itemCount };
    const t = this.now();
    if (this.items.filter((i) => i.sessionId === s.id && i.createdAt > t - 60_000).length >= MAX_PUSHES_PER_MINUTE) return { ok: false, error: 'rate_limited' };
    if (s.itemCount >= MAX_SESSION_ITEMS) return { ok: false, error: 'session_full' };
    const base = { id: this.newId(), seq: ++this.seq, sessionId: s.id, clientId: p.clientId, createdAt: t };
    if (p.kind === 'barcode') {
      const count = p.count ?? 1;
      if (!p.barcode || !/^([0-9]{8}|[0-9]{13})$/.test(p.barcode) || !Number.isInteger(count) || count < 1 || count > 99) return { ok: false, error: 'invalid_input' };
      this.items.push({ ...base, kind: 'barcode', barcode: p.barcode, count });
    } else {
      if (s.photoCount >= MAX_SESSION_PHOTOS) return { ok: false, error: 'too_many_photos' };
      if (!p.photo || !['image/jpeg', 'image/png', 'image/webp'].includes(p.photo.mime) || p.photo.bytes.length < 1) return { ok: false, error: 'invalid_input' };
      if (p.photo.bytes.length > MAX_PHOTO_BYTES) return { ok: false, error: 'photo_too_large' };
      this.items.push({ ...base, kind: 'photo', count: 1, photo: p.photo });
      s.photoCount += 1;
    }
    s.itemCount += 1;
    return { ok: true, duplicate: false, itemCount: s.itemCount };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------------------------------------------------

type Json = Record<string, unknown>;
const KNOWN: ReadonlySet<string> = new Set(['invalid', 'revoked', 'expired', 'scanner_in_use', 'rate_limited', 'session_full', 'too_many_photos', 'photo_too_large', 'invalid_input', 'forbidden', 'not_found']);
const codeOf = (v: unknown): ScannerErrorCode => (typeof v === 'string' && KNOWN.has(v) ? (v as ScannerErrorCode) : 'unavailable');

async function rpc(db: SupabaseClient, fn: string, args: Json): Promise<Json | null> {
  const { data, error } = (await db.rpc(fn, args)) as { data: unknown; error: unknown };
  if (error || !data || typeof data !== 'object') return null;
  return data as Json;
}

/** The signed-in user's own client (RLS applies). */
export class SupabaseDesktopScannerStore implements DesktopScannerStore {
  constructor(private readonly db: SupabaseClient) {}

  async create(ctx: DesktopCtx, purpose: ScannerPurpose, tokenHash: string): Promise<StoreResult<{ id: string; expiresAt: string }>> {
    const r = await rpc(this.db, 'scanner_session_create', { p_household_id: ctx.householdId, p_purpose: purpose, p_token_hash: tokenHash, p_ttl_seconds: SESSION_TTL_SECONDS });
    if (!r) return { ok: false, error: 'unavailable' };
    return r.ok === true && typeof r.id === 'string' ? { ok: true, id: r.id, expiresAt: String(r.expiresAt) } : { ok: false, error: codeOf(r.error) };
  }

  async status(ctx: DesktopCtx, sessionId: string, afterSeq: number): Promise<StoreResult<{ session: ScannerSessionView; items: ScannerItem[] }>> {
    const { data: s, error } = await this.db
      .from('scanner_sessions')
      .select('id, purpose, expires_at, revoked_at, connected_at, item_count, photo_count')
      .eq('id', sessionId).eq('household_id', ctx.householdId).maybeSingle();
    if (error) return { ok: false, error: 'unavailable' };
    if (!s) return { ok: false, error: 'not_found' };
    const { data: rows, error: e2 } = await this.db
      .from('scanner_items').select('id, seq, kind, barcode, count')
      .eq('session_id', sessionId).gt('seq', afterSeq).order('seq', { ascending: true }).limit(200);
    if (e2) return { ok: false, error: 'unavailable' };
    const expiresAt = String(s.expires_at);
    return {
      ok: true,
      session: {
        id: String(s.id), purpose: s.purpose === 'receipt' ? 'receipt' : 'pantry', expiresAt, itemCount: Number(s.item_count), photoCount: Number(s.photo_count),
        state: sessionState({ expiresAt, revokedAt: (s.revoked_at as string | null) ?? null, connected: s.connected_at !== null }, Date.now()),
      },
      items: (rows ?? []).map((r): ScannerItem => ({
        id: String(r.id), seq: Number(r.seq), kind: r.kind === 'photo' ? 'photo' : 'barcode', ...(r.barcode ? { barcode: String(r.barcode) } : {}), count: Number(r.count),
      })),
    };
  }

  async revoke(_ctx: DesktopCtx, sessionId: string): Promise<StoreResult> {
    const r = await rpc(this.db, 'scanner_session_revoke', { p_session_id: sessionId });
    if (!r) return { ok: false, error: 'unavailable' };
    return r.ok === true ? { ok: true } : { ok: false, error: codeOf(r.error) };
  }

  async release(_ctx: DesktopCtx, sessionId: string): Promise<StoreResult> {
    const r = await rpc(this.db, 'scanner_session_release', { p_session_id: sessionId });
    if (!r) return { ok: false, error: 'unavailable' };
    return r.ok === true ? { ok: true } : { ok: false, error: codeOf(r.error) };
  }

  async photo(_ctx: DesktopCtx, itemId: string): Promise<StoreResult<{ mime: string; bytes: Buffer }>> {
    const { data, error } = (await this.db.rpc('scanner_photo', { p_item_id: itemId })) as { data: Json | null; error: unknown };
    if (error) return { ok: false, error: 'unavailable' };
    if (!data || typeof data.base64 !== 'string' || typeof data.mime !== 'string') return { ok: false, error: 'not_found' };
    return { ok: true, mime: data.mime, bytes: Buffer.from(data.base64, 'base64') };
  }
}

/** The anon client: it can ONLY call scanner_connect / scanner_push (nothing else is granted to anon). */
export class SupabasePhoneScannerStore implements PhoneScannerStore {
  constructor(private readonly db: SupabaseClient) {}

  async connect(sessionId: string, token: string, device: string): Promise<StoreResult<{ purpose: ScannerPurpose; expiresAt: string; itemCount: number }>> {
    const r = await rpc(this.db, 'scanner_connect', { p_session_id: sessionId, p_token: token, p_device: device });
    if (!r) return { ok: false, error: 'unavailable' };
    return r.ok === true
      ? { ok: true, purpose: r.purpose === 'receipt' ? 'receipt' : 'pantry', expiresAt: String(r.expiresAt), itemCount: Number(r.itemCount ?? 0) }
      : { ok: false, error: codeOf(r.error) };
  }

  async push(sessionId: string, token: string, device: string, p: PhonePush): Promise<StoreResult<{ duplicate: boolean; itemCount: number }>> {
    const r = await rpc(this.db, 'scanner_push', {
      p_session_id: sessionId, p_token: token, p_device: device, p_client_id: p.clientId, p_kind: p.kind,
      ...(p.barcode ? { p_barcode: p.barcode } : {}), p_count: p.count ?? 1,
      ...(p.photo ? { p_photo_b64: p.photo.bytes.toString('base64'), p_mime: p.photo.mime } : {}),
    });
    if (!r) return { ok: false, error: 'unavailable' };
    return r.ok === true ? { ok: true, duplicate: r.duplicate === true, itemCount: Number(r.itemCount ?? 0) } : { ok: false, error: codeOf(r.error) };
  }
}

/** A fresh anonymous client (no session, nothing persisted). */
export function createAnonClient(): SupabaseClient | null {
  const env = readPublicEnv();
  if (!env) return null;
  return createClient(env.url, env.anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

// One in-memory store per server process (mock mode). globalThis so Next's separate route bundles share it.
const GLOBAL_KEY = Symbol.for('fr.scanner.memory');
export function memoryScannerStore(): MemoryScannerStore {
  const g = globalThis as unknown as Record<symbol, MemoryScannerStore | undefined>;
  return (g[GLOBAL_KEY] ??= new MemoryScannerStore());
}
