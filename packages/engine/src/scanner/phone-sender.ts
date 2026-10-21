// The phone side of "use my phone as the scanner" (P3-C, D447): connect with the QR code's credentials, then push barcodes and photos
// through a small retrying queue. Pure and shared: the web phone page and the Android app both drive it with their own transport
// (fetch), so the retry / fatal-error / idempotency rules are the same and tested once.
import { FATAL_PUSH_ERRORS, SCANNER_ERROR_MESSAGE, type ScannerErrorCode, type ScannerPurpose } from './session';

/** What a phone presents: the session id and token from the QR code, and this phone's own id (the first phone to connect claims the session). */
export interface PhoneCred {
  sessionId: string;
  token: string;
  device: string;
}

export type SenderResult<T> = ({ ok: true } & T) | { ok: false; code: ScannerErrorCode; message: string };

export interface PhoneTransport {
  connect(c: PhoneCred): Promise<SenderResult<{ purpose: ScannerPurpose; expiresAt: string; itemCount: number }>>;
  push(c: PhoneCred, p: PushBody): Promise<SenderResult<{ duplicate: boolean; itemCount: number }>>;
}

export type PushBody = { clientId: string } & ({ kind: 'barcode'; barcode: string; count?: number } | { kind: 'photo'; photo: string; mime: string });

export type PhoneStatus = 'connecting' | 'ready' | 'stopped';

export interface RecentScan {
  id: string;
  label: string;
  state: 'sent' | 'waiting' | 'failed';
  note?: string;
}

export interface PhoneState {
  status: PhoneStatus;
  purpose: ScannerPurpose | null;
  expiresAt: string | null;
  /** Set when stopped (or a drop the person should know about). */
  message: string | null;
  sent: number;
  queued: number;
  recent: RecentScan[];
}

/** Errors for which a retry can never help for THIS item: it is dropped with a message, scanning carries on. */
const DROP: readonly ScannerErrorCode[] = ['invalid_input', 'session_full', 'too_many_photos', 'photo_too_large'];
const MAX_RECENT = 6;

export class PhoneSender {
  private queue: Array<{ body: PushBody; recent: RecentScan }> = [];
  private flushing: Promise<void> | null = null;
  private st: PhoneState = { status: 'connecting', purpose: null, expiresAt: null, message: null, sent: 0, queued: 0, recent: [] };
  private seq = 0;

  constructor(
    private readonly cred: PhoneCred,
    private readonly transport: PhoneTransport,
    private readonly onChange: (s: PhoneState) => void = () => undefined,
    private readonly newClientId: () => string = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}${(this.seq++).toString(36)}`,
  ) {}

  get state(): PhoneState {
    return this.st;
  }

  private set(patch: Partial<PhoneState>): void {
    this.st = { ...this.st, ...patch, queued: this.queue.length };
    this.onChange(this.st);
  }

  async connect(): Promise<boolean> {
    const r = await this.transport.connect(this.cred);
    if (!r.ok) {
      this.set({ status: 'stopped', message: r.code === 'unavailable' ? SCANNER_ERROR_MESSAGE.unavailable : SCANNER_ERROR_MESSAGE[r.code] ?? r.message });
      return false;
    }
    this.set({ status: 'ready', purpose: r.purpose, expiresAt: r.expiresAt, sent: r.itemCount, message: null });
    return true;
  }

  sendBarcode(barcode: string, count = 1): void {
    this.add({ clientId: this.newClientId(), kind: 'barcode', barcode, count }, `Barcode ending ${barcode.slice(-4)}${count > 1 ? ` x${count}` : ''}`);
  }

  sendPhoto(photoBase64: string, mime: string): void {
    this.add({ clientId: this.newClientId(), kind: 'photo', photo: photoBase64, mime }, 'Photo');
  }

  private add(body: PushBody, label: string): void {
    if (this.st.status === 'stopped') return;
    const recent: RecentScan = { id: body.clientId, label, state: 'waiting' };
    this.queue.push({ body, recent });
    this.set({ recent: [recent, ...this.st.recent].slice(0, MAX_RECENT) });
    void this.flush();
  }

  private mark(id: string, state: RecentScan['state'], note?: string): void {
    this.st = { ...this.st, recent: this.st.recent.map((r) => (r.id === id ? { ...r, state, ...(note ? { note } : {}) } : r)) };
  }

  /** Send queued items in order. Stops at the first transient failure (kept for the next call); fatal errors stop the session. */
  flush(): Promise<void> {
    this.flushing ??= this.run().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async run(): Promise<void> {
    while (this.queue.length > 0 && this.st.status !== 'stopped') {
      const next = this.queue[0]!;
      const r = await this.transport.push(this.cred, next.body);
      if (r.ok) {
        this.queue.shift();
        this.mark(next.recent.id, 'sent');
        this.set({ sent: this.st.sent + (r.duplicate ? 0 : 1) });
        continue;
      }
      if (FATAL_PUSH_ERRORS.includes(r.code)) {
        this.queue = [];
        this.set({ status: 'stopped', message: SCANNER_ERROR_MESSAGE[r.code] });
        return;
      }
      if (DROP.includes(r.code)) {
        this.queue.shift();
        this.mark(next.recent.id, 'failed', SCANNER_ERROR_MESSAGE[r.code]);
        this.set({ message: SCANNER_ERROR_MESSAGE[r.code] });
        continue;
      }
      // unavailable / rate_limited: keep it, try again later (the page calls flush on a timer and when the network is back).
      this.set({});
      return;
    }
    this.set({});
  }
}
