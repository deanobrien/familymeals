import type { PhoneTransport, PushBody, ScannerPurpose } from '@fr/engine/scanner';

/** A stand-in for the desktop session on the server: records what the phone pushes, with switches for offline / ended. */
export class MemoryScannerStoreForTests {
  connected = false;
  offline = false;
  revoked = false;
  items: Array<{ clientId: string; kind: 'barcode' | 'photo'; barcode?: string; photo?: string }> = [];

  constructor(private readonly s: { id: string; token: string; purpose: ScannerPurpose }) {}

  transport(): PhoneTransport {
    const unavailable = { ok: false as const, code: 'unavailable' as const, message: 'offline' };
    return {
      connect: async (c) => {
        if (this.offline) return unavailable;
        if (c.sessionId !== this.s.id || c.token !== this.s.token) return { ok: false, code: 'invalid', message: 'invalid' };
        this.connected = true;
        return { ok: true, purpose: this.s.purpose, expiresAt: new Date(Date.now() + 600_000).toISOString(), itemCount: this.items.length };
      },
      push: async (c, p: PushBody) => {
        if (this.offline) return unavailable;
        if (this.revoked) return { ok: false, code: 'revoked', message: 'revoked' };
        if (c.token !== this.s.token) return { ok: false, code: 'invalid', message: 'invalid' };
        const dup = this.items.some((i) => i.clientId === p.clientId);
        if (!dup) this.items.push({ clientId: p.clientId, kind: p.kind, ...(p.kind === 'barcode' ? { barcode: p.barcode } : { photo: p.photo }) });
        return { ok: true, duplicate: dup, itemCount: this.items.length };
      },
    };
  }
}
