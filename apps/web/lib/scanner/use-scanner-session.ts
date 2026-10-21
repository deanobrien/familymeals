'use client';

// The desktop side of "use my phone as the scanner" (P3-C, D447-D449): start a session, show its QR link, and apply what the phone
// pushes, exactly once and in order. Supabase Realtime (INSERT on scanner_items, filtered by session) is only a HINT that makes the
// next read happen now; the read is a poll of GET /api/scanner/sessions/<id>, every 2 s (5 s while Realtime is confirmed), so a
// missed event costs at most a few seconds and mock mode (no Realtime) behaves identically.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SCANNER_ERROR_MESSAGE, buildPhoneLink, createApplied, secondsLeft,
  type ScannerItem, type ScannerPurpose, type ScannerSessionView,
} from '@fr/engine/scanner';
import { createSupabaseBrowserClient } from '../supabase/browser';
import type { ChannelLike, RealtimeClientLike } from '../shopping/live';
import { endScannerSession, fetchScannerPhoto, fetchScannerStatus, releaseScannerPhone, startScannerSession } from './client';

export type ScannerPhase = 'idle' | 'starting' | 'live' | 'ended' | 'error';

export interface ScannerSessionState {
  phase: ScannerPhase;
  session: ScannerSessionView | null;
  /** The address in the QR code (contains the token in its fragment). */
  link: string | null;
  error: string | null;
  secondsLeft: number;
  /** Items received so far this session (barcode scans + photos), for the "N scans" line. */
  received: number;
  /** Realtime hint confirmed (informational: the poll runs either way). */
  realtime: boolean;
}

export interface ScannerHandlers {
  /** One counted barcode from the phone. Called once per push, in order. */
  onBarcode?: (barcode: string, count: number) => void | Promise<void>;
  /** One photo from the phone, as a File ready for the existing scan / receipt pipeline. */
  onPhoto?: (file: File) => void | Promise<void>;
}

const POLL_MS = 2000;
const POLL_WITH_REALTIME_MS = 5000;

const IDLE: ScannerSessionState = { phase: 'idle', session: null, link: null, error: null, secondsLeft: 0, received: 0, realtime: false };

export function useScannerSession(purpose: ScannerPurpose, handlers: ScannerHandlers, opts: { realtime?: boolean } = {}) {
  const [state, setState] = useState<ScannerSessionState>(IDLE);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const applied = useRef(createApplied());
  const sessionId = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const polling = useRef(false);
  const again = useRef(false);
  const realtimeOn = useRef(false);
  const stopRealtime = useRef<(() => void) | null>(null);
  const alive = useRef(true);

  const clearTimers = () => {
    if (timer.current !== undefined) clearTimeout(timer.current);
    timer.current = undefined;
  };

  const apply = useCallback(async (items: ScannerItem[]) => {
    for (const item of applied.current.fresh(items)) {
      const h = handlersRef.current;
      if (item.kind === 'barcode' && item.barcode) {
        await h.onBarcode?.(item.barcode, item.count);
      } else if (item.kind === 'photo') {
        const id = sessionId.current;
        const blob = id ? await fetchScannerPhoto(id, item.id) : null;
        if (!blob) return; // not ready / transient: this item stays "fresh" and is retried on the next poll, in order
        await h.onPhoto?.(new File([blob], `phone-${item.seq}.${blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg'}`, { type: blob.type || 'image/jpeg' }));
      }
      applied.current.done(item);
      setState((s) => ({ ...s, received: s.received + 1 }));
    }
  }, []);

  const poll = useCallback(async () => {
    const id = sessionId.current;
    if (!id) return;
    if (polling.current) { again.current = true; return; }
    polling.current = true;
    try {
      do {
        again.current = false;
        const r = await fetchScannerStatus(id, applied.current.lastSeq());
        if (!alive.current || sessionId.current !== id) return;
        if (!r.ok) {
          if (r.code === 'not_found' || r.code === 'forbidden') { finish('ended', 'This scanning session is no longer available.'); return; }
          continue; // a blip: the next scheduled poll tries again
        }
        setState((s) => ({ ...s, session: r.session }));
        await apply(r.items);
        if (r.session.state === 'expired' || r.session.state === 'revoked') {
          finish('ended', r.session.state === 'expired' ? SCANNER_ERROR_MESSAGE.expired : SCANNER_ERROR_MESSAGE.revoked);
          return;
        }
      } while (again.current);
    } finally {
      polling.current = false;
    }
  }, [apply]);

  const schedule = useCallback(() => {
    clearTimers();
    timer.current = setTimeout(async () => {
      await poll();
      if (alive.current && sessionId.current) schedule();
    }, realtimeOn.current ? POLL_WITH_REALTIME_MS : POLL_MS);
  }, [poll]);

  function finish(phase: 'ended' | 'error', error: string | null) {
    clearTimers();
    stopRealtime.current?.();
    stopRealtime.current = null;
    sessionId.current = null;
    realtimeOn.current = false;
    if (alive.current) setState((s) => ({ ...s, phase, error, realtime: false }));
  }

  const startRealtime = useCallback((id: string) => {
    if (!opts.realtime) return;
    try {
      const client = createSupabaseBrowserClient() as unknown as RealtimeClientLike;
      let ch: ChannelLike | undefined;
      ch = client
        .channel(`scanner:${id}`)
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scanner_items', filter: `session_id=eq.${id}` }, () => { void poll(); })
        .on('system', {}, (msg) => {
          if (msg.extension !== 'postgres_changes') return;
          realtimeOn.current = msg.status === 'ok';
          setState((s) => ({ ...s, realtime: realtimeOn.current }));
        })
        .subscribe();
      stopRealtime.current = () => { try { if (ch) client.removeChannel(ch); } catch { /* gone */ } ch = undefined; };
    } catch {
      /* no public Supabase env in this bundle: the poll alone does the job */
    }
  }, [opts.realtime, poll]);

  const start = useCallback(async () => {
    if (sessionId.current) return;
    applied.current.reset();
    setState({ ...IDLE, phase: 'starting' });
    const r = await startScannerSession(purpose);
    if (!alive.current) return;
    if (!r.ok) { setState({ ...IDLE, phase: 'error', error: r.message }); return; }
    sessionId.current = r.id;
    setState({
      ...IDLE, phase: 'live', link: buildPhoneLink(window.location.origin, r.id, r.token), secondsLeft: secondsLeft(r.expiresAt, Date.now()),
      session: { id: r.id, purpose, expiresAt: r.expiresAt, state: 'waiting', itemCount: 0, photoCount: 0 },
    });
    startRealtime(r.id);
    schedule();
  }, [purpose, schedule, startRealtime]);

  /** End it now: the phone stops being accepted and whatever it sent is deleted on the server. */
  const stop = useCallback(async () => {
    const id = sessionId.current;
    finish('ended', null);
    setState({ ...IDLE });
    if (id) await endScannerSession(id);
  }, []);

  const releasePhone = useCallback(async () => {
    const id = sessionId.current;
    if (id) await releaseScannerPhone(id);
    void poll();
  }, [poll]);

  // Countdown on screen (the server is what actually expires the session).
  useEffect(() => {
    if (state.phase !== 'live' || !state.session) return undefined;
    const expiresAt = state.session.expiresAt;
    const t = setInterval(() => setState((s) => (s.phase === 'live' ? { ...s, secondsLeft: secondsLeft(expiresAt, Date.now()) } : s)), 1000);
    return () => clearInterval(t);
  }, [state.phase, state.session?.expiresAt]);

  // Leaving the page ends the session (and deletes what the phone sent).
  useEffect(() => {
    alive.current = true;
    const onHide = () => { const id = sessionId.current; if (id) void endScannerSession(id); };
    window.addEventListener('pagehide', onHide);
    return () => {
      alive.current = false;
      window.removeEventListener('pagehide', onHide);
      clearTimers();
      stopRealtime.current?.();
      onHide();
    };
  }, []);

  return { state, start, stop, releasePhone, pollNow: poll };
}
