/** Tiny TTL cache (bounded) so repeated searches and detail lookups do not hit the provider again. */
export class TtlCache<T> {
  private readonly m = new Map<string, { at: number; v: T }>();
  constructor(private readonly ttlMs: number, private readonly max = 500, private readonly now: () => number = Date.now) {}

  get(key: string): T | undefined {
    const e = this.m.get(key);
    if (!e) return undefined;
    if (this.now() - e.at > this.ttlMs) { this.m.delete(key); return undefined; }
    return e.v;
  }
  set(key: string, v: T): void {
    if (this.m.size >= this.max) {
      const oldest = this.m.keys().next().value;
      if (oldest !== undefined) this.m.delete(oldest);
    }
    this.m.set(key, { at: this.now(), v });
  }
  clear(): void { this.m.clear(); }
  get size(): number { return this.m.size; }
}

/**
 * Polite rate limiting: calls are spaced at least `minIntervalMs` apart (serialised through a promise chain),
 * so a burst of detail lookups never hammers the provider. `sleep` is injectable for tests.
 */
export function createRateLimiter(
  minIntervalMs: number,
  opts: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {},
): <T>(fn: () => Promise<T>) => Promise<T> {
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let tail: Promise<unknown> = Promise.resolve();
  let last = -Infinity;
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(async () => {
      const wait = last + minIntervalMs - now();
      if (wait > 0) await sleep(wait);
      last = now();
      return fn();
    });
    tail = run.catch(() => undefined);
    return run;
  };
}
