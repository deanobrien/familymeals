/**
 * Rapid (continuous) barcode scanning, shared by the web scan page and the Android app (PRJ-018 BS1, D270-D272).
 * Pure and deterministic: no camera, no clock (callers pass `now`), no I/O. Three parts:
 *  1. code normalisation (retail EAN-13 / EAN-8 / UPC-A / UPC-E, GS1 check digit),
 *  2. the session tally (debounce, deliberate re-scan, manual +/-, undo, serialisation),
 *  3. the lookup tracker (queue barcodes, poll a batch endpoint, resolve progressively).
 */

// ---------------------------------------------------------------------------------------------------------------------
// 1. Code normalisation
// ---------------------------------------------------------------------------------------------------------------------

function gs1Ok(digits: string): boolean {
  if (!/^\d{8}$|^\d{12,14}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length - 1; i++) sum += Number(digits[digits.length - 2 - i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

/** UPC-E (8 digits: number system, 6 digits, check) -> its 12-digit UPC-A, or null when malformed. */
export function expandUpcE(upce: string): string | null {
  if (!/^[01]\d{7}$/.test(upce)) return null;
  const ns = upce[0]!;
  const d = upce.slice(1, 7);
  const check = upce[7]!;
  const last = d[5]!;
  let body: string;
  if (last === '0' || last === '1' || last === '2') body = `${d.slice(0, 2)}${last}0000${d.slice(2, 5)}`;
  else if (last === '3') body = `${d.slice(0, 3)}00000${d.slice(3, 5)}`;
  else if (last === '4') body = `${d.slice(0, 4)}00000${d[4]}`;
  else body = `${d.slice(0, 5)}0000${last}`;
  return `${ns}${body}${check}`;
}

/**
 * The canonical code for a decoded string, or null when it is not a plausible retail barcode. UPC-A (12) becomes
 * EAN-13 with a leading 0 (how Open Food Facts stores it); a UPC-E symbol is expanded first. EAN-8 stays 8 digits.
 * `format` is the detector's format name (`upc_e`, `UPC-E`, `UPCE`...) and is only needed to tell UPC-E from EAN-8.
 */
export function normaliseRetailCode(raw: string, format?: string): string | null {
  const digits = raw.replace(/[\s-]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const isUpcE = format !== undefined && /^upc[-_ ]?e$/i.test(format);
  if (isUpcE && digits.length === 8) {
    const a = expandUpcE(digits);
    return a && gs1Ok(a) ? `0${a}` : null;
  }
  if (!gs1Ok(digits)) return null;
  if (digits.length === 14) return null; // a carton code, not an item barcode
  return digits.length === 12 ? `0${digits}` : digits;
}

// ---------------------------------------------------------------------------------------------------------------------
// 2. Session tally
// ---------------------------------------------------------------------------------------------------------------------

/** The same code seen again within this long of its last COUNTED read is the same pack still in view. */
export const SAME_CODE_COOLDOWN_MS = 1500;
/** ...and a deliberate re-scan also needs the code to have been out of view for this long. */
export const MOVED_AWAY_MS = 500;
export const MAX_DISTINCT_PRODUCTS = 150;
export const MAX_PER_PRODUCT = 99;

export interface RapidItem {
  barcode: string;
  count: number;
}

export type RapidChange =
  | { kind: 'inc'; barcode: string }
  | { kind: 'dec'; barcode: string }
  | { kind: 'add'; barcode: string; index: number; count: number }
  | { kind: 'remove'; barcode: string; index: number; count: number };

export interface RapidState {
  /** In order of first scan. */
  items: RapidItem[];
  /** Per code: when its last read was COUNTED, and when it was last SEEN (counted or not). Not persisted. */
  counted: Record<string, number>;
  seen: Record<string, number>;
  /** Undo stack (most recent last), capped. */
  history: RapidChange[];
}

export const emptyRapid = (): RapidState => ({ items: [], counted: {}, seen: {}, history: [] });

const HISTORY_LIMIT = 200;

function push(state: RapidState, change: RapidChange): RapidChange[] {
  const h = [...state.history, change];
  return h.length > HISTORY_LIMIT ? h.slice(h.length - HISTORY_LIMIT) : h;
}

export interface SightingResult {
  state: RapidState;
  /** True when this read was counted (beep / flash / announce). */
  counted: boolean;
  barcode: string;
}

/**
 * A decoded (already normalised) code was seen at `now`. Counted when it is new, or when it is a deliberate re-scan: its
 * last counted read is at least SAME_CODE_COOLDOWN_MS ago AND it had been out of view for at least MOVED_AWAY_MS. A pack held
 * in front of the camera keeps being "seen" (extending the out-of-view test), so it is counted once however long it stays.
 */
export function sight(state: RapidState, barcode: string, now: number): SightingResult {
  const lastCounted = state.counted[barcode];
  const lastSeen = state.seen[barcode];
  const seen = { ...state.seen, [barcode]: now };
  const known = state.items.find((i) => i.barcode === barcode);
  const deliberate =
    lastCounted === undefined ||
    (now - lastCounted >= SAME_CODE_COOLDOWN_MS && (lastSeen === undefined || now - lastSeen >= MOVED_AWAY_MS));
  if (!deliberate) return { state: { ...state, seen }, counted: false, barcode };
  if (known && known.count >= MAX_PER_PRODUCT) return { state: { ...state, seen, counted: { ...state.counted, [barcode]: now } }, counted: false, barcode };
  if (!known && state.items.length >= MAX_DISTINCT_PRODUCTS) return { state: { ...state, seen }, counted: false, barcode };
  const counted = { ...state.counted, [barcode]: now };
  if (known) {
    return {
      state: { ...state, seen, counted, items: state.items.map((i) => (i === known ? { ...i, count: i.count + 1 } : i)), history: push(state, { kind: 'inc', barcode }) },
      counted: true, barcode,
    };
  }
  return {
    state: { ...state, seen, counted, items: [...state.items, { barcode, count: 1 }], history: push(state, { kind: 'add', barcode, index: state.items.length, count: 1 }) },
    counted: true, barcode,
  };
}

/** Manual +1 (the + button). */
export function increment(state: RapidState, barcode: string): RapidState {
  const known = state.items.find((i) => i.barcode === barcode);
  if (!known || known.count >= MAX_PER_PRODUCT) return state;
  return { ...state, items: state.items.map((i) => (i === known ? { ...i, count: i.count + 1 } : i)), history: push(state, { kind: 'inc', barcode }) };
}

/** Manual -1. Going below one removes the line (undo brings it back). */
export function decrement(state: RapidState, barcode: string): RapidState {
  const idx = state.items.findIndex((i) => i.barcode === barcode);
  if (idx < 0) return state;
  const item = state.items[idx]!;
  if (item.count > 1) {
    return { ...state, items: state.items.map((i) => (i === item ? { ...i, count: i.count - 1 } : i)), history: push(state, { kind: 'dec', barcode }) };
  }
  return removeItem(state, barcode);
}

/** Remove a whole line (undo restores it with its count). */
export function removeItem(state: RapidState, barcode: string): RapidState {
  const idx = state.items.findIndex((i) => i.barcode === barcode);
  if (idx < 0) return state;
  const item = state.items[idx]!;
  return { ...state, items: state.items.filter((_, i) => i !== idx), history: push(state, { kind: 'remove', barcode, index: idx, count: item.count }) };
}

/** Undo the most recent change (a counted scan, a +/- or a removal). */
export function undo(state: RapidState): RapidState {
  const last = state.history[state.history.length - 1];
  if (!last) return state;
  const history = state.history.slice(0, -1);
  // The undone scan must not leave a cool-down behind: re-scanning the same pack straight away is the point of undo.
  const forget = (barcode: string): Pick<RapidState, 'counted'> => {
    const counted = { ...state.counted };
    delete counted[barcode];
    return { counted };
  };
  switch (last.kind) {
    case 'inc': {
      const items = state.items.map((i) => (i.barcode === last.barcode ? { ...i, count: Math.max(1, i.count - 1) } : i));
      return { ...state, items, history, ...forget(last.barcode) };
    }
    case 'dec': {
      const items = state.items.map((i) => (i.barcode === last.barcode ? { ...i, count: i.count + 1 } : i));
      return { ...state, items, history };
    }
    case 'add':
      return { ...state, items: state.items.filter((i) => i.barcode !== last.barcode), history, ...forget(last.barcode) };
    case 'remove': {
      const items = [...state.items];
      items.splice(Math.min(last.index, items.length), 0, { barcode: last.barcode, count: last.count });
      return { ...state, items, history };
    }
  }
}

export const totalCount = (state: RapidState): number => state.items.reduce((n, i) => n + i.count, 0);

/** What is persisted (sessionStorage) to survive an accidental refresh: the tally only. */
export interface RapidSnapshot {
  v: 1;
  items: RapidItem[];
}

export const toSnapshot = (state: RapidState): RapidSnapshot => ({ v: 1, items: state.items.map((i) => ({ ...i })) });

/** Validating restore: anything malformed yields an empty session, never an exception. */
export function fromSnapshot(raw: unknown): RapidState {
  const empty = emptyRapid();
  if (!raw || typeof raw !== 'object') return empty;
  const r = raw as { v?: unknown; items?: unknown };
  if (r.v !== 1 || !Array.isArray(r.items)) return empty;
  const seenCodes = new Set<string>();
  const items: RapidItem[] = [];
  for (const it of r.items.slice(0, MAX_DISTINCT_PRODUCTS)) {
    if (!it || typeof it !== 'object') continue;
    const { barcode, count } = it as { barcode?: unknown; count?: unknown };
    if (typeof barcode !== 'string' || !/^\d{8}$|^\d{13}$/.test(barcode) || seenCodes.has(barcode)) continue;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1) continue;
    seenCodes.add(barcode);
    items.push({ barcode, count: Math.min(count, MAX_PER_PRODUCT) });
  }
  return { ...empty, items };
}

/**
 * Hand-off of a tally between devices in a URL (the Android app opens `/pantry/scan?mode=rapid&codes=<param>` to review
 * on the web): `5009000000015x2,5009000000046x1`. Barcodes are not personal data. Validating parse; junk is dropped.
 */
export function toSeedParam(items: readonly RapidItem[]): string {
  return items.slice(0, MAX_DISTINCT_PRODUCTS).map((i) => `${i.barcode}x${Math.min(i.count, MAX_PER_PRODUCT)}`).join(',');
}

export function parseSeedParam(raw: string | null | undefined): RapidItem[] {
  if (!raw) return [];
  return fromSnapshot({
    v: 1,
    items: raw.slice(0, 4000).split(',').flatMap((part) => {
      const m = /^(\d{8}|\d{13})x(\d{1,2})$/.exec(part.trim());
      return m && normaliseRetailCode(m[1]!) === m[1] ? [{ barcode: m[1], count: Number(m[2]) }] : [];
    }),
  }).items;
}

// ---------------------------------------------------------------------------------------------------------------------
// 3. Lookup tracker
// ---------------------------------------------------------------------------------------------------------------------

export interface LookupFailure {
  code: string;
  message: string;
  retryable: boolean;
}

export type LookupState<T> =
  | { state: 'pending' }
  | { state: 'done'; value: T }
  | { state: 'notfound' }
  | { state: 'error'; error: LookupFailure };

/** One entry of the batch endpoint's answer (POST /api/products). */
export type BatchEntry<T> =
  | { status: 'done'; lookup: T }
  | { status: 'notfound' }
  | { status: 'pending' }
  | { status: 'error'; error: LookupFailure };

export interface BatchRequest {
  codes: string[];
  /** Codes whose earlier failure should be forgotten and queued again. */
  retry?: string[];
}

export type BatchOutcome<T> =
  | { ok: true; results: Record<string, BatchEntry<T>> }
  | { ok: false; fatal: boolean; message: string };

export interface TrackerOptions<T> {
  post(req: BatchRequest): Promise<BatchOutcome<T>>;
  onChange?: (snapshot: ReadonlyMap<string, LookupState<T>>) => void;
  schedule?: (fn: () => void, ms: number) => unknown;
  cancel?: (handle: unknown) => void;
  /** Poll interval while anything is pending. Default 1500 ms. */
  pollMs?: number;
  /** Largest backoff after a network failure. Default 10 s. */
  maxBackoffMs?: number;
  /** Codes per request. Default 25. */
  maxBatch?: number;
}

export interface LookupTracker<T> {
  /** Ask for a code (idempotent: known codes are not asked again). */
  request(code: string): void;
  /** Forget a failure and ask again. */
  retry(code: string): void;
  get(code: string): LookupState<T> | undefined;
  snapshot(): ReadonlyMap<string, LookupState<T>>;
  pendingCount(): number;
  stop(): void;
}

/**
 * Resolves barcodes progressively and never blocks the caller: `request` returns at once; a single polling loop posts the
 * still-pending codes to the batch endpoint, in chunks, with backoff when the network fails. The server answers instantly
 * for products it already knows (household snapshots, cache) and queues the rest against Open Food Facts' rate limit.
 */
export function createLookupTracker<T>(opts: TrackerOptions<T>): LookupTracker<T> {
  // This package has no DOM / Node typings: reach the platform timers through globalThis.
  const timers = globalThis as unknown as { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(h: unknown): void };
  const schedule = opts.schedule ?? ((fn, ms) => timers.setTimeout(fn, ms));
  const cancel = opts.cancel ?? ((h) => timers.clearTimeout(h));
  const pollMs = opts.pollMs ?? 1500;
  const maxBackoff = opts.maxBackoffMs ?? 10_000;
  const maxBatch = opts.maxBatch ?? 25;
  const states = new Map<string, LookupState<T>>();
  const retrying = new Set<string>();
  let handle: unknown;
  let scheduled = false;
  let inFlight = false;
  let stopped = false;
  let backoff = 0;

  const emit = () => opts.onChange?.(new Map(states));
  const pending = (): string[] => [...states.entries()].filter(([, s]) => s.state === 'pending').map(([c]) => c);

  function arm(ms: number) {
    if (stopped || scheduled || pending().length === 0) return;
    scheduled = true;
    handle = schedule(() => {
      scheduled = false;
      void tick();
    }, ms);
  }

  async function tick() {
    if (stopped || inFlight) return;
    const codes = pending().slice(0, maxBatch);
    if (codes.length === 0) return;
    inFlight = true;
    let out: BatchOutcome<T>;
    try {
      const retry = [...retrying].filter((c) => codes.includes(c));
      out = await opts.post({ codes, ...(retry.length ? { retry } : {}) });
    } catch {
      out = { ok: false, fatal: false, message: 'network' };
    }
    inFlight = false;
    if (stopped) return;
    if (!out.ok) {
      if (out.fatal) {
        for (const c of codes) states.set(c, { state: 'error', error: { code: 'FATAL', message: out.message, retryable: true } });
        emit();
        return;
      }
      backoff = Math.min(maxBackoff, backoff ? backoff * 2 : pollMs * 2);
      arm(backoff);
      return;
    }
    backoff = 0;
    for (const c of codes) retrying.delete(c);
    for (const c of codes) {
      const e = out.results[c];
      if (!e) continue;
      if (e.status === 'done') states.set(c, { state: 'done', value: e.lookup });
      else if (e.status === 'notfound') states.set(c, { state: 'notfound' });
      else if (e.status === 'error') states.set(c, { state: 'error', error: e.error });
    }
    emit();
    arm(pending().some((c) => !codes.includes(c)) ? 0 : pollMs);
  }

  return {
    request(code) {
      if (stopped || states.has(code)) return;
      states.set(code, { state: 'pending' });
      emit();
      // The first poll goes out almost at once so known products appear instantly.
      arm(50);
    },
    retry(code) {
      const cur = states.get(code);
      if (!cur || cur.state !== 'error') return;
      states.set(code, { state: 'pending' });
      retrying.add(code);
      emit();
      arm(50);
    },
    get: (code) => states.get(code),
    snapshot: () => new Map(states),
    pendingCount: () => pending().length,
    stop() {
      stopped = true;
      if (scheduled) cancel(handle);
      scheduled = false;
    },
  };
}
