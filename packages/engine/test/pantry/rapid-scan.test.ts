import { describe, expect, it, vi } from 'vitest';
import {
  MAX_DISTINCT_PRODUCTS, MAX_PER_PRODUCT, MOVED_AWAY_MS, SAME_CODE_COOLDOWN_MS, createLookupTracker, decrement, emptyRapid,
  expandUpcE, fromSnapshot, increment, normaliseRetailCode, parseSeedParam, removeItem, sight, toSeedParam, toSnapshot, totalCount, undo,
  type BatchOutcome, type BatchRequest, type RapidState,
} from '../../src/pantry';

const BEANS = '5009000000015';
const FUSILLI = '5009000000046';

describe('normaliseRetailCode', () => {
  it('accepts EAN-13 and EAN-8 with a good check digit and rejects bad ones', () => {
    expect(normaliseRetailCode(BEANS)).toBe(BEANS);
    expect(normaliseRetailCode('96385074')).toBe('96385074');
    expect(normaliseRetailCode('5009000000011')).toBeNull();
    expect(normaliseRetailCode('12345')).toBeNull();
    expect(normaliseRetailCode('abc')).toBeNull();
  });
  it('turns UPC-A into EAN-13 and refuses a 14-digit carton code', () => {
    expect(normaliseRetailCode('036000291452')).toBe('0036000291452');
    expect(normaliseRetailCode('10036000291459')).toBeNull();
  });
  it('expands UPC-E only when the detector says it is UPC-E', () => {
    // 0 425261 4 expands to 042100005264 ... (published GS1 example: UPC-E 04252614 -> UPC-A 042100005264)
    expect(expandUpcE('04252614')).toBe('042100005264');
    expect(normaliseRetailCode('04252614', 'upc_e')).toBe('0042100005264');
    expect(normaliseRetailCode('04252614', 'UPC-E')).toBe('0042100005264');
    expect(normaliseRetailCode('04252614')).toBeNull(); // read as EAN-8 the check digit is wrong
    expect(normaliseRetailCode('04252615', 'upc_e')).toBeNull();
  });
});

describe('sight (debounce and deliberate re-scan)', () => {
  const scan = (s: RapidState, code: string, at: number) => sight(s, code, at);

  it('counts a new code once, however many frames show it', () => {
    let s = emptyRapid();
    let counted = 0;
    for (let t = 0; t <= 1400; t += 100) {
      const r = scan(s, BEANS, t);
      s = r.state;
      if (r.counted) counted++;
    }
    expect(counted).toBe(1);
    expect(s.items).toEqual([{ barcode: BEANS, count: 1 }]);
  });

  it('keeps a pack that stays in view past the cool-down at one', () => {
    let s = emptyRapid();
    for (let t = 0; t <= 6000; t += 100) s = scan(s, BEANS, t).state;
    expect(s.items[0]!.count).toBe(1);
  });

  it('counts a deliberate re-scan after the pack moved away and came back', () => {
    let s = scan(emptyRapid(), BEANS, 0).state;
    s = scan(s, BEANS, 100).state;
    const back = scan(s, BEANS, 100 + SAME_CODE_COOLDOWN_MS + 50);
    expect(back.counted).toBe(true);
    expect(back.state.items[0]!.count).toBe(2);
  });

  it('ignores a return inside the cool-down even after a gap', () => {
    const s = scan(emptyRapid(), BEANS, 0).state;
    expect(scan(s, BEANS, MOVED_AWAY_MS + 200).counted).toBe(false);
  });

  it('tallies different products in first-scan order and counts A, B, A', () => {
    let s = scan(emptyRapid(), BEANS, 0).state;
    s = scan(s, FUSILLI, 800).state;
    const again = scan(s, BEANS, 2200);
    expect(again.counted).toBe(true);
    expect(again.state.items).toEqual([{ barcode: BEANS, count: 2 }, { barcode: FUSILLI, count: 1 }]);
    expect(totalCount(again.state)).toBe(3);
  });

  it('caps per-product and distinct product counts', () => {
    let s: RapidState = { ...emptyRapid(), items: [{ barcode: BEANS, count: MAX_PER_PRODUCT }] };
    expect(scan(s, BEANS, 5000).counted).toBe(false);
    s = { ...emptyRapid(), items: Array.from({ length: MAX_DISTINCT_PRODUCTS }, (_, i) => ({ barcode: String(10000000 + i), count: 1 })) };
    expect(scan(s, FUSILLI, 0).counted).toBe(false);
  });
});

describe('manual changes and undo', () => {
  it('+ and - adjust the count; - on one removes the line; undo restores in place', () => {
    let s = sight(emptyRapid(), BEANS, 0).state;
    s = sight(s, FUSILLI, 700).state;
    s = increment(s, BEANS);
    expect(s.items[0]!.count).toBe(2);
    s = decrement(s, BEANS);
    s = decrement(s, BEANS); // 1 -> removed
    expect(s.items.map((i) => i.barcode)).toEqual([FUSILLI]);
    s = undo(s);
    expect(s.items).toEqual([{ barcode: BEANS, count: 1 }, { barcode: FUSILLI, count: 1 }]);
    s = undo(s); // undo the decrement 2 -> 1
    expect(s.items[0]!.count).toBe(2);
  });

  it('undoing a scan removes it and lets the same pack be scanned again at once', () => {
    let s = sight(emptyRapid(), BEANS, 0).state;
    s = undo(s);
    expect(s.items).toEqual([]);
    const r = sight(s, BEANS, 200);
    expect(r.counted).toBe(true);
    expect(r.state.items[0]!.count).toBe(1);
  });

  it('undoing a counted re-scan drops the count by one, and an empty undo is a no-op', () => {
    let s = sight(emptyRapid(), BEANS, 0).state;
    s = sight(s, BEANS, 3000).state;
    expect(s.items[0]!.count).toBe(2);
    s = undo(s);
    expect(s.items[0]!.count).toBe(1);
    expect(undo(emptyRapid())).toEqual(emptyRapid());
  });

  it('removeItem is undoable and unknown codes are ignored', () => {
    let s = sight(emptyRapid(), BEANS, 0).state;
    s = increment(s, BEANS);
    s = removeItem(s, BEANS);
    expect(s.items).toEqual([]);
    expect(undo(s).items).toEqual([{ barcode: BEANS, count: 2 }]);
    expect(increment(s, '123')).toBe(s);
    expect(decrement(s, '123')).toBe(s);
    expect(removeItem(s, '123')).toBe(s);
  });
});

describe('snapshot', () => {
  it('round-trips the tally and drops anything malformed', () => {
    let s = sight(emptyRapid(), BEANS, 0).state;
    s = increment(s, BEANS);
    expect(fromSnapshot(toSnapshot(s)).items).toEqual([{ barcode: BEANS, count: 2 }]);
    expect(fromSnapshot(null).items).toEqual([]);
    expect(fromSnapshot({ v: 2, items: [] }).items).toEqual([]);
    expect(fromSnapshot({ v: 1, items: [{ barcode: 'x', count: 1 }, { barcode: BEANS, count: -1 }, { barcode: BEANS, count: 500 }, { barcode: BEANS, count: 1 }, 7] }).items)
      .toEqual([{ barcode: BEANS, count: MAX_PER_PRODUCT }]);
  });
});

describe('seed param (app to web hand-off)', () => {
  it('round-trips and drops junk, bad check digits and duplicates', () => {
    const items = [{ barcode: BEANS, count: 2 }, { barcode: FUSILLI, count: 1 }];
    expect(toSeedParam(items)).toBe(`${BEANS}x2,${FUSILLI}x1`);
    expect(parseSeedParam(toSeedParam(items))).toEqual(items);
    expect(parseSeedParam(`${BEANS}x2,5009000000011x1,abc,${BEANS}x5,${FUSILLI}x0,${FUSILLI}x100`)).toEqual([{ barcode: BEANS, count: 2 }]);
    expect(parseSeedParam(undefined)).toEqual([]);
    expect(parseSeedParam('')).toEqual([]);
  });
});

describe('createLookupTracker', () => {
  function harness(post: (r: BatchRequest) => Promise<BatchOutcome<string>>) {
    const timers: { fn: () => void; ms: number }[] = [];
    const onChange = vi.fn();
    const t = createLookupTracker<string>({
      post, onChange, pollMs: 1000, maxBatch: 2,
      schedule: (fn, ms) => { const h = { fn, ms }; timers.push(h); return h; },
      cancel: (h) => { const i = timers.indexOf(h as { fn: () => void; ms: number }); if (i >= 0) timers.splice(i, 1); },
    });
    const run = async () => { const x = timers.shift(); x?.fn(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
    return { t, timers, run, onChange };
  }

  it('does not block: request marks pending, the first poll resolves known products, unknown ones keep polling', async () => {
    const calls: BatchRequest[] = [];
    let n = 0;
    const { t, run, timers } = harness(async (req) => {
      calls.push(req);
      n++;
      return { ok: true, results: { [BEANS]: { status: 'done', lookup: 'beans' }, [FUSILLI]: n < 2 ? { status: 'pending' } : { status: 'notfound' } } };
    });
    t.request(BEANS);
    t.request(FUSILLI);
    t.request(BEANS); // idempotent
    expect(t.get(BEANS)).toEqual({ state: 'pending' });
    expect(timers).toHaveLength(1);
    await run();
    expect(calls[0]!.codes).toEqual([BEANS, FUSILLI]);
    expect(t.get(BEANS)).toEqual({ state: 'done', value: 'beans' });
    expect(t.get(FUSILLI)).toEqual({ state: 'pending' });
    expect(timers[0]!.ms).toBe(1000);
    await run();
    expect(calls[1]!.codes).toEqual([FUSILLI]);
    expect(t.get(FUSILLI)).toEqual({ state: 'notfound' });
    expect(timers).toHaveLength(0);
    expect(t.pendingCount()).toBe(0);
  });

  it('chunks big queues and keeps going without waiting a full interval', async () => {
    const calls: BatchRequest[] = [];
    const { t, run, timers } = harness(async (req) => {
      calls.push(req);
      return { ok: true, results: Object.fromEntries(req.codes.map((c) => [c, { status: 'done' as const, lookup: c }])) };
    });
    ['11111111', '22222222', '33333333'].forEach((c) => t.request(c));
    await run();
    expect(calls[0]!.codes).toHaveLength(2);
    expect(timers[0]!.ms).toBe(0);
    await run();
    expect(t.pendingCount()).toBe(0);
  });

  it('backs off on a network failure and keeps the codes pending', async () => {
    let fail = true;
    const { t, run, timers } = harness(async () => (fail ? Promise.reject(new Error('offline')) : { ok: true, results: { [BEANS]: { status: 'done', lookup: 'b' } } }));
    t.request(BEANS);
    await run();
    expect(t.get(BEANS)).toEqual({ state: 'pending' });
    expect(timers[0]!.ms).toBe(2000);
    await run();
    expect(timers[0]!.ms).toBe(4000);
    fail = false;
    await run();
    expect(t.get(BEANS)).toEqual({ state: 'done', value: 'b' });
  });

  it('per-code errors can be retried; a fatal answer errors the whole chunk', async () => {
    const calls: BatchRequest[] = [];
    let first = true;
    const { t, run } = harness(async (req) => {
      calls.push(req);
      if (first) { first = false; return { ok: true, results: { [BEANS]: { status: 'error', error: { code: 'upstream', message: 'down', retryable: true } } } }; }
      return { ok: true, results: { [BEANS]: { status: 'done', lookup: 'b' } } };
    });
    t.request(BEANS);
    await run();
    expect(t.get(BEANS)).toMatchObject({ state: 'error' });
    t.retry(BEANS);
    await run();
    expect(calls[1]!.retry).toEqual([BEANS]);
    expect(t.get(BEANS)).toEqual({ state: 'done', value: 'b' });

    const f = harness(async () => ({ ok: false, fatal: true, message: 'signed out' }));
    f.t.request(FUSILLI);
    await f.run();
    expect(f.t.get(FUSILLI)).toMatchObject({ state: 'error', error: { message: 'signed out' } });
  });

  it('stop cancels the poll', async () => {
    const post = vi.fn();
    const { t, timers } = harness(post);
    t.request(BEANS);
    t.stop();
    expect(timers).toHaveLength(0);
    t.request(FUSILLI);
    expect(timers).toHaveLength(0);
  });
});
