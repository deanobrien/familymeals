// The device-local parent PIN gate for kids' mode (P3-A, D424): the PIN record and the lock-out state live in a key-value store ON
// THIS DEVICE (browser localStorage; Android secure storage), never on the server. The same class runs on web and Android; the
// storage, clock and salt source are injected so it is unit-testable.
import {
  OPEN_GATE, attemptPin, createPinRecord, isValidPin, parseGateState, parsePinRecord, type GateState, type PinAttempt, type PinRecord,
} from './pin';

export interface KeyValueStore {
  getItem(key: string): Promise<string | null> | string | null;
  setItem(key: string, value: string): Promise<void> | void;
  removeItem(key: string): Promise<void> | void;
}

export interface GateOptions {
  /** Distinguishes households / users on a shared device, e.g. `fr.kids.<householdId>`. */
  key: string;
  now?: () => number;
  /** 16+ hex characters of randomness (crypto on the device). */
  randomSalt: () => string;
}

export class DevicePinGate {
  private readonly now: () => number;
  constructor(private readonly store: KeyValueStore, private readonly opts: GateOptions) {
    this.now = opts.now ?? Date.now;
  }

  private async read<T>(suffix: string, parse: (v: unknown) => T): Promise<T> {
    try {
      const raw = await this.store.getItem(`${this.opts.key}.${suffix}`);
      return parse(raw ? JSON.parse(raw) : null);
    } catch {
      return parse(null); // unreadable storage = nothing stored
    }
  }

  private async write(suffix: string, value: unknown): Promise<void> {
    await this.store.setItem(`${this.opts.key}.${suffix}`, JSON.stringify(value));
  }

  private record(): Promise<PinRecord | null> {
    return this.read('pin', parsePinRecord);
  }

  async hasPin(): Promise<boolean> {
    return (await this.record()) !== null;
  }

  /** Set (or change) the PIN: 4-6 digits. Changing it needs the current PIN unless there is none yet. Returns false when refused. */
  async setPin(pin: string, currentPin?: string): Promise<boolean> {
    if (!isValidPin(pin)) return false;
    if (await this.hasPin()) {
      if (currentPin === undefined || !(await this.verify(currentPin)).ok) return false;
    }
    const rec = createPinRecord(pin, this.opts.randomSalt());
    if (!rec) return false;
    await this.write('pin', rec);
    await this.write('gate', OPEN_GATE);
    return true;
  }

  async state(): Promise<GateState> {
    return this.read('gate', parseGateState);
  }

  /** Milliseconds the gate is locked for (0 = open for attempts). */
  async lockedForMs(): Promise<number> {
    return Math.max(0, (await this.state()).lockedUntil - this.now());
  }

  /** Check a guess. With no PIN set nothing opens (kids' mode cannot start without one). */
  async verify(guess: string): Promise<PinAttempt> {
    const rec = await this.record();
    const state = await this.state();
    if (!rec) return { ok: false, reason: 'invalid', state, retryAfterMs: 0 };
    const r = attemptPin(rec, guess, state, this.now());
    if (r.state !== state) await this.write('gate', r.state);
    return r;
  }

  async clear(): Promise<void> {
    await this.store.removeItem(`${this.opts.key}.pin`);
    await this.store.removeItem(`${this.opts.key}.gate`);
  }
}
